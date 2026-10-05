export function getRotatedSize(width: number, height: number, rotate: number): { width: number; height: number } {
    return Math.abs(rotate % 180) === 90
        ? { width: height, height: width }
        : { width, height };
}

export function getVisualSize(naturalWidth: number, naturalHeight: number, scale: number, rotate: number) {
    return getRotatedSize(Math.max(1, naturalWidth * scale), Math.max(1, naturalHeight * scale), rotate);
}

export const PREVIEW_CHROME_HEAD = 0;
export const PREVIEW_CHROME_INFO = 28;
export const PREVIEW_CHROME_TOOLS = 40;
export const PREVIEW_CHROME_FOOT = PREVIEW_CHROME_INFO + PREVIEW_CHROME_TOOLS;
const PREVIEW_TOOL_BUTTON = 32;
const PREVIEW_TOOL_GAP = 2;
const PREVIEW_TOOL_PAD_X = 8;

/** 底栏按钮单行排开时需要的宽度，含左右内边距。 */
export function previewToolMinWidth(buttonCount: number): number {
    const count = Math.max(1, buttonCount);
    return count * PREVIEW_TOOL_BUTTON + (count - 1) * PREVIEW_TOOL_GAP + PREVIEW_TOOL_PAD_X * 2;
}

/** 当前宽度能排开的底栏按钮个数。 */
export function previewToolCapacity(width: number): number {
    const slot = PREVIEW_TOOL_BUTTON + PREVIEW_TOOL_GAP;
    const count = Math.floor((width - PREVIEW_TOOL_PAD_X * 2 + PREVIEW_TOOL_GAP) / slot);
    return Math.max(1, count);
}

export interface PreviewFrame {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
}

/** 卡片外框。窄图时加宽到能放下底栏，画面在卡片里水平居中。 */
export function getPreviewFrame(
    imageWidth: number,
    imageHeight: number,
    chrome: { head: number; foot: number; minWidth: number },
): PreviewFrame {
    const width = Math.max(imageWidth, chrome.minWidth);
    return {
        width,
        height: chrome.head + imageHeight + chrome.foot,
        offsetX: (width - imageWidth) / 2,
        offsetY: chrome.head,
    };
}

const VIEW_FIT_RATIO = 0.9;

/** 刚好放进屏幕的最大缩放，小图可以大于 1。 */
export function getViewportContainScale(
    naturalWidth: number,
    naturalHeight: number,
    rotate = 0,
    reservedHeight = 0,
): number {
    if (!naturalWidth || !naturalHeight) {
        return 1;
    }
    const maxWidth = window.innerWidth * VIEW_FIT_RATIO;
    const maxHeight = Math.max(1, window.innerHeight * VIEW_FIT_RATIO - Math.max(0, reservedHeight));
    const visual = getRotatedSize(naturalWidth, naturalHeight, rotate);
    return Math.min(maxWidth / visual.width, maxHeight / visual.height);
}

export function getViewportFitScale(
    naturalWidth: number,
    naturalHeight: number,
    rotate = 0,
    reservedHeight = 0,
): number {
    return Math.min(getViewportContainScale(naturalWidth, naturalHeight, rotate, reservedHeight), 1);
}

export function clampDisplayScale(scale: number, naturalWidth: number, minWidth = 80, maxTimes = 100): number {
    if (!naturalWidth) {
        return scale;
    }
    const minScale = minWidth / naturalWidth;
    return Math.min(maxTimes, Math.max(minScale, scale));
}

export function zoomKeepPoint(
    oldRect: { left: number; top: number; width: number; height: number },
    nextWidth: number,
    nextHeight: number,
    zoomPosition: { x: number; y: number },
): { x: number; y: number } {
    const ratioX = oldRect.width ? (zoomPosition.x - oldRect.left) / oldRect.width : 0.5;
    const ratioY = oldRect.height ? (zoomPosition.y - oldRect.top) / oldRect.height : 0.5;
    return {
        x: zoomPosition.x - nextWidth * ratioX,
        y: zoomPosition.y - nextHeight * ratioY,
    };
}

