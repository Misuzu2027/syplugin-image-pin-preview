import { EnvConfig } from "@/config/EnvConfig";

type CountyPlace = [number, number, string, string, string];
type CityPlace = [number, number, string, string];
type WorldPlace = [number, number, string, string, string, number?];

interface PlacesFile {
    county?: CountyPlace[];
    city?: CityPlace[];
    world?: WorldPlace[];
}

interface PlaceGrid {
    county: Map<string, CountyPlace[]>;
    city: Map<string, CityPlace[]>;
    world: Map<string, WorldPlace[]>;
}

const COUNTY_KM = 100;
const CITY_KM = 180;
const WORLD_KM = 150;
const PI = Math.PI;
const EARTH_A = 6378245.0;
const EARTH_EE = 0.00669342162296594323;

let gridPromise: Promise<PlaceGrid | null> | null = null;

function cellKey(lat: number, lng: number): string {
    return `${Math.floor(lat)}:${Math.floor(lng)}`;
}

function addCell<T extends [number, number, ...string[]]>(grid: Map<string, T[]>, item: T) {
    const key = cellKey(item[0], item[1]);
    const list = grid.get(key);
    if (list) {
        list.push(item);
        return;
    }
    grid.set(key, [item]);
}

function buildGrid(file: PlacesFile): PlaceGrid {
    const grid: PlaceGrid = {
        county: new Map(),
        city: new Map(),
        world: new Map(),
    };
    for (const item of file.county || []) {
        if (item && Number.isFinite(item[0]) && Number.isFinite(item[1])) {
            addCell(grid.county, item);
        }
    }
    for (const item of file.city || []) {
        if (item && Number.isFinite(item[0]) && Number.isFinite(item[1])) {
            addCell(grid.city, item);
        }
    }
    for (const item of file.world || []) {
        if (item && Number.isFinite(item[0]) && Number.isFinite(item[1])) {
            addCell(grid.world, item);
        }
    }
    return grid;
}

function placesUrl(): string {
    const name = EnvConfig.ins.plugin?.name || "syplugin-image-pin-preview";
    return `/plugins/${name}/data/places.json`;
}

function loadGrid(): Promise<PlaceGrid | null> {
    if (!gridPromise) {
        gridPromise = fetch(placesUrl())
            .then((response) => {
                if (!response.ok) {
                    throw new Error(String(response.status));
                }
                return response.json() as Promise<PlacesFile>;
            })
            .then(buildGrid)
            .catch((error) => {
                gridPromise = null;
                console.log("图片悬浮预览插件读取城市对照表失败", error);
                return null;
            });
    }
    return gridPromise;
}

