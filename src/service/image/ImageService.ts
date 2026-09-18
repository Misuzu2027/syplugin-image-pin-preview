import Instance from "@/utils/Instance";
import { SettingService } from "../setting/SettingService";
import ImagePreviewerSvelte from "@/components/image/ImagePreviewer.svelte";
import { getCurrentAttrViewImages, getDocImageAssets } from "@/utils/api";
import { SvelteComponent } from "svelte";
import { ensureCurrentInList, findImageIndex, removeCompressURL, sameImageList } from "@/utils/image-url";

interface ImagePreviewerInstance extends SvelteComponent {
    getCurrentSrc: () => string;
    flashHighlight: () => void;
}

interface PreviewSession {
    images: string[];
    container: HTMLElement;
    component: ImagePreviewerInstance | null;
    closer: () => void;
}

const HOST_CLASS = "ipp-host";
const WINDOW_CLASS = "ipp-window";
const AV_IMAGE_SELECTOR = "img.av__cellassetimg";
const EDITOR_IMAGE_SPAN = `span[data-type*="img"].img`;
const EDITOR_IMAGE_SELECTOR = `${EDITOR_IMAGE_SPAN} img`;
const EDITOR_SCOPE_IMAGE_SELECTOR = `${EDITOR_IMAGE_SELECTOR}, .protyle-wysiwyg img:not(.emoji):not(.av__cellassetimg), .protyle-preview img:not(.emoji)`;
const OPEN_DEBOUNCE_MS = 400;

export class ImageService {
    public static get ins(): ImageService {
        return Instance.get(ImageService);
    }

    init() {
        bindPreviewEvents();
    }

    destroy() {
        unbindPreviewEvents();
        closeAllPreviews();
    }
}

let eventsBound = false;
let maxZIndex = 99999;
let previewCount = 0;
const previewSessions = new Set<PreviewSession>();
let lastOpenKey = "";
let lastOpenAt = 0;

function bindPreviewEvents() {
    if (eventsBound) {
        return;
    }
    eventsBound = true;
    document.addEventListener("click", handleCaptureClick, true);
    document.addEventListener("dblclick", handleCaptureDblClick, true);
}

function unbindPreviewEvents() {
    if (!eventsBound) {
        return;
    }
    eventsBound = false;
    document.removeEventListener("click", handleCaptureClick, true);
    document.removeEventListener("dblclick", handleCaptureDblClick, true);
}

function isPluginOpen(): boolean {
    return !!SettingService.ins.SettingConfig?.isOpen;
}

function isInsidePreviewer(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(`.${WINDOW_CLASS}, .${HOST_CLASS}`);
}

function asImageElement(target: EventTarget | null): HTMLImageElement | null {
    if (!(target instanceof Element)) {
        return null;
    }
    const image = target instanceof HTMLImageElement ? target : target.closest("img");
    if (!image || image.classList.contains("emoji")) {
        return null;
    }
    return image;
}

function isAvAssetImage(image: HTMLImageElement): boolean {
    return image.classList.contains("av__cellassetimg");
}

function isEditorContentImage(image: HTMLImageElement): boolean {
    if (isAvAssetImage(image) || image.classList.contains("emoji")) {
        return false;
    }
    return !!(image.closest(".protyle-wysiwyg") || image.closest(".protyle-preview") || image.closest(EDITOR_IMAGE_SPAN));
}

function isPreviewModeImage(image: HTMLImageElement): boolean {
    return !isAvAssetImage(image) && !!image.closest(".protyle-preview");
}

function collectDomImageSrcs(root: ParentNode, selector: string): string[] {
    const srcs: string[] = [];
    root.querySelectorAll(selector).forEach((node) => {
        const src = removeCompressURL(node.getAttribute("src") || "");
        if (src) {
            srcs.push(src);
        }
    });
    return srcs;
}