/** 双指缩放：优先用仍在图上的触点当锚点，避免外侧手指把图吸走。 */
export function pickPinchFocalPoints<T extends { x: number; y: number }>(
    points: T[],
    rect: { left: number; top: number; width: number; height: number },
    pad = 16,
): T[] {
    const inside = points.filter((point) => (
        point.x >= rect.left - pad
        && point.x <= rect.left + rect.width + pad
        && point.y >= rect.top - pad
        && point.y <= rect.top + rect.height + pad
    ));
    return inside.length > 0 ? inside : points;
}

export function averagePoints(points: { x: number; y: number }[]): { x: number; y: number } {
    if (!points.length) {
        return { x: 0, y: 0 };
    }
    let x = 0;
    let y = 0;
    for (const point of points) {
        x += point.x;
        y += point.y;
    }
    return { x: x / points.length, y: y / points.length };
}

export function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

/** 用 pinch 开始时冻结的锚点比例，让该图上的点跟着当前锚点走。 */
export function pinchZoomKeepFocal(
    startRect: { left: number; top: number; width: number; height: number },
    startFocal: { x: number; y: number },
    currentFocal: { x: number; y: number },
    nextWidth: number,
    nextHeight: number,
): { x: number; y: number } {
    const ratioX = startRect.width ? (startFocal.x - startRect.left) / startRect.width : 0.5;
    const ratioY = startRect.height ? (startFocal.y - startRect.top) / startRect.height : 0.5;
    return {
        x: currentFocal.x - nextWidth * ratioX,
        y: currentFocal.y - nextHeight * ratioY,
    };
}

export function keepCenter(
    oldX: number,
    oldY: number,
    oldWidth: number,
    oldHeight: number,
    nextWidth: number,
    nextHeight: number,
): { x: number; y: number } {
    return {
        x: oldX + oldWidth / 2 - nextWidth / 2,
        y: oldY + oldHeight / 2 - nextHeight / 2,
    };
}

export function clampFloatPosition(
    x: number,
    y: number,
    width: number,
    height: number,
    margin = 90,
): { x: number; y: number } {
    return {
        x: Math.min(Math.max(x, -width + margin), window.innerWidth - margin),
        y: Math.min(Math.max(y, -height + margin), window.innerHeight - margin),
    };
}

export function switchDisplayScale(
    naturalWidth: number,
    naturalHeight: number,
    keepWidth: number,
    rotate = 0,
    reservedHeight = 0,
): number {
    if (!naturalWidth) {
        return 1;
    }
    const keepWidthScale = keepWidth / naturalWidth;
    const containScale = getViewportContainScale(naturalWidth, naturalHeight, rotate, reservedHeight);
    return clampDisplayScale(Math.min(keepWidthScale, containScale), naturalWidth);
}

/** 图片能完整放下时，把整张图收进屏幕；超出时尽量多露出内容。 */
export function containFloatInViewport(
    x: number,
    y: number,
    width: number,
    height: number,
    padding = 8,
): { x: number; y: number } {
    const viewWidth = window.innerWidth;
    const viewHeight = window.innerHeight;
    let nextX = x;
    let nextY = y;

    if (width <= viewWidth - padding * 2) {
        nextX = Math.min(Math.max(x, padding), viewWidth - width - padding);
    } else if (width <= viewWidth) {
        nextX = Math.min(Math.max(x, 0), viewWidth - width);
    } else {
        nextX = (viewWidth - width) / 2;
    }

    if (height <= viewHeight - padding * 2) {
        nextY = Math.min(Math.max(y, padding), viewHeight - height - padding);
    } else if (height <= viewHeight) {
        nextY = Math.min(Math.max(y, 0), viewHeight - height);
    } else {
        nextY = padding;
    }

    return { x: nextX, y: nextY };
}

