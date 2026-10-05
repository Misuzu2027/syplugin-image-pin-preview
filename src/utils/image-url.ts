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

/** 与思源导出一致：给资源地址加上 `download=true`。 */
export function getDownloadURL(url: string): string {
    const fragmentIndex = url.indexOf("#");
    const fragment = fragmentIndex === -1 ? "" : url.substring(fragmentIndex);
    const urlWithoutFragment = fragmentIndex === -1 ? url : url.substring(0, fragmentIndex);
    const queryIndex = urlWithoutFragment.indexOf("?");
    const path = queryIndex === -1 ? urlWithoutFragment : urlWithoutFragment.substring(0, queryIndex);
    const parameters = new URLSearchParams(queryIndex === -1 ? "" : urlWithoutFragment.substring(queryIndex + 1));
    parameters.set("download", "true");
    return `${path}?${parameters.toString()}${fragment}`;
}

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

export function sameImageList(a: string[], b: string[]): boolean {
    if (!a?.length || !b?.length || a.length !== b.length) {
        return false;
    }
    return a.every((src, i) => findImageIndex([b[i]], src) === 0);
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

interface SameOriginAsset {
    path: string;
    box: string | null;
}

function readSameOriginAsset(src: string): SameOriginAsset | undefined {
    if (!src) {
        return;
    }
    try {
        const url = new URL(src, `${window.location.origin}/`);
        const path = decodeURIComponent(url.pathname);
        if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol)
            || !path.startsWith("/assets/") || path.includes("\\") || path.split("/").includes("..")) {
            return;
        }
        return {
            path: path.substring(1),
            box: url.searchParams.get("box"),
        };
    } catch {
        return;
    }
}

function formatAssetPath(asset: SameOriginAsset): string {
    return asset.path + (asset.box ? `?box=${encodeURIComponent(asset.box)}` : "");
}

/** 同源 assets 路径。加密笔记本资源返回空，调用方不提供重命名和 OCR。 */
export function getPreviewAssetPath(src: string): string | undefined {
    const asset = readSameOriginAsset(src);
    if (!asset) {
        return;
    }
    if (asset.box && window.siyuan?.notebooks?.some((item) => item.id === asset.box && item.encrypted)) {
        return;
    }
    return formatAssetPath(asset);
}

function escapeMarkdownAlt(name: string): string {
    return name.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/[\r\n]+/g, " ");
}

function markdownDestination(target: string): string {
    if (/[\s()]/.test(target)) {
        return `<${target.replace(/[<>]/g, "")}>`;
    }
    return target;
}

function readMarkdownAsset(src: string): SameOriginAsset | undefined {
    const sameOrigin = readSameOriginAsset(src);
    if (sameOrigin) {
        return sameOrigin;
    }
    try {
        const url = new URL(src, `${window.location.origin}/`);
        const path = decodeURIComponent(url.pathname);
        if (!["http:", "https:"].includes(url.protocol) || !isLocalAccessHost(url.hostname)
            || !path.startsWith("/assets/") || path.includes("\\") || path.split("/").includes("..")) {
            return;
        }
        return {
            path: path.substring(1),
            box: url.searchParams.get("box"),
        };
    } catch {
        return;
    }
}

/** 思源笔记里可直接粘贴的图片写法。同源资源用 `assets/` 路径，外链用原地址。 */
export function getSiYuanImageMarkdown(src: string, name = ""): string {
    const asset = readMarkdownAsset(src);
    const target = asset ? formatAssetPath(asset) : (getReachableImageURL(src) || src);
    return `![${escapeMarkdownAlt(name)}](${markdownDestination(target)})`;
}

function unwrapHost(hostname: string): string {
    return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function isLoopbackHost(hostname: string): boolean {
    const host = unwrapHost(hostname);
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
}

function isPrivateLanHost(hostname: string): boolean {
    const host = unwrapHost(hostname);
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!match) {
        return false;
    }
    const parts = match.slice(1).map((part) => Number(part));
    if (parts.some((part) => part > 255)) {
        return false;
    }
    const [a, b] = parts;
    return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254);
}

function isLocalAccessHost(hostname: string): boolean {
    return isLoopbackHost(hostname) || isPrivateLanHost(hostname);
}

function firstLanAddress(): string | undefined {
    const localIPs = (window.siyuan?.config?.system as { localIPs?: string[] } | undefined)?.localIPs;
    if (!Array.isArray(localIPs)) {
        return;
    }
    for (const item of localIPs) {
        const ip = String(item || "").trim().replace(/:\d+$/, "");
        if (ip && isPrivateLanHost(ip)) {
            return ip;
        }
    }
    return;
}

function hostWithPort(hostname: string, port: string): string {
    const host = unwrapHost(hostname);
    const formatted = host.includes(":") ? `[${host}]` : host;
    return port ? `${formatted}:${port}` : formatted;
}

/** 同源资源的绝对地址。回环或局域网主机换成当前还能打开的地址。外链保持原样。 */
export function getReachableImageURL(src: string): string {
    if (!src) {
        return "";
    }
    try {
        const url = new URL(src, window.location.href);
        const assetPath = decodeURIComponent(url.pathname);
        const isAsset = assetPath.startsWith("/assets/") && !assetPath.split("/").includes("..");
        const sameOrigin = url.origin === window.location.origin;
        if (!isLocalAccessHost(url.hostname) || (!sameOrigin && !isAsset)) {
            return url.href;
        }
        const nextHost = isLoopbackHost(window.location.hostname)
            ? hostWithPort(firstLanAddress() || window.location.hostname, url.port || window.location.port)
            : window.location.host;
        if (nextHost && nextHost !== url.host) {
            url.host = nextHost;
        }
        return url.href;
    } catch {
        return src;
    }
}

/** 把预览地址里的资源路径换成重命名后的新路径，保留原有查询和片段。 */
export function replaceAssetInSrc(src: string, oldPath: string, newPath: string): string {
    if (!src || !oldPath || !newPath) {
        return src;
    }
    const oldClean = oldPath.split("?")[0];
    const newClean = newPath.split("?")[0].replace(/\\/g, "/");
    try {
        const url = new URL(src, `${window.location.origin}/`);
        const path = decodeURIComponent(url.pathname).replace(/^\//, "");
        if (path !== oldClean) {
            return src;
        }
        const nextPath = `/${newClean}`;
        if (/^https?:/i.test(src)) {
            return `${url.origin}${nextPath}${url.search}${url.hash}`;
        }
        if (src.startsWith("/")) {
            return `${nextPath}${url.search}${url.hash}`;
        }
        return `${newClean}${url.search}${url.hash}`;
    } catch {
        return src;
    }
}

/** 与思源 Viewer 一致：去掉扩展名和资源 ID 后缀 `-\d{14}-\w{7}`。 */
export function getDisplayImageName(src: string): string {
    if (!src) {
        return "";
    }
    let name = "";
    try {
        const path = decodeURIComponent(normalizeImageSrc(src).split(/[?#]/, 1)[0]);
        name = path.substring(path.lastIndexOf("/") + 1);
    } catch {
        name = src.substring(src.lastIndexOf("/") + 1).split(/[?#]/, 1)[0];
    }
    const dot = name.lastIndexOf(".");
    if (dot > 0) {
        name = name.substring(0, dot);
    }
    return name.replace(/-\d{14}-\w{7}$/, "");
}

export function getImageFileName(src: string): string {
    return getDisplayImageName(src);
}
