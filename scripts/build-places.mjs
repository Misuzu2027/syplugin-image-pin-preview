/**
 * 下载行政区中心点和 GeoNames 城市，压成 public/data/places.json。
 * 只在更新对照表时运行，平时构建不访问网络。
 *
 *   node scripts/build-places.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "data");
const workDir = path.join(tmpdir(), "ipp-places");
const CHINA_URLS = [
    "https://cdn.jsdelivr.net/gh/simonkuang/cn-pcas-geo@master/xzqh_with_amap_coordinates.json",
    "https://raw.githubusercontent.com/simonkuang/cn-pcas-geo/master/xzqh_with_amap_coordinates.json",
];
const GEONAMES = "https://download.geonames.org/export/dump";

const SKIP_CITY = new Set([
    "市辖区",
    "县",
    "省直辖县级行政区划",
    "自治区直辖县级行政区划",
]);

function round4(value) {
    return Math.round(value * 10000) / 10000;
}

async function download(url, file) {
    execFileSync("curl.exe", [
        "-L",
        "--fail",
        "--retry",
        "2",
        "--connect-timeout",
        "20",
        "--max-time",
        "600",
        "-sS",
        "-o",
        file,
        url,
    ], { stdio: "inherit" });
}

async function downloadFirst(urls, file) {
    let lastError;
    for (const url of urls) {
        try {
            await download(url, file);
            return url;
        } catch (error) {
            lastError = error;
            console.warn(`skip ${url}: ${error.message}`);
        }
    }
    throw lastError;
}

function unzip(zipFile, dest) {
    execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipFile.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
    ], { stdio: "inherit" });
}

function readCenter(node) {
    const center = node?.center || node?.location || node?.geo;
    if (!center) {
        return null;
    }
    const lng = Number(center.longitude ?? center.lng ?? center[0]);
    const lat = Number(center.latitude ?? center.lat ?? center[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }
    return { lat: round4(lat), lng: round4(lng) };
}

function walkChina(node, province, city, counties, cities) {
    if (!node || typeof node !== "object") {
        return;
    }
    const nodes = Array.isArray(node) ? node : [node];
    for (const item of nodes) {
        const name = String(item.name || item.fullname || "").trim();
        const level = String(item.level || "").toLowerCase();
        const center = readCenter(item);
        const children = item.children || item.districts || item.areas;
        let nextProvince = province;
        let nextCity = city;
        if (level === "province" || level === "1") {
            nextProvince = name;
            nextCity = "";
        } else if (level === "prefecture" || level === "city" || level === "2") {
            nextCity = SKIP_CITY.has(name) ? "" : name;
            if (center && nextProvince && nextCity) {
                cities.push([center.lat, center.lng, nextProvince, nextCity]);
            }
        } else if ((level === "county" || level === "district") && center && nextProvince && name) {
            const countyCity = SKIP_CITY.has(nextCity) ? "" : nextCity;
            counties.push([center.lat, center.lng, nextProvince, countyCity, name]);
        }
        if (children) {
            walkChina(children, nextProvince, nextCity, counties, cities);
        }
    }
}

function parseChina(raw) {
    const data = JSON.parse(raw);
    const counties = [];
    const cities = [];
    walkChina(data, "", "", counties, cities);
    return { counties, cities };
}

function parseAdmin1(text) {
    const map = new Map();
    for (const line of text.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) {
            continue;
        }
        const [code, name] = line.split("\t");
        if (code && name) {
            map.set(code, name);
        }
    }
    return map;
}

function parseCountries(text) {
    const map = new Map();
    for (const line of text.split(/\r?\n/)) {
        if (!line || line.startsWith("#")) {
            continue;
        }
        const parts = line.split("\t");
        if (parts.length > 4 && parts[0] && parts[4]) {
            map.set(parts[0], parts[4]);
        }
    }
    return map;
}

function parseCities(text, admin1, countries) {
    const world = [];
    for (const line of text.split(/\r?\n/)) {
        if (!line) {
            continue;
        }
        const parts = line.split("\t");
        if (parts.length < 11) {
            continue;
        }
        const name = parts[1];
        const lat = round4(Number(parts[4]));
        const lng = round4(Number(parts[5]));
        const countryCode = parts[8];
        const adminCode = parts[10];
        if (!name || !countryCode || !Number.isFinite(lat) || !Number.isFinite(lng)) {
            continue;
        }
        if (countryCode === "CN") {
            continue;
        }
        const country = countries.get(countryCode) || countryCode;
        const region = admin1.get(`${countryCode}.${adminCode}`) || "";
        const population = Number(parts[14]) || 0;
        world.push([lat, lng, name, region, country, population]);
    }
    return world;
}

async function loadChina() {
    if (process.argv.includes("--world-only")) {
        const existing = JSON.parse(await readFile(path.join(outDir, "places.json"), "utf8"));
        return { counties: existing.county || [], cities: existing.city || [] };
    }
    const chinaFile = path.join(workDir, "china.json");
    const chinaUrl = await downloadFirst(CHINA_URLS, chinaFile);
    console.log(`china <= ${chinaUrl}`);
    const china = parseChina(await readFile(chinaFile, "utf8"));
    if (china.counties.length < 1000) {
        throw new Error(`county centers too few: ${china.counties.length}`);
    }
    return china;
}

async function main() {
    await rm(workDir, { recursive: true, force: true });
    await mkdir(workDir, { recursive: true });
    await mkdir(outDir, { recursive: true });

    const china = await loadChina();

    const citiesZip = path.join(workDir, "cities15000.zip");
    const adminFile = path.join(workDir, "admin1CodesASCII.txt");
    const countryFile = path.join(workDir, "countryInfo.txt");
    await download(`${GEONAMES}/cities15000.zip`, citiesZip);
    await download(`${GEONAMES}/admin1CodesASCII.txt`, adminFile);
    await download(`${GEONAMES}/countryInfo.txt`, countryFile);
    unzip(citiesZip, workDir);

    const world = parseCities(
        await readFile(path.join(workDir, "cities15000.txt"), "utf8"),
        parseAdmin1(await readFile(adminFile, "utf8")),
        parseCountries(await readFile(countryFile, "utf8")),
    );
    if (world.length < 10000) {
        throw new Error(`world cities too few: ${world.length}`);
    }

    const places = {
        county: china.counties,
        city: china.cities,
        world,
    };
    const json = JSON.stringify(places);
    await writeFile(path.join(outDir, "places.json"), json);
    await writeFile(path.join(outDir, "places.license.txt"), [
        "China county and city centers come from public administrative coordinates (GCJ-02).",
        "Source: https://github.com/simonkuang/cn-pcas-geo",
        "",
        "World cities are from GeoNames cities15000, used under CC-BY 4.0.",
        "https://www.geonames.org/",
        "Mainland China cities are omitted here because the China table covers them.",
        "",
    ].join("\n"));

    console.log(`counties ${china.counties.length}, cities ${china.cities.length}, world ${world.length}`);
    console.log(`places.json ${(json.length / 1024 / 1024).toFixed(2)} MB`);
    await rm(workDir, { recursive: true, force: true });
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