function getEditorImageTitle(image: HTMLImageElement): string {
    const wrap = image.closest("span.img, span[data-type*='img']");
    const caption = wrap?.querySelector(".protyle-action__title span")?.textContent?.trim()
        || wrap?.querySelector(".protyle-action__title")?.textContent?.trim();
    if (caption) {
        return caption;
    }
    return (image.getAttribute("title") || "").trim();
}

function collectTitlesBySrc(root: ParentNode = document): Record<string, string> {
    const titles: Record<string, string> = {};
    root.querySelectorAll("span.img img, span[data-type*='img'] img").forEach((node) => {
        if (!(node instanceof HTMLImageElement)) {
            return;
        }
        const src = removeCompressURL(node.getAttribute("src") || "");
        const title = getEditorImageTitle(node);
        if (src && title) {
            titles[src] = title;
        }
    });
    return titles;
}

function titlesForImageList(images: string[], titleMap: Record<string, string>): string[] {
    const keys = Object.keys(titleMap);
    return images.map((src) => {
        if (titleMap[src]) {
            return titleMap[src];
        }
        const matched = keys.find((key) => findImageIndex([key], src) === 0);
        return matched ? titleMap[matched] : "";
    });
}

function getDocRootId(from: HTMLElement): string {
    const titleId = from.closest(".protyle")?.querySelector(".protyle-title")?.getAttribute("data-node-id");
    if (titleId) {
        return titleId;
    }
    return from.closest("[data-node-id]")?.getAttribute("data-node-id") || "";
}

function shouldOpenPreview(key: string): boolean {
    const now = Date.now();
    if (key && key === lastOpenKey && now - lastOpenAt < OPEN_DEBOUNCE_MS) {
        return false;
    }
    lastOpenKey = key;
    lastOpenAt = now;
    return true;
}

async function handleCaptureClick(event: MouseEvent) {
    if (!isPluginOpen() || event.button !== 0 || isInsidePreviewer(event.target)) {
        return;
    }
    const image = asImageElement(event.target);
    if (!image) {
        return;
    }
    if (isAvAssetImage(image) || isPreviewModeImage(image)) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (isAvAssetImage(image)) {
            await openFromAvImage(image, event.ctrlKey || event.metaKey);
        } else {
            await openFromEditorImage(image, event.ctrlKey || event.metaKey);
        }
    }
}