function outOfChina(lat: number, lng: number): boolean {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(lng: number, lat: number): number {
    let value = -100.0 + 2.0 * lng + 3.0 * lat + 0.2 * lat * lat + 0.1 * lng * lat + 0.2 * Math.sqrt(Math.abs(lng));
    value += (20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0 / 3.0;
    value += (20.0 * Math.sin(lat * PI) + 40.0 * Math.sin(lat / 3.0 * PI)) * 2.0 / 3.0;
    value += (160.0 * Math.sin(lat / 12.0 * PI) + 320 * Math.sin(lat * PI / 30.0)) * 2.0 / 3.0;
    return value;
}

function transformLng(lng: number, lat: number): number {
    let value = 300.0 + lng + 2.0 * lat + 0.1 * lng * lng + 0.1 * lng * lat + 0.1 * Math.sqrt(Math.abs(lng));
    value += (20.0 * Math.sin(6.0 * lng * PI) + 20.0 * Math.sin(2.0 * lng * PI)) * 2.0 / 3.0;
    value += (20.0 * Math.sin(lng * PI) + 40.0 * Math.sin(lng / 3.0 * PI)) * 2.0 / 3.0;
    value += (150.0 * Math.sin(lng / 12.0 * PI) + 300.0 * Math.sin(lng / 30.0 * PI)) * 2.0 / 3.0;
    return value;
}

/** 照片 GPS 是 WGS84，国内对照表是 GCJ-02。 */
export function wgs84ToGcj02(lat: number, lng: number): { lat: number; lng: number } {
    if (outOfChina(lat, lng)) {
        return { lat, lng };
    }
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = lat / 180.0 * PI;
    let magic = Math.sin(radLat);
    magic = 1 - EARTH_EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / ((EARTH_A * (1 - EARTH_EE)) / (magic * sqrtMagic) * PI);
    dLng = (dLng * 180.0) / (EARTH_A / sqrtMagic * Math.cos(radLat) * PI);
    return { lat: lat + dLat, lng: lng + dLng };
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const p1 = lat1 * PI / 180;
    const p2 = lat2 * PI / 180;
    const dLat = (lat2 - lat1) * PI / 180;
    const dLng = (lng2 - lng1) * PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function nearest<T extends [number, number, ...string[]]>(
    grid: Map<string, T[]>,
    lat: number,
    lng: number,
    maxKm: number,
): T | null {
    const radius = Math.ceil(maxKm / 50) + 1;
    const latCell = Math.floor(lat);
    const lngCell = Math.floor(lng);
    let best: T | null = null;
    let bestKm = Infinity;
    for (let dLat = -radius; dLat <= radius; dLat++) {
        for (let dLng = -radius; dLng <= radius; dLng++) {
            const list = grid.get(`${latCell + dLat}:${lngCell + dLng}`);
            if (!list) {
                continue;
            }
            for (const item of list) {
                const km = distanceKm(lat, lng, item[0], item[1]);
                if (km < bestKm) {
                    bestKm = km;
                    best = item;
                }
            }
        }
    }
    return best && bestKm <= maxKm ? best : null;
}

function joinDistinct(parts: string[], separator: string): string {
    const names: string[] = [];
    for (const part of parts) {
        const name = (part || "").trim();
        if (name && names[names.length - 1] !== name) {
            names.push(name);
        }
    }
    return names.join(separator);
}

function inChinaBox(lat: number, lng: number): boolean {
    return lat >= 0.8 && lat <= 55.9 && lng >= 72 && lng <= 137.9;
}

/** 用本地对照表把 WGS84 坐标解析到县或城市。没有足够近的结果时返回空字符串。 */
export async function locatePlace(lat: number, lng: number): Promise<string> {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return "";
    }
    const grid = await loadGrid();
    if (!grid) {
        return "";
    }
    let chinaName = "";
    let chinaKm = Infinity;
    if (inChinaBox(lat, lng)) {
        const gcj = wgs84ToGcj02(lat, lng);
        const county = nearestWithin(grid.county, gcj.lat, gcj.lng, COUNTY_KM);
        if (county) {
            chinaName = joinDistinct([county.item[2], county.item[3], county.item[4]], "");
            chinaKm = county.km;
        } else {
            const city = nearestWithin(grid.city, gcj.lat, gcj.lng, CITY_KM);
            if (city) {
                chinaName = joinDistinct([city.item[2], city.item[3]], "");
                chinaKm = city.km;
            }
        }
    }
    const world = locateWorld(grid.world, lat, lng);
    if (chinaName && (!world || chinaKm <= world.km)) {
        return chinaName;
    }
    return world?.name || "";
}

function nearestWithin<T extends [number, number, ...string[]]>(
    grid: Map<string, T[]>,
    lat: number,
    lng: number,
    maxKm: number,
): { item: T; km: number } | null {
    const item = nearest(grid, lat, lng, maxKm);
    if (!item) {
        return null;
    }
    return { item, km: distanceKm(lat, lng, item[0], item[1]) };
}

/** 近处有更大的城市时用它，避免落到巴黎区级地名。比较时仍用最近距离。 */
function locateWorld(grid: Map<string, WorldPlace[]>, lat: number, lng: number): { name: string; km: number } | null {
    const radius = Math.ceil(WORLD_KM / 50) + 1;
    const latCell = Math.floor(lat);
    const lngCell = Math.floor(lng);
    const candidates: { item: WorldPlace; km: number }[] = [];
    for (let dLat = -radius; dLat <= radius; dLat++) {
        for (let dLng = -radius; dLng <= radius; dLng++) {
            const list = grid.get(`${latCell + dLat}:${lngCell + dLng}`);
            if (!list) {
                continue;
            }
            for (const item of list) {
                const km = distanceKm(lat, lng, item[0], item[1]);
                if (km <= WORLD_KM) {
                    candidates.push({ item, km });
                }
            }
        }
    }
    if (!candidates.length) {
        return null;
    }
    candidates.sort((a, b) => a.km - b.km);
    const nearestKm = candidates[0].km;
    const windowKm = Math.min(WORLD_KM, Math.max(nearestKm * 4, 20));
    let best = candidates[0].item;
    let bestPopulation = best[5] || 0;
    for (const candidate of candidates) {
        if (candidate.km > windowKm) {
            break;
        }
        const population = candidate.item[5] || 0;
        if (population > bestPopulation) {
            best = candidate.item;
            bestPopulation = population;
        }
    }
    return {
        name: joinDistinct([best[2], best[3], best[4]], ", "),
        km: nearestKm,
    };
}
