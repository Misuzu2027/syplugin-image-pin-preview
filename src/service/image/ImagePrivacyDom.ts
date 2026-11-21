import { EnvConfig } from "@/config/EnvConfig";
import { getImagePrivacyKey, privateImages } from "./ImagePrivacyService";
import { getPrivacyMosaicCells, paintPrivacyMosaic } from "./privacy-mosaic";
import { getPrivacyMosaicImageURL } from "./privacy-mosaic-cache";
import maskStyles from "./image-privacy-mask.scss?inline";
import "./image-privacy-dom.scss";

const IMAGE_SELECTOR = [
    ".protyle-wysiwyg img:not(.emoji)",
    ".protyle-preview img:not(.emoji)",
    ".table__cell-rich img:not(.emoji)",
    'span.img[data-type*="img"] img:not(.emoji)',
    "img.av__cellassetimg",
    "img.av__gallery-img",
    '.av__panel [data-type="openAssetItem"] img',
    ".viewer-container img",
].join(", ");
const NATIVE_VIEWER = ".viewer-container";
const NATIVE_MAIN_IMAGE = ".viewer-canvas img";
const NATIVE_PASSIVE_IMAGE = ".viewer-list img, .viewer-player img, .viewer-magnifier img";
const MASK_CLASS = "ipp-privacy-dom-mask";
const HOST_CLASS = "ipp-privacy-local-host";
const LOCKED_CLASS = "ipp-privacy-mask-content--locked";
const RASTER_CLASS = "ipp-privacy-mask-content--raster";
const LOCK_ICON_PATH = "M7 10V7a5 5 0 0 1 10 0v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1Zm2 0h6V7a3 3 0 0 0-6 0v3Zm-3 2v8h12v-8H6Zm5 2h2v4h-2v-4Z";

interface ImageOccurrence {
    key: string;
    source: string;
    image: HTMLImageElement;
    host: HTMLElement;
    viewer: Element | null;
    carrier: HTMLElement;
    mask: HTMLElement;
    button?: HTMLButtonElement;
    coverBackground: string;
    backgroundImage?: HTMLImageElement;
    mosaicCells?: number;
    geometryObserver: MutationObserver;
    concealment?: Animation;
    revealed: boolean;
}

const occurrences = new Map<HTMLImageElement, ImageOccurrence>();
const hosts = new Map<HTMLElement, Set<ImageOccurrence>>();
const viewers = new Map<Element, Set<ImageOccurrence>>();
const maskOwners = new WeakMap<Element, HTMLImageElement>();
const dirty = new Set<ImageOccurrence>();
const dirtyViewers = new Set<Element>();
let keys: ReadonlySet<string> = new Set();
let unsubscribe: (() => void) | undefined;
let observer: MutationObserver | undefined;
let resizeObserver: ResizeObserver | undefined;
let frame: number | undefined;
let maskSheet: CSSStyleSheet | undefined;

export function initImagePrivacyDom() {
    unsubscribe ??= privateImages.subscribe((next) => {
        keys = next;
        if (!keys.size) {
            stopObserving();
            return;
        }
        startObserving();
        const images = new Set<HTMLImageElement>();
        collectImages(document.body, images);
        images.forEach((image) => inspectImage(image));
    });
}

export function destroyImagePrivacyDom() {
    unsubscribe?.();
    unsubscribe = undefined;
    keys = new Set();
    stopObserving();
}

export function relockImagePrivacyDom() {
    for (const occurrence of occurrences.values()) {
        if (occurrence.revealed) setRevealed(occurrence, false);
    }
}

function startObserving() {
    if (observer) return;
    resizeObserver = new ResizeObserver((entries) => {
        for (const { target } of entries) {
            if (target instanceof HTMLImageElement) {
                const occurrence = occurrences.get(target);
                if (occurrence) queueLayout(occurrence);
            } else if (target instanceof HTMLElement) {
                for (const occurrence of hosts.get(target) || []) queueLayout(occurrence);
            }
        }
    });
    observer = new MutationObserver(handleMutations);
    observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src", "srcset", "data-src", "data-original-url", "data-cover-url"],
    });
    document.addEventListener("load", handleImageLoad, true);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("play", guardLivePhoto, true);
}

