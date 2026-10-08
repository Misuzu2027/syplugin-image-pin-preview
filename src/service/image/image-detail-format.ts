export function formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return "";
    }
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    }
    if (bytes >= 1024) {
        const kb = bytes / 1024;
        return `${kb >= 100 ? Math.round(kb) : Number(kb.toFixed(1))}KB`;
    }
    return `${Math.round(bytes)}B`;
}

export function formatModified(header: string): string {
    if (!header) {
        return "";
    }
    const date = new Date(header);
    if (Number.isNaN(date.getTime())) {
        return "";
    }
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatShotDate(value: unknown, offset: unknown): string {
    let text = "";
    if (typeof value === "string") {
        text = value.replace(/\u0000/g, "").trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1/$2/$3");
    }
    if (!text) {
        return "";
    }
    const zone = typeof offset === "string" ? offset.replace(/\u0000/g, "").trim() : "";
    return zone ? `${text} (${zone})` : text;
}

export function formatDms(value: number): string {
    const sign = value < 0 ? -1 : 1;
    let rest = Math.abs(value);
    let degrees = Math.floor(rest);
    rest = (rest - degrees) * 60;
    let minutes = Math.floor(rest);
    let seconds = (rest - minutes) * 60;
    seconds = Math.round(seconds * 100) / 100;
    if (seconds >= 60) {
        seconds = 0;
        minutes += 1;
    }
    if (minutes >= 60) {
        minutes = 0;
        degrees += 1;
    }
    const secondText = seconds.toFixed(2);
    return `${sign < 0 ? "-" : ""}${degrees}°${minutes}'${secondText}"`;
}

export function formatGps(lat: number, lng: number, alt: number | null): string {
    const latText = `${lat >= 0 ? "N" : "S"} ${formatDms(Math.abs(lat))}`;
    const lngText = `${lng >= 0 ? "E" : "W"} ${formatDms(Math.abs(lng))}`;
    let text = `${latText}, ${lngText}`;
    if (alt != null && Number.isFinite(alt)) {
        text += ` , ${Math.round(alt)}m`;
    }
    return text;
}

export function formatFocalLength(value: number): string {
    const text = Number(value.toFixed(2)).toString();
    return `${text} mm`;
}

export function formatAperture(value: number): string {
    const text = value >= 10 ? value.toFixed(0) : value.toFixed(1);
    return `f/${text}`;
}

export function formatExposureTime(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return "";
    }
    if (seconds >= 1) {
        const text = seconds >= 10 ? String(Math.round(seconds)) : Number(seconds.toFixed(1)).toString();
        return `${text} sec.`;
    }
    const denominator = Math.max(1, Math.round(1 / seconds));
    return `1/${denominator} sec.`;
}

export function formatExposureBias(value: number): string {
    const text = value.toFixed(2);
    if (value > 0) {
        return `+${text} EV`;
    }
    return `${text} EV`;
}

export function formatImageInfo(
    width: number,
    height: number,
    format: string,
    sampling: string,
    ultraHdr: boolean,
    icc: string,
): string {
    if (!width || !height) {
        return "";
    }
    const parts: string[] = [];
    if (format) {
        parts.push(format);
    }
    if (sampling) {
        parts.push(sampling);
    }
    if (ultraHdr) {
        parts.push("Ultra HDR Jpeg");
    }
    if (icc) {
        parts.push(`ICC profile(${icc})`);
    }
    if (!parts.length) {
        return `${width}x${height}`;
    }
    return `${width}x${height} (${parts.join(", ")})`;
}

export function imageFormatName(src: string, mime: string): string {
    const type = (mime || "").split(";")[0].trim().toLowerCase();
    const clean = (src || "").split(/[?#]/, 1)[0].toLowerCase();
    const dot = clean.lastIndexOf(".");
    const ext = dot >= 0 ? clean.substring(dot + 1) : "";
    if (type.includes("jpeg") || ext === "jpg" || ext === "jpeg") {
        return "Jpeg";
    }
    if (type.includes("png") || ext === "png") {
        return "Png";
    }
    if (type.includes("webp") || ext === "webp") {
        return "Webp";
    }
    if (type.includes("gif") || ext === "gif") {
        return "Gif";
    }
    if (type.includes("heic") || type.includes("heif") || ext === "heic" || ext === "heif") {
        return "Heic";
    }
    if (type.includes("avif") || ext === "avif") {
        return "Avif";
    }
    if (type.includes("tiff") || ext === "tif" || ext === "tiff") {
        return "Tiff";
    }
    if (ext) {
        return ext.toUpperCase();
    }
    return "";
}
