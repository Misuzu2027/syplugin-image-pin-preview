function readUint16(bytes: Uint8Array, offset: number): number {
    return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number): number {
    return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function asciiAt(bytes: Uint8Array, offset: number, text: string): boolean {
    if (offset < 0 || offset + text.length > bytes.length) {
        return false;
    }
    for (let i = 0; i < text.length; i++) {
        if (bytes[offset + i] !== text.charCodeAt(i)) {
            return false;
        }
    }
    return true;
}

function latin1(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i < bytes.length; i++) {
        text += String.fromCharCode(bytes[i]);
    }
    return text.replace(/\u0000/g, "").trim();
}

function utf16be(bytes: Uint8Array): string {
    let text = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        const code = (bytes[i] << 8) | bytes[i + 1];
        if (code === 0) {
            break;
        }
        text += String.fromCharCode(code);
    }
    return text.trim();
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const profile = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        profile.set(chunk, offset);
        offset += chunk.length;
    }
    return profile;
}

function readDescTag(profile: Uint8Array, offset: number, size: number): string {
    if (offset < 0 || size < 12 || offset + 12 > profile.length) {
        return "";
    }
    const type = readUint32(profile, offset);
    if (type === 0x64657363) {
        const count = readUint32(profile, offset + 8);
        const start = offset + 12;
        const end = Math.min(profile.length, start + Math.max(0, count), offset + size);
        return latin1(profile.subarray(start, end));
    }
    if (type === 0x6d6c7563 && offset + 16 <= profile.length) {
        const records = readUint32(profile, offset + 8);
        const recordSize = readUint32(profile, offset + 12) || 12;
        let fallback = "";
        for (let i = 0; i < records && i < 8; i++) {
            const record = offset + 16 + i * recordSize;
            if (record + 12 > profile.length) {
                break;
            }
            const language = String.fromCharCode(profile[record], profile[record + 1]).toLowerCase();
            const length = readUint32(profile, record + 4);
            const stringOffset = readUint32(profile, record + 8);
            const start = offset + stringOffset;
            const end = Math.min(profile.length, start + length);
            if (start < 0 || end <= start) {
                continue;
            }
            const text = utf16be(profile.subarray(start, end));
            if (!fallback) {
                fallback = text;
            }
            if (language === "en" || language === "zh") {
                return text;
            }
        }
        return fallback;
    }
    return "";
}

function iccDescription(profile: Uint8Array): string {
    if (profile.length < 132) {
        return "";
    }
    const count = readUint32(profile, 128);
    if (!count || count > 2000) {
        return "";
    }
    for (let i = 0; i < count; i++) {
        const entry = 132 + i * 12;
        if (entry + 12 > profile.length) {
            break;
        }
        if (readUint32(profile, entry) !== 0x64657363) {
            continue;
        }
        return readDescTag(profile, readUint32(profile, entry + 4), readUint32(profile, entry + 8));
    }
    return "";
}

function walkJpeg(bytes: Uint8Array, visit: (marker: number, offset: number, length: number) => boolean | void): void {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
        return;
    }
    let offset = 2;
    while (offset + 4 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset++;
            continue;
        }
        while (bytes[offset + 1] === 0xff && offset + 2 < bytes.length) {
            offset++;
        }
        const marker = bytes[offset + 1];
        if (marker === 0xd9) {
            return;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            offset += 2;
            continue;
        }
        const length = readUint16(bytes, offset + 2);
        if (length < 2 || offset + 2 + length > bytes.length) {
            return;
        }
        if (visit(marker, offset + 4, length - 2) === false) {
            return;
        }
        offset += 2 + length;
    }
}

/** JPEG SOF 色度抽样。4:2:0 记为 YUV420。 */
export function readJpegSampling(bytes: Uint8Array): string {
    let sampling = "";
    walkJpeg(bytes, (marker, offset, length) => {
        const isSof = marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3 || marker === 0xc9 || marker === 0xca;
        if (!isSof || length < 6) {
            return;
        }
        const components = bytes[offset + 5];
        let yH = 0;
        let yV = 0;
        let cH = 0;
        let cV = 0;
        let chroma = false;
        let cursor = offset + 6;
        for (let i = 0; i < components && cursor + 2 < offset + length; i++) {
            const id = bytes[cursor];
            const sample = bytes[cursor + 1];
            const horizontal = sample >> 4;
            const vertical = sample & 0x0f;
            if (i === 0 || id === 1) {
                yH = horizontal;
                yV = vertical;
            } else if (!chroma) {
                cH = horizontal;
                cV = vertical;
                chroma = true;
            }
            cursor += 3;
        }
        if (yH === 2 && yV === 2 && cH === 1 && cV === 1) {
            sampling = "YUV420";
        } else if (yH === 2 && yV === 1 && cH === 1 && cV === 1) {
            sampling = "YUV422";
        } else if (yH === 1 && yV === 2 && cH === 1 && cV === 1) {
            sampling = "YUV440";
        } else if (yH === 1 && yV === 1 && (!chroma || (cH === 1 && cV === 1))) {
            sampling = "YUV444";
        }
        return false;
    });
    return sampling;
}

export function readJpegIccDescription(bytes: Uint8Array): string {
    const chunks: Uint8Array[] = [];
    let expected = 0;
    walkJpeg(bytes, (marker, offset, length) => {
        if (marker !== 0xe2 || length < 14 || !asciiAt(bytes, offset, "ICC_PROFILE")) {
            return;
        }
        const index = bytes[offset + 12];
        expected = bytes[offset + 13];
        if (index < 1 || index > 32) {
            return;
        }
        chunks[index - 1] = bytes.subarray(offset + 14, offset + length);
    });
    if (!chunks.length) {
        return "";
    }
    if (expected > 0 && chunks.slice(0, expected).some((chunk) => !chunk)) {
        return "";
    }
    return iccDescription(concatChunks(chunks.filter((chunk) => !!chunk)));
}

export function hasUltraHdr(bytes: Uint8Array): boolean {
    return includesAscii(bytes, "hdrgm:Version") || includesAscii(bytes, "Semantic=\"GainMap\"") || includesAscii(bytes, "Semantic='GainMap'");
}

function includesAscii(bytes: Uint8Array, needle: string): boolean {
    const codes: number[] = [];
    for (let i = 0; i < needle.length; i++) {
        codes.push(needle.charCodeAt(i));
    }
    const size = codes.length;
    if (!size || bytes.length < size) {
        return false;
    }
    const limit = bytes.length - size;
    for (let i = 0; i <= limit; i++) {
        if (bytes[i] !== codes[0]) {
            continue;
        }
        let matched = true;
        for (let j = 1; j < size; j++) {
            if (bytes[i + j] !== codes[j]) {
                matched = false;
                break;
            }
        }
        if (matched) {
            return true;
        }
    }
    return false;
}