function stopObserving() {
    observer?.disconnect();
    observer = undefined;
    resizeObserver?.disconnect();
    resizeObserver = undefined;
    for (const occurrence of occurrences.values()) forget(occurrence);
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    dirty.clear();
    document.removeEventListener("load", handleImageLoad, true);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("play", guardLivePhoto, true);
}

function getCoverBackground(image: HTMLImageElement) {
    return image.matches("img.av__gallery-img")
        ? image.style.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/)?.[1] || ""
        : "";
}

function inspectImage(image: HTMLImageElement, loaded = false) {
    const existing = occurrences.get(image);
    const host = image.parentElement;
    if (!host || !image.isConnected || !image.matches(IMAGE_SELECTOR)) {
        if (existing) forget(existing);
        return;
    }
    const coverBackground = getCoverBackground(image);
    const sources = [
        image.getAttribute("data-original-url"),
        coverBackground,
        image.getAttribute("src"),
        image.getAttribute("data-src"),
        image.currentSrc,
    ];
    let key = "";
    for (const src of sources) {
        if (!src) continue;
        const candidate = getImagePrivacyKey(src);
        if (keys.has(candidate)) {
            key = candidate;
            break;
        }
    }
    const source = [...sources, image.getAttribute("srcset")].join("\0");
    if (existing && key === existing.key && source === existing.source &&
        host === existing.host && image.nextElementSibling === existing.carrier) {
        if (loaded && !coverBackground) queueLayout(existing);
        return;
    }
    if (existing) forget(existing);
    if (!key) return;
    attachMask(image, host, key, source, coverBackground);
}

function collectImages(root: Element, images: Set<HTMLImageElement>) {
    if (root instanceof HTMLImageElement) {
        images.add(root);
        return;
    }
    if (root.classList.contains(MASK_CLASS)) {
        removeClonedMask(root);
        return;
    }
    root.querySelectorAll<HTMLImageElement>(IMAGE_SELECTOR).forEach((image) => images.add(image));
    root.querySelectorAll(`.${MASK_CLASS}`).forEach(removeClonedMask);
}

function removeClonedMask(carrier: Element) {
    if (maskOwners.has(carrier)) return;
    const host = carrier.parentElement;
    carrier.remove();
    if (host && !hosts.has(host)) host.classList.remove(HOST_CLASS);
}

function handleMutations(records: MutationRecord[]) {
    const images = new Set<HTMLImageElement>();
    for (const record of records) {
        if (record.type === "attributes") {
            if (record.target instanceof HTMLImageElement) {
                images.add(record.target);
            } else if (record.attributeName === "data-cover-url" && record.target instanceof Element) {
                record.target.querySelectorAll<HTMLImageElement>("img.av__gallery-img").forEach((image) => images.add(image));
            }
            continue;
        }
        for (const node of record.addedNodes) {
            if (node instanceof Element) collectImages(node, images);
        }
        for (const node of record.removedNodes) {
            if (node instanceof HTMLImageElement) {
                if (occurrences.has(node)) images.add(node);
            } else if (node instanceof Element) {
                const image = maskOwners.get(node);
                if (image && occurrences.get(image)?.carrier === node) images.add(image);
                node.querySelectorAll("img").forEach((removed) => {
                    if (occurrences.has(removed)) images.add(removed);
                });
            }
        }
    }
    images.forEach((image) => inspectImage(image));
}

function handleImageLoad(event: Event) {
    if (event.target instanceof HTMLImageElement) inspectImage(event.target, true);
}

