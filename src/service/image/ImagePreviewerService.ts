export function getRotatedSize(width: number, height: number, rotate: number): { width: number; height: number } {
    return Math.abs(rotate % 180) === 90
        ? { width: height, height: width }
        : { width, height };
}

export function getVisualSize(naturalWidth: number, naturalHeight: number, scale: number, rotate: number) {
    return getRotatedSize(Math.max(1, naturalWidth * scale), Math.max(1, naturalHeight * scale), rotate);
}

const VIEW_FIT_RATIO = 0.9;

/** 刚好放进屏幕的最大缩放，小图可以大于 1。 */
export function getViewportContainScale(naturalWidth: number, naturalHeight: number, rotate = 0): number {
    if (!naturalWidth || !naturalHeight) {
        return 1;
    }
    const maxWidth = window.innerWidth * VIEW_FIT_RATIO;
    const maxHeight = window.innerHeight * VIEW_FIT_RATIO;
    const visual = getRotatedSize(naturalWidth, naturalHeight, rotate);
    return Math.min(maxWidth / visual.width, maxHeight / visual.height);
}

export function getViewportFitScale(naturalWidth: number, naturalHeight: number, rotate = 0): number {
    return Math.min(getViewportContainScale(naturalWidth, naturalHeight, rotate), 1);
}

export function clampDisplayScale(scale: number, naturalWidth: number, minWidth = 80, maxTimes = 100): number {
    if (!naturalWidth) {
        return scale;
    }
    const minScale = minWidth / naturalWidth;
    return Math.min(maxTimes, Math.max(minScale, scale));
}

export function zoomKeepPoint(
    oldRect: DOMRect,
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
): number {
    if (!naturalWidth) {
        return 1;
    }
    const keepWidthScale = keepWidth / naturalWidth;
    const containScale = getViewportContainScale(naturalWidth, naturalHeight, rotate);
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
