import exifr from "exifr";
import {
    formatAperture,
    formatExposureBias,
    formatExposureTime,
    formatFileSize,
    formatFocalLength,
    formatGps,
    formatImageInfo,
    formatModified,
    formatShotDate,
    imageFormatName,
} from "./image-detail-format";
import { hasUltraHdr, readJpegIccDescription, readJpegSampling } from "./image-detail-binary";
import { locatePlace } from "./place-lookup";

export interface ImageDetailSource {
    src: string;
    fileName: string;
    indexLabel: string;
    width: number;
    height: number;
}

export interface ImageDetailRow {
    key: string;
    label: string;
    value: string;
}

export interface ImageDetailResult {
    rows: ImageDetailRow[];
    partial: boolean;
}

type Translate = (key: string, fallback: string) => string;

interface ParsedExif {
    make: string;
    model: string;
    shot: string;
    flash: number | null;
    focal: number | null;
    focal35: number | null;
    exposure: number | null;
    bias: number | null;
    aperture: number | null;
    iso: number | null;
    program: number | null;
    metering: number | null;
    lat: number | null;
    lng: number | null;
    alt: number | null;
    pixelWidth: number;
    pixelHeight: number;
}

interface ParsedFile {
    partial: boolean;
    size: number;
    modified: string;
    format: string;
    sampling: string;
    ultraHdr: boolean;
    icc: string;
    exif: ParsedExif | null;
}

const fileCache = new Map<string, Promise<ParsedFile>>();

const FLASH_TEXT: Record<number, [string, string]> = {
    0: ["flash0", "未闪光"],
    1: ["flash1", "已闪光"],
    5: ["flash5", "已闪光，未检测到返回光"],
    7: ["flash7", "已闪光，检测到返回光"],
    8: ["flash8", "闪光灯打开，未闪光"],
    9: ["flash9", "已闪光，强制闪光模式"],
    13: ["flash13", "已闪光，强制闪光模式，未检测到返回光"],
    15: ["flash15", "已闪光，强制闪光模式，检测到返回光"],
    16: ["flash16", "未闪光，强制闪光模式"],
    20: ["flash20", "未闪光，强制闪光模式，未检测到返回光"],
    24: ["flash24", "未闪光，自动模式"],
    25: ["flash25", "已闪光，自动模式"],
    29: ["flash29", "已闪光，自动模式，未检测到返回光"],
    31: ["flash31", "已闪光，自动模式，检测到返回光"],
    32: ["flash32", "无闪光灯"],
    48: ["flash48", "未闪光，无闪光灯"],
    65: ["flash65", "已闪光，红眼减弱"],
    69: ["flash69", "已闪光，红眼减弱，未检测到返回光"],
    71: ["flash71", "已闪光，红眼减弱，检测到返回光"],
    73: ["flash73", "已闪光，强制闪光模式，红眼减弱"],
    77: ["flash77", "已闪光，强制闪光模式，红眼减弱，未检测到返回光"],
    79: ["flash79", "已闪光，强制闪光模式，红眼减弱，检测到返回光"],
    80: ["flash80", "未闪光，红眼减弱"],
    88: ["flash88", "未闪光，自动模式，红眼减弱"],
    89: ["flash89", "已闪光，自动模式，红眼减弱"],
    93: ["flash93", "已闪光，自动模式，红眼减弱，未检测到返回光"],
    95: ["flash95", "已闪光，自动模式，红眼减弱，检测到返回光"],
};

const PROGRAM_TEXT: Record<number, [string, string]> = {
    0: ["exposureProgram0", "未定义"],
    1: ["exposureProgram1", "手动"],
    2: ["exposureProgram2", "正常程序"],
    3: ["exposureProgram3", "光圈优先"],
    4: ["exposureProgram4", "快门优先"],
    5: ["exposureProgram5", "创意程序"],
    6: ["exposureProgram6", "运动程序"],
    7: ["exposureProgram7", "人像模式"],
    8: ["exposureProgram8", "风景模式"],
};

const METER_TEXT: Record<number, [string, string]> = {
    0: ["metering0", "未知"],
    1: ["metering1", "平均测光"],
    2: ["metering2", "中央重点平均测光"],
    3: ["metering3", "点测光"],
    4: ["metering4", "多点测光"],
    5: ["metering5", "矩阵测光"],
    6: ["metering6", "局部测光"],
    255: ["metering255", "其他"],
};

function asNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
        return Number(value);
    }
    if (Array.isArray(value)) {
        return value.length ? asNumber(value[0]) : null;
    }
    if (value && typeof value === "object") {
        const ratio = value as { numerator?: unknown; denominator?: unknown };
        const numerator = asNumber(ratio.numerator);
        const denominator = asNumber(ratio.denominator);
        if (numerator != null && denominator) {
            return numerator / denominator;
        }
    }
    return null;
}

function asText(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }
    return value.replace(/\u0000/g, "").trim();
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = asNumber(record[key]);
        if (value != null) {
            return value;
        }
    }
    return null;
}

function enumText(table: Record<number, [string, string]>, value: number | null, t: Translate): string {
    if (value == null) {
        return "";
    }
    const item = table[value];
    if (!item) {
        return "";
    }
    return t(item[0], item[1]);
}

function emptyExif(): ParsedExif {
    return {
        make: "",
        model: "",
        shot: "",
        flash: null,
        focal: null,
        focal35: null,
        exposure: null,
        bias: null,
        aperture: null,
        iso: null,
        program: null,
        metering: null,
        lat: null,
        lng: null,
        alt: null,
        pixelWidth: 0,
        pixelHeight: 0,
    };
}

function readExif(record: Record<string, unknown> | null): ParsedExif | null {
    if (!record) {
        return null;
    }
    const exif = emptyExif();
    exif.make = asText(record.Make);
    exif.model = asText(record.Model);
    exif.shot = formatShotDate(
        record.DateTimeOriginal || record.CreateDate || record.DateTime,
        record.OffsetTimeOriginal || record.OffsetTimeDigitized || record.OffsetTime,
    );
    exif.flash = asNumber(record.Flash);
    exif.focal = firstNumber(record, ["FocalLength"]);
    exif.focal35 = firstNumber(record, ["FocalLengthIn35mmFormat", "FocalLengthIn35mmFilm"]);
    exif.exposure = firstNumber(record, ["ExposureTime"]);
    exif.bias = firstNumber(record, ["ExposureCompensation", "ExposureBiasValue"]);
    exif.aperture = firstNumber(record, ["FNumber"]);
    exif.iso = firstNumber(record, ["ISO", "ISOSpeedRatings", "PhotographicSensitivity"]);
    exif.program = firstNumber(record, ["ExposureProgram"]);
    exif.metering = firstNumber(record, ["MeteringMode"]);
    exif.lat = readCoordinate(record, ["latitude"], "GPSLatitude", "GPSLatitudeRef");
    exif.lng = readCoordinate(record, ["longitude"], "GPSLongitude", "GPSLongitudeRef");
    exif.alt = firstNumber(record, ["GPSAltitude", "Altitude"]);
    const altRef = asNumber(record.GPSAltitudeRef);
    if (exif.alt != null && altRef === 1) {
        exif.alt = -Math.abs(exif.alt);
    }
    exif.pixelWidth = firstNumber(record, ["ExifImageWidth", "ImageWidth", "PixelXDimension"]) || 0;
    exif.pixelHeight = firstNumber(record, ["ExifImageHeight", "ImageHeight", "PixelYDimension"]) || 0;
    return exif;
}

function readCoordinate(record: Record<string, unknown>, decimalKeys: string[], dmsKey: string, refKey: string): number | null {
    for (const key of decimalKeys) {
        const value = record[key];
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
    }
    const dms = record[dmsKey];
    if (!Array.isArray(dms) || dms.length < 3) {
        return null;
    }
    const degrees = asNumber(dms[0]) || 0;
    const minutes = asNumber(dms[1]) || 0;
    const seconds = asNumber(dms[2]) || 0;
    let value = degrees + minutes / 60 + seconds / 3600;
    const ref = asText(record[refKey]).toUpperCase();
    if (ref === "S" || ref === "W") {
        value = -Math.abs(value);
    }
    return value;
}

async function parseFile(src: string): Promise<ParsedFile> {
    // 用预览图同一条地址。改写成局域网 IP 时，本机思源往往连不上，详情会整段失败。
    const response = await fetch(src);
    if (!response.ok) {
        throw new Error(String(response.status));
    }
    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const format = imageFormatName(src, response.headers.get("content-type") || "");
    let record: Record<string, unknown> | null = null;
    try {
        record = await exifr.parse(bytes, {
            tiff: true,
            exif: true,
            gps: true,
            xmp: false,
            icc: true,
            iptc: false,
            makerNote: false,
            interop: false,
            mergeOutput: true,
            reviveValues: false,
            translateValues: false,
            translateKeys: true,
        }) as Record<string, unknown> | null;
    } catch {
        record = null;
    }
    const icc = asText(record?.ProfileDescription) || (format === "Jpeg" ? readJpegIccDescription(bytes) : "");
    return {
        partial: false,
        size: bytes.byteLength,
        modified: formatModified(response.headers.get("last-modified") || ""),
        format,
        sampling: format === "Jpeg" ? readJpegSampling(bytes) : "",
        ultraHdr: format === "Jpeg" && hasUltraHdr(bytes),
        icc,
        exif: readExif(record),
    };
}

