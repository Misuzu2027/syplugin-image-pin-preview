export function getRotatedSize(width: number, height: number, rotate: number): { width: number; height: number } {
    return Math.abs(rotate % 180) === 90
        ? { width: height, height: width }
        : { width, height };
}

export function getVisualSize(naturalWidth: number, naturalHeight: number, scale: number, rotate: number) {
    return getRotatedSize(Math.max(1, naturalWidth * scale), Math.max(1, naturalHeight * scale), rotate);
}

const META_SCALE_REF_WIDTH = 420;
const META_SCALE_REF_HEIGHT = 240;
const META_SCALE_MIN = 0.55;

/** 信息条随图片可视盒子缩放，限制在可读范围内。 */
export function getMetaScale(width: number, height: number): number {
    const byWidth = width / META_SCALE_REF_WIDTH;
    const byHeight = height / META_SCALE_REF_HEIGHT;
    return Math.min(1, Math.max(META_SCALE_MIN, Math.min(byWidth, byHeight)));
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

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

export interface DockedShape {
    /** 单侧内凹圆角的实际半径，形状需要向两侧各外扩这么多。 */
    fillet: number;
    width: number;
    height: number;
    path: string;
}

/**
 * 吸附条的整体轮廓：顶边两端用内凹圆角与图片边缘相接，底部是大圆角。
 * 整条轮廓是一条闭合路径，避免多层半透明背景叠加出接缝。
 * 内凹圆角要与侧边相切才不会露出方角，所以底部圆角最多只能取 height - fillet。
 */
export function getDockedShape(width: number, height: number, fillet: number, radius = height): DockedShape {
    const w = Math.max(0, width);
    const h = Math.max(0, height);
    const f = Math.max(0, Math.min(fillet, h, w / 2));
    const r = Math.max(0, Math.min(radius, h - f, w / 2));
    const total = round2(w + f * 2);
    if (w <= 0 || h <= 0) {
        return { fillet: f, width: total, height: h, path: "" };
    }
    const arcIn = (x: number, y: number) => `A${round2(f)} ${round2(f)} 0 0 0 ${round2(x)} ${round2(y)}`;
    const arcOut = (x: number, y: number) => `A${round2(r)} ${round2(r)} 0 0 1 ${round2(x)} ${round2(y)}`;
    const path = ["M0 0", `H${total}`];
    if (f > 0) {
        path.push(arcIn(total - f, f));
    }
    path.push(`V${round2(h - r)}`);
    if (r > 0) {
        path.push(arcOut(total - f - r, h));
    }
    path.push(`H${round2(f + r)}`);
    if (r > 0) {
        path.push(arcOut(f, h - r));
    }
    path.push(`V${round2(f)}`);
    if (f > 0) {
        path.push(arcIn(0, 0));
    }
    path.push("Z");
    return { fillet: f, width: total, height: h, path: path.join(" ") };
}

/**
 * 角落吸附面板的轮廓：两条外边贴住图片的侧边与底边，相接处同样用内凹圆角过渡，朝图片内侧的那个角是凸圆角。
 * side 为面板贴住的水平方向，形状会向图片内侧外扩一个 fillet。
 */
export function getDockedCornerShape(
    width: number,
    height: number,
    fillet: number,
    radius: number,
    side: "left" | "right" = "left",
): DockedShape {
    const w = Math.max(0, width);
    const h = Math.max(0, height);
    const f = Math.max(0, Math.min(fillet, w, h));
    const r = Math.max(0, Math.min(radius, w - f, h - f));
    const total = round2(w + f);
    const totalHeight = round2(h + f);
    if (w <= 0 || h <= 0) {
        return { fillet: f, width: total, height: totalHeight, path: "" };
    }
    const mirrored = side === "right";
    const px = (x: number) => round2(mirrored ? total - x : x);
    const sweepIn = mirrored ? 1 : 0;
    const sweepOut = mirrored ? 0 : 1;
    const path = [`M${px(0)} 0`];
    if (f > 0) {
        path.push(`A${round2(f)} ${round2(f)} 0 0 ${sweepIn} ${px(f)} ${round2(f)}`);
    }
    path.push(`H${px(w - r)}`);
    if (r > 0) {
        path.push(`A${round2(r)} ${round2(r)} 0 0 ${sweepOut} ${px(w)} ${round2(f + r)}`);
    }
    path.push(`V${round2(h)}`);
    if (f > 0) {
        path.push(`A${round2(f)} ${round2(f)} 0 0 ${sweepIn} ${px(w + f)} ${totalHeight}`);
    }
    path.push(`H${px(0)}`, "Z");
    return { fillet: f, width: total, height: totalHeight, path: path.join(" ") };
}

export function imageFlipCss(rotate: number, flipH: boolean, flipV: boolean): string {
    const scaleX = flipH ? -1 : 1;
    const scaleY = flipV ? -1 : 1;
    return `translate(-50%, -50%) rotate(${rotate}deg) scale(${scaleX}, ${scaleY})`;
}
