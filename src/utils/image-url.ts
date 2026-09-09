const THUMBNAIL_EXTENSIONS = [".png", ".jpg", ".jpeg", ".heic", ".heif"];

interface AssetURLParts {
    path: string;
    query?: string;
    fragment: string;
}

const parseAssetURL = (url: string): AssetURLParts | undefined => {
    const fragmentIndex = url.indexOf("#");
    const fragment = fragmentIndex === -1 ? "" : url.substring(fragmentIndex);
    const urlWithoutFragment = fragmentIndex === -1 ? url : url.substring(0, fragmentIndex);
    const queryIndex = urlWithoutFragment.indexOf("?");
    const path = queryIndex === -1 ? urlWithoutFragment : urlWithoutFragment.substring(0, queryIndex);
    if (!path.startsWith("assets/") || !THUMBNAIL_EXTENSIONS.some((extension) => path.toLowerCase().endsWith(extension))) {
        return;
    }
    return {
        path,
        query: queryIndex === -1 ? undefined : urlWithoutFragment.substring(queryIndex + 1),
        fragment,
    };
};

/** 去掉思源缩略图参数 `style=thumb`，与内核预览对齐。 */
export function removeCompressURL(url: string): string {
    if (!url) {
        return url;
    }
    const parts = parseAssetURL(url);
    if (!parts?.query) {
        return url;
    }
    const parameters = parts.query.split("&");
    const remainingParameters = parameters.filter((parameter) => parameter !== "style=thumb");
    if (remainingParameters.length === parameters.length) {
        return url;
    }
    const query = remainingParameters.length > 0 ? `?${remainingParameters.join("&")}` : "";
    return `${parts.path}${query}${parts.fragment}`;
}

export function normalizeImageSrc(src: string): string {
    if (!src) {
        return "";
    }
    let value = src.trim();
    try {
        value = decodeURI(value);
    } catch {
        // keep raw
    }
    value = removeCompressURL(value);
    try {
        const resolved = new URL(value, window.location.href);
        if (resolved.origin === window.location.origin) {
            value = `${resolved.pathname}${resolved.search}${resolved.hash}`;
            if (value.startsWith("/")) {
                value = value.substring(1);
            }
        }
    } catch {
        // keep raw
    }
    return value;
}

export function findImageIndex(list: string[], current: string): number {
    if (!list?.length) {
        return -1;
    }
    const currentNorm = normalizeImageSrc(current);
    if (!currentNorm) {
        return 0;
    }
    const exact = list.findIndex((item) => normalizeImageSrc(item) === currentNorm);
    if (exact >= 0) {
        return exact;
    }
    return list.findIndex((item) => {
        const itemNorm = normalizeImageSrc(item);
        return !!itemNorm && (currentNorm.endsWith(itemNorm) || itemNorm.endsWith(currentNorm)
            || currentNorm.includes(itemNorm) || itemNorm.includes(currentNorm));
    });
}

export function uniqueImageList(list: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const item of list || []) {
        if (!item) {
            continue;
        }
        const key = normalizeImageSrc(item) || item;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(removeCompressURL(item));
    }
    return result;
}

export function ensureCurrentInList(list: string[], current: string): { images: string[]; index: number } {
    const images = uniqueImageList(list);
    const currentSrc = removeCompressURL(current || "");
    if (!currentSrc) {
        return { images, index: 0 };
    }
    let index = findImageIndex(images, currentSrc);
    if (index < 0) {
        images.unshift(currentSrc);
        index = 0;
    }
    return { images, index };
}

export function getImageFileName(src: string): string {
    if (!src) {
        return "";
    }
    const normalized = normalizeImageSrc(src);
    const path = normalized.split(/[?#]/, 1)[0];
    const name = path.substring(path.lastIndexOf("/") + 1);
    return name.replace(/-\d{14}-\w{7}(?=\.)/, "");
}
