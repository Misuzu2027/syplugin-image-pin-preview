const MOSAIC_CELL_SIZE = 32;
const MIN_MOSAIC_CELLS = 2;
const MAX_MOSAIC_CELLS = 8;

/** The display size is measured in CSS pixels, independent of the source resolution. */
export function getPrivacyMosaicCells(displayWidth: number, displayHeight: number): number {
    const cells = Math.floor(Math.max(displayWidth, displayHeight) / MOSAIC_CELL_SIZE);
    return Math.max(MIN_MOSAIC_CELLS, Math.min(MAX_MOSAIC_CELLS, cells));
}

/** Paint the low-resolution pixels directly so external images need no canvas readback. */
export function paintPrivacyMosaic(canvas: HTMLCanvasElement, image: HTMLImageElement | undefined, cells: number) {
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) {
        canvas.width = canvas.height = 1;
        return;
    }

    const scale = Math.min(0.5, cells / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (context) {
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
}
