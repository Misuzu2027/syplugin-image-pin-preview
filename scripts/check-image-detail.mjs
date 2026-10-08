import { readJpegSampling, hasUltraHdr } from "../src/service/image/image-detail-binary.ts";
import {
    formatAperture,
    formatExposureBias,
    formatExposureTime,
    formatFileSize,
    formatFocalLength,
    formatGps,
    formatImageInfo,
    formatShotDate,
} from "../src/service/image/image-detail-format.ts";

const lat = 25 + 48 / 60 + 34.72 / 3600;
const lng = 113 + 1 / 60 + 37.41 / 3600;
const gps = formatGps(lat, lng, 0);
const expectedGps = `N 25°48'34.72", E 113°1'37.41" , 0m`;
if (gps !== expectedGps) {
    throw new Error(`gps ${gps}`);
}
if (formatExposureTime(1 / 33) !== "1/33 sec.") {
    throw new Error("shutter");
}
if (formatAperture(1.9) !== "f/1.9") {
    throw new Error("aperture");
}
if (formatExposureBias(0) !== "0.00 EV") {
    throw new Error("bias");
}
if (formatFocalLength(5.6) !== "5.6 mm") {
    throw new Error("focal");
}
if (formatFileSize(3.8 * 1024 * 1024) !== "3.8MB") {
    throw new Error(`size ${formatFileSize(3.8 * 1024 * 1024)}`);
}
if (formatShotDate("2026:10:08 06:50:59", "+08:00") !== "2026/10/08 06:50:59 (+08:00)") {
    throw new Error("shot");
}
const info = formatImageInfo(4096, 3072, "Jpeg", "YUV420", true, "Display P3");
if (info !== "4096x3072 (Jpeg, YUV420, Ultra HDR Jpeg, ICC profile(Display P3))") {
    throw new Error(info);
}

const jpeg = Uint8Array.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11,
    0x08,
    0x00, 0x08,
    0x00, 0x08,
    0x03,
    0x01, 0x22, 0x00,
    0x02, 0x11, 0x01,
    0x03, 0x11, 0x01,
    0xff, 0xd9,
]);
if (readJpegSampling(jpeg) !== "YUV420") {
    throw new Error(`sampling ${readJpegSampling(jpeg)}`);
}
const hdr = Uint8Array.from([
    ..."hdrgm:Version".split("").map((char) => char.charCodeAt(0)),
]);
if (!hasUltraHdr(hdr)) {
    throw new Error("hdr");
}
console.log("image detail format ok");