export function imageFlipCss(rotate: number, flipH: boolean, flipV: boolean): string {
    const scaleX = flipH ? -1 : 1;
    const scaleY = flipV ? -1 : 1;
    return `translate(-50%, -50%) rotate(${rotate}deg) scale(${scaleX}, ${scaleY})`;
}

export type NavSurface = "light" | "dark";

export interface NavSurfaces {
    prev: NavSurface;
    next: NavSurface;
    close: NavSurface;
}

const NAV_SAMPLE_WIDTH = 64;
const NAV_BUTTON_CENTER = 22;

function relativeLuminance(red: number, green: number, blue: number): number {
    const channel = (value: number) => {
        const scaled = value / 255;
        return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function themeBackdrop(): [number, number, number] {
    if (typeof document === "undefined") {
        return [255, 255, 255];
    }
    const raw = getComputedStyle(document.body).backgroundColor;
    const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(raw);
    if (!match) {
        return [255, 255, 255];
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function surfaceAt(
    pixels: Uint8ClampedArray,
    width: number,
    height: number,
    nx: number,
    ny: number,
    patch: number,
    backdrop: [number, number, number],
): NavSurface {
    const cx = Math.min(width - 1, Math.max(0, Math.round(nx * (width - 1))));
    const cy = Math.min(height - 1, Math.max(0, Math.round(ny * (height - 1))));
    const radius = Math.max(1, Math.floor(patch / 2));
    let total = 0;
    let count = 0;
    for (let y = cy - radius; y <= cy + radius; y++) {
        if (y < 0 || y >= height) {
            continue;
        }
        for (let x = cx - radius; x <= cx + radius; x++) {
            if (x < 0 || x >= width) {
                continue;
            }
            const index = (y * width + x) * 4;
            const alpha = pixels[index + 3] / 255;
            const red = pixels[index] * alpha + backdrop[0] * (1 - alpha);
            const green = pixels[index + 1] * alpha + backdrop[1] * (1 - alpha);
            const blue = pixels[index + 2] * alpha + backdrop[2] * (1 - alpha);
            total += relativeLuminance(red, green, blue);
            count++;
        }
    }
    return (count ? total / count : 1) >= 0.4 ? "light" : "dark";
}

/** 按按钮盖住的画面明暗，决定左右和关闭用深色还是浅色。 */
export function sampleNavSurface(
    image: HTMLImageElement,
    rotate: number,
    flipH: boolean,
    flipV: boolean,
    visualWidth: number,
    visualHeight: number,
): NavSurfaces | null {
    if (!image.naturalWidth || !image.naturalHeight || visualWidth < 1 || visualHeight < 1) {
        return null;
    }
    const turned = Math.abs(rotate % 180) === 90;
    const canvas = document.createElement("canvas");
    const longSide = NAV_SAMPLE_WIDTH;
    const width = visualWidth >= visualHeight ? longSide : Math.max(1, Math.round(longSide * visualWidth / visualHeight));
    const height = visualHeight > visualWidth ? longSide : Math.max(1, Math.round(longSide * visualHeight / visualWidth));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
        return null;
    }
    const drawWidth = turned ? height : width;
    const drawHeight = turned ? width : height;
    context.translate(width / 2, height / 2);
    context.rotate((rotate * Math.PI) / 180);
    context.scale(flipH ? -1 : 1, flipV ? -1 : 1);
    try {
        context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
        const pixels = context.getImageData(0, 0, width, height).data;
        const backdrop = themeBackdrop();
        const insetX = Math.min(0.42, NAV_BUTTON_CENTER / visualWidth);
        const insetY = Math.min(0.42, NAV_BUTTON_CENTER / visualHeight);
        const patch = Math.max(
            2,
            Math.round(32 / visualWidth * width),
            Math.round(32 / visualHeight * height),
        );
        return {
            prev: surfaceAt(pixels, width, height, insetX, 0.5, patch, backdrop),
            next: surfaceAt(pixels, width, height, 1 - insetX, 0.5, patch, backdrop),
            close: surfaceAt(pixels, width, height, 1 - insetX, insetY, patch, backdrop),
        };
    } catch {
        return null;
    }
}
