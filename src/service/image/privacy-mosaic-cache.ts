import { paintPrivacyMosaic } from "./privacy-mosaic";

const MAX_CACHED_MOSAICS = 256;
const mosaics = new Map<string, string | null>();

/** A shared low-resolution raster for CSS, when the browser allows canvas export. */
export function getPrivacyMosaicImageURL(image: HTMLImageElement, cells: number): string | undefined {
    const source = image.currentSrc || image.src;
    if (!source || !image.complete || !image.naturalWidth || !image.naturalHeight) {
        return;
    }

    const key = JSON.stringify([source, image.crossOrigin, image.naturalWidth, image.naturalHeight, cells]);
    const cached = mosaics.get(key);
    if (cached !== undefined) {
        mosaics.delete(key);
        mosaics.set(key, cached);
        return cached ?? undefined;
    }

    const raster = exportMosaic(image, cells);
    mosaics.set(key, raster ?? null);
    if (mosaics.size > MAX_CACHED_MOSAICS) {
        const oldest = mosaics.keys().next();
        if (!oldest.done) {
            mosaics.delete(oldest.value);
        }
    }
    return raster;
}

function exportMosaic(image: HTMLImageElement, cells: number): string | undefined {
    const canvas = image.ownerDocument.createElement("canvas");
    if (!canvas.getContext("2d")) {
        return;
    }
    try {
        paintPrivacyMosaic(canvas, image, cells);
        const raster = canvas.toDataURL("image/png");
        return raster.startsWith("data:image/png;base64,") ? raster : undefined;
    } catch {
        // A tainted canvas can still be drawn and displayed by the caller.
        return;
    }
}