function attachMask(image: HTMLImageElement, host: HTMLElement, key: string, source: string, coverBackground: string) {
    const carrier = document.createElement("span");
    carrier.className = MASK_CLASS;
    carrier.contentEditable = "false";
    // Undo and SiYuan's own clipboard can clone raw HTML. Keep controls and raster data out of that HTML.
    const shadow = carrier.attachShadow({ mode: "open" });
    if ("adoptedStyleSheets" in shadow && typeof CSSStyleSheet.prototype.replaceSync === "function") {
        if (!maskSheet) {
            maskSheet = new CSSStyleSheet();
            maskSheet.replaceSync(maskStyles);
        }
        shadow.adoptedStyleSheets = [maskSheet];
    } else {
        const style = document.createElement("style");
        style.textContent = maskStyles;
        shadow.append(style);
    }

    const mask = document.createElement("div");
    mask.className = "ipp-privacy-mask-content";
    shadow.append(mask);
    const viewer = image.closest(NATIVE_VIEWER);
    const geometryObserver = new MutationObserver(() => {
        if (image.classList.contains("av__gallery-img")) inspectImage(image);
        const occurrence = occurrences.get(image);
        if (occurrence) queueLayout(occurrence);
    });
    const occurrence: ImageOccurrence = {
        key, source, image, host, viewer, carrier, mask, coverBackground, geometryObserver, revealed: false,
    };
    if (!image.matches(NATIVE_PASSIVE_IMAGE)) occurrence.button = appendUnlockButton(occurrence);
    occurrences.set(image, occurrence);
    maskOwners.set(carrier, image);
    let siblings = hosts.get(host);
    if (!siblings) {
        if (getComputedStyle(host).position === "static") host.classList.add(HOST_CLASS);
        resizeObserver?.observe(host);
        siblings = new Set();
        hosts.set(host, siblings);
    }
    siblings.add(occurrence);
    if (viewer) {
        let slides = viewers.get(viewer);
        if (!slides) viewers.set(viewer, slides = new Set());
        slides.add(occurrence);
    }
    image.after(carrier);
    setRevealed(occurrence, false);
    resizeObserver?.observe(image);
    geometryObserver.observe(image, { attributes: true, attributeFilter: ["style", "class", "width", "height"] });
    if (coverBackground) {
        const background = new Image();
        occurrence.backgroundImage = background;
        background.onload = () => {
            if (occurrences.get(image) === occurrence) queueLayout(occurrence);
        };
        background.src = coverBackground;
    }
}

function appendUnlockButton(occurrence: ImageOccurrence) {
    const button = document.createElement("button");
    button.type = "button";
    const label = EnvConfig.ins.i18n?.privacyUnlock || "解锁查看";
    button.setAttribute("aria-label", label);
    button.title = label;
    button.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24"><path d="${LOCK_ICON_PATH}"></path></svg>`;
    const text = document.createElement("span");
    text.textContent = label;
    button.append(text);
    button.addEventListener("pointerdown", (event) => event.stopPropagation());
    button.addEventListener("click", (event) => {
        event.stopPropagation();
        if (occurrences.get(occurrence.image) === occurrence) setRevealed(occurrence, true);
    });
    button.addEventListener("dblclick", (event) => event.stopPropagation());
    occurrence.mask.append(button);
    return button;
}

function renderMosaic(occurrence: ImageOccurrence, source: HTMLImageElement, cells: number) {
    if (occurrence.revealed || occurrence.mosaicCells === cells) return;
    if (!source.complete || !source.naturalWidth || !source.naturalHeight) return;
    const { mask } = occurrence;
    const raster = getPrivacyMosaicImageURL(source, cells);
    const canvas = mask.querySelector("canvas");
    if (raster) {
        mask.style.setProperty("--ipp-privacy-raster", `url("${raster}")`);
        mask.classList.add(RASTER_CLASS);
        canvas?.remove();
    } else {
        mask.classList.remove(RASTER_CLASS);
        const fallback = canvas || document.createElement("canvas");
        fallback.setAttribute("aria-hidden", "true");
        paintPrivacyMosaic(fallback, source, cells);
        if (!canvas) mask.prepend(fallback);
    }
    occurrence.mosaicCells = cells;
}

function setRevealed(occurrence: ImageOccurrence, revealed: boolean) {
    occurrence.revealed = revealed;
    occurrence.mask.classList.toggle(LOCKED_CLASS, !revealed);
    if (revealed) {
        occurrence.concealment?.cancel();
        occurrence.concealment = undefined;
    } else {
        occurrence.concealment ??= occurrence.image.animate([{ opacity: 0 }], { duration: 0, fill: "both" });
        queueLayout(occurrence);
    }
    if (occurrence.viewer) queueNativeViewer(occurrence.viewer);
}

function forget(occurrence: ImageOccurrence) {
    const { image, host, carrier, viewer, geometryObserver } = occurrence;
    occurrences.delete(image);
    dirty.delete(occurrence);
    geometryObserver.disconnect();
    occurrence.concealment?.cancel();
    carrier.remove();
    resizeObserver?.unobserve(image);
    const siblings = hosts.get(host);
    siblings?.delete(occurrence);
    if (!siblings?.size) {
        host.classList.remove(HOST_CLASS);
        resizeObserver?.unobserve(host);
        hosts.delete(host);
    }
    if (viewer) {
        const slides = viewers.get(viewer);
        slides?.delete(occurrence);
        if (!slides?.size) viewers.delete(viewer);
        queueNativeViewer(viewer);
    }
}