function loadFile(src: string): Promise<ParsedFile> {
    const cached = fileCache.get(src);
    if (cached) {
        return cached;
    }
    const pending = parseFile(src).catch((error) => {
        fileCache.delete(src);
        throw error;
    });
    fileCache.set(src, pending);
    return pending;
}

function pushRow(rows: ImageDetailRow[], key: string, label: string, value: string) {
    if (!value) {
        return;
    }
    rows.push({ key, label, value });
}

async function composeRows(source: ImageDetailSource, file: ParsedFile | null, t: Translate): Promise<ImageDetailRow[]> {
    const rows: ImageDetailRow[] = [];
    const fileName = source.indexLabel ? `${source.fileName} ${source.indexLabel}` : source.fileName;
    pushRow(rows, "fileName", t("detailFileName", "文件名"), fileName);
    const exif = file?.exif;
    const width = source.width || exif?.pixelWidth || 0;
    const height = source.height || exif?.pixelHeight || 0;
    if (file && !file.partial) {
        pushRow(rows, "fileSize", t("detailFileSize", "图片大小"), formatFileSize(file.size));
        pushRow(rows, "modified", t("detailModified", "修改日期"), file.modified);
    }
    pushRow(
        rows,
        "imageInfo",
        t("detailImageInfo", "图片信息"),
        formatImageInfo(width, height, file?.format || imageFormatName(source.src, ""), file?.sampling || "", !!file?.ultraHdr, file?.icc || ""),
    );
    if (!exif) {
        return rows;
    }
    pushRow(rows, "make", t("detailMake", "相机制造商"), exif.make);
    pushRow(rows, "model", t("detailModel", "相机型号"), exif.model);
    pushRow(rows, "shot", t("detailShotDate", "拍摄日期"), exif.shot);
    pushRow(rows, "flash", t("detailFlash", "闪光灯"), enumText(FLASH_TEXT, exif.flash, t));
    pushRow(rows, "focal", t("detailFocalLength", "焦距"), exif.focal != null ? formatFocalLength(exif.focal) : "");
    pushRow(rows, "focal35", t("detailFocalLength35", "焦距 (35mm)"), exif.focal35 != null ? String(Math.round(exif.focal35)) : "");
    pushRow(rows, "shutter", t("detailShutter", "快门速度"), exif.exposure != null ? formatExposureTime(exif.exposure) : "");
    pushRow(rows, "bias", t("detailExposureBias", "曝光偏差"), exif.bias != null ? formatExposureBias(exif.bias) : "");
    pushRow(rows, "aperture", t("detailFNumber", "光圈数"), exif.aperture != null ? formatAperture(exif.aperture) : "");
    pushRow(rows, "iso", t("detailIso", "ISO 感光度"), exif.iso != null ? String(Math.round(exif.iso)) : "");
    pushRow(rows, "program", t("detailExposureProgram", "曝光程序"), enumText(PROGRAM_TEXT, exif.program, t));
    pushRow(rows, "metering", t("detailMetering", "测光模式"), enumText(METER_TEXT, exif.metering, t));
    if (exif.lat != null && exif.lng != null) {
        pushRow(rows, "gps", t("detailGps", "GPS 信息"), formatGps(exif.lat, exif.lng, exif.alt));
        pushRow(rows, "place", t("detailPlace", "位置"), await locatePlace(exif.lat, exif.lng));
    }
    return rows;
}

export async function loadImageDetail(source: ImageDetailSource, t: Translate): Promise<ImageDetailResult> {
    if (!source.src) {
        return { rows: [], partial: true };
    }
    try {
        const file = await loadFile(source.src);
        return { rows: await composeRows(source, file, t), partial: false };
    } catch (error) {
        console.log("图片悬浮预览插件读取图片详情失败", source.src, error);
        return { rows: await composeRows(source, null, t), partial: true };
    }
}