async function handleCaptureDblClick(event: MouseEvent) {
    if (!isPluginOpen() || isInsidePreviewer(event.target)) {
        return;
    }
    const image = asImageElement(event.target);
    if (!image || !isEditorContentImage(image) || isPreviewModeImage(image)) {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    await openFromEditorImage(image, event.ctrlKey || event.metaKey);
}

async function openFromEditorImage(image: HTMLImageElement, localOnly: boolean) {
    const currentSrc = removeCompressURL(image.getAttribute("src") || "");
    const docId = getDocRootId(image);
    if (!currentSrc || !shouldOpenPreview(`editor:${localOnly ? "local" : "doc"}:${docId}:${currentSrc}`)) {
        return;
    }

    let images: string[] = [];
    if (localOnly) {
        const scope = image.closest(".protyle-wysiwyg") || image.closest(".protyle-preview") || document;
        images = collectDomImageSrcs(scope, EDITOR_SCOPE_IMAGE_SELECTOR);
    } else {
        if (docId) {
            images = await getDocImageAssets(docId);
        }
        if (!images.length) {
            const scope = image.closest(".protyle-wysiwyg") || image.closest(".protyle-preview") || document;
            images = collectDomImageSrcs(scope, EDITOR_SCOPE_IMAGE_SELECTOR);
        }
    }

    const prepared = ensureCurrentInList(images, currentSrc);
    if (!prepared.images.length) {
        return;
    }
    const scope = image.closest(".protyle") || document;
    previewImages(prepared.images, prepared.index, titlesForImageList(prepared.images, collectTitlesBySrc(scope)));
}

async function openFromAvImage(image: HTMLImageElement, localOnly: boolean) {
    const currentSrc = removeCompressURL(image.getAttribute("src") || "");
    const avBlock = image.closest("[data-av-id][data-node-id]") as HTMLElement | null;
    const attrValue = image.closest(".custom-attr__avvalue") as HTMLElement | null;
    const avId = avBlock?.getAttribute("data-av-id") || "";
    const nodeId = avBlock?.getAttribute("data-node-id") || "";
    if (!currentSrc || !shouldOpenPreview(`av:${localOnly ? "local" : "full"}:${avId}:${nodeId}:${currentSrc}`)) {
        return;
    }

    let images: string[] = [];

    if (localOnly || !avBlock) {
        const scope = avBlock || attrValue || image.parentElement || document;
        images = collectDomImageSrcs(scope, AV_IMAGE_SELECTOR);
    } else {
        try {
            images = await getCurrentAttrViewImages(
                avBlock.getAttribute("data-av-id") || "",
                avBlock.getAttribute("data-node-id") || "",
                avBlock.getAttribute("custom-sy-av-view") || "",
                avBlock.querySelector('[data-type="av-search"]')?.textContent?.trim() || "",
            );
        } catch {
            images = [];
        }
        if (!images.length) {
            images = collectDomImageSrcs(avBlock, AV_IMAGE_SELECTOR);
        }
    }

    const prepared = ensureCurrentInList(images, currentSrc);
    if (!prepared.images.length) {
        return;
    }
    previewImages(prepared.images, prepared.index, titlesForImageList(prepared.images, collectTitlesBySrc()));
}

export function previewImages(images: string[], startIndex = 0, imageTitles: string[] = []) {
    if (focusExistingPreview(images, images[startIndex] || "")) {
        return;
    }

    previewCount++;
    maxZIndex++;

    const container = createPreviewContainer();
    container.addEventListener("mousedown", handleContainerMouseDown);

    const session: PreviewSession = {
        images: images.slice(),
        container,
        component: null,
        closer: () => closeImagePreview(session),
    };
    previewSessions.add(session);

    session.component = new ImagePreviewerSvelte({
        target: container,
        props: {
            images,
            imageTitles,
            startIndex,
            handleCloseClick: session.closer,
        },
    }) as ImagePreviewerInstance;
}

function createPreviewContainer(): HTMLElement {
    const container = document.createElement("div");
    container.className = HOST_CLASS;
    container.style.zIndex = String(maxZIndex);
    document.body.appendChild(container);
    return container;
}

function handleContainerMouseDown(event: MouseEvent) {
    bringHostToFront(event.currentTarget as HTMLElement);
}

function findExistingPreview(images: string[], currentSrc: string): PreviewSession | null {
    if (!currentSrc) {
        return null;
    }
    for (const session of previewSessions) {
        if (!sameImageList(session.images, images)) {
            continue;
        }
        const showing = session.component?.getCurrentSrc() || "";
        if (showing && findImageIndex([showing], currentSrc) === 0) {
            return session;
        }
    }
    return null;
}

function focusExistingPreview(images: string[], currentSrc: string): boolean {
    const session = findExistingPreview(images, currentSrc);
    if (!session) {
        return false;
    }
    bringHostToFront(session.container);
    session.component?.flashHighlight();
    return true;
}

function bringHostToFront(host: HTMLElement) {
    const curZIndex = Number(window.getComputedStyle(host).zIndex);
    if (curZIndex === maxZIndex) {
        return;
    }
    maxZIndex++;
    host.style.zIndex = String(maxZIndex);
}

function closeImagePreview(session: PreviewSession) {
    previewSessions.delete(session);
    session.component?.$destroy();
    session.container.remove();
    previewCount--;
    if (previewCount <= 0) {
        previewCount = 0;
        maxZIndex = 99999;
    }
}

function closeAllPreviews() {
    [...previewSessions].forEach((session) => session.closer());
}