function handleVisibilityChange() {
    if (document.hidden) relockImagePrivacyDom();
}

function queueNativeViewer(viewer: Element) {
    if (!dirtyViewers.size) {
        queueMicrotask(() => {
            dirtyViewers.forEach(refreshNativeViewer);
            dirtyViewers.clear();
        });
    }
    dirtyViewers.add(viewer);
}

function refreshNativeViewer(viewer: Element) {
    const slides = viewers.get(viewer);
    const locked = !!slides && [...slides].some(({ image, revealed }) => !revealed && image.matches(NATIVE_MAIN_IMAGE));
    viewer.classList.toggle("ipp-privacy-native-has-private", !!slides?.size);
    viewer.classList.toggle("ipp-privacy-native-locked", locked);
    if (locked) viewer.querySelector<HTMLVideoElement>(".live-photo-preview video")?.pause();
}

function guardLivePhoto(event: Event) {
    if (event.target instanceof HTMLVideoElement && event.target.closest(".ipp-privacy-native-locked .live-photo-preview")) {
        event.target.pause();
    }
}

function queueLayout(occurrence: ImageOccurrence) {
    dirty.add(occurrence);
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
        frame = undefined;
        // Measure only changed image boxes. Position relative to their hosts so scroll needs no work here.
        const layouts = [...dirty].map(readLayout);
        dirty.clear();
        for (const layout of layouts) applyLayout(layout);
    });
}

function readLayout(occurrence: ImageOccurrence) {
    const { image, coverBackground } = occurrence;
    const style = getComputedStyle(image);
    const fit = coverBackground ? (style.backgroundSize === "contain" ? "contain" : "cover") : style.objectFit;
    return {
        occurrence,
        left: image.offsetLeft,
        top: image.offsetTop,
        width: image.offsetWidth,
        height: image.offsetHeight,
        transform: style.transform,
        origin: style.transformOrigin,
        position: coverBackground ? style.backgroundPosition : style.objectPosition,
        fit,
    };
}

function fittedImageSize(source: HTMLImageElement, width: number, height: number, fit: string) {
    const { naturalWidth, naturalHeight } = source;
    if (!naturalWidth || !naturalHeight || fit === "fill") return { width, height };
    if (fit === "none") return { width: naturalWidth, height: naturalHeight };
    const fitScale = fit === "cover"
        ? Math.max(width / naturalWidth, height / naturalHeight)
        : Math.min(width / naturalWidth, height / naturalHeight);
    const scale = fit === "scale-down" ? Math.min(1, fitScale) : fitScale;
    return { width: naturalWidth * scale, height: naturalHeight * scale };
}

function applyLayout({ occurrence, left, top, width, height, transform, origin, position, fit }: ReturnType<typeof readLayout>) {
    const { mask, button, image, backgroundImage } = occurrence;
    mask.classList.toggle("ipp-privacy-mask-content--compact", width < 110 || height < 30);
    Object.assign(mask.style, {
        left: `${left}px`,
        top: `${top}px`,
        width: `${width}px`,
        height: `${height}px`,
        transform,
        transformOrigin: origin,
    });
    mask.style.setProperty("--ipp-privacy-position", position);
    mask.style.setProperty("--ipp-privacy-fit", fit);
    const source = backgroundImage || image;
    const fitted = fittedImageSize(source, width, height, fit);
    mask.style.setProperty("--ipp-privacy-size", fit === "fill" ? "100% 100%" : `${fitted.width}px ${fitted.height}px`);
    if (width > 0 && height > 0) {
        const cells = getPrivacyMosaicCells(Math.min(width, fitted.width), Math.min(height, fitted.height));
        renderMosaic(occurrence, source, cells);
    }
    if (button) {
        // The raster follows the image transform. Keep the unlock label readable after rotation or flipping.
        const inverse = transform === "none" ? undefined : new DOMMatrixReadOnly(transform).inverse();
        button.style.transform = inverse ? `matrix(${inverse.a}, ${inverse.b}, ${inverse.c}, ${inverse.d}, 0, 0)` : "";
    }
}
