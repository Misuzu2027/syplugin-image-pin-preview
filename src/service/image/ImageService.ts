import Instance from "@/utils/Instance";
import { SettingService } from "../setting/SettingService";
import ImagePreviewerSvelte from "@/components/image/ImagePreviewer.svelte";
import { getCurrentAttrViewImages, getDocImageAssets } from "@/utils/api";
import { SvelteComponent } from "svelte";
import { showMessage, type IEventBusMap } from "siyuan";
import { EnvConfig } from "@/config/EnvConfig";
import { ensureCurrentInList, findImageIndex, removeCompressURL, replaceAssetInSrc, sameImageList } from "@/utils/image-url";
import { destroyImagePrivacyDom, initImagePrivacyDom, relockImagePrivacyDom } from "./ImagePrivacyDom";
import { getImagePrivacyKey, isImagePrivate, replacePrivateAssetPath, setImagePrivate } from "./ImagePrivacyService";

interface ImagePreviewerInstance extends SvelteComponent {
    getCurrentSrc: () => string;
    flashHighlight: () => void;
    replaceAssetSrc: (oldPath: string, newPath: string) => void;
    relockPrivateImage: () => void;
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
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 12;

interface EditorTap {
    image: HTMLImageElement;
    x: number;
    y: number;
    time: number;
}

export class ImageService {
    public static get ins(): ImageService {
        return Instance.get(ImageService);
    }

    init() {
        bindPreviewEvents();
        initImagePrivacyDom();
    }

    destroy() {
        unbindPreviewEvents();
        destroyImagePrivacyDom();
        closeAllPreviews();
    }
}

let eventsBound = false;
let maxZIndex = 99999;
let previewCount = 0;
const previewSessions = new Set<PreviewSession>();
let lastOpenKey = "";
let lastOpenAt = 0;
let activeTap: EditorTap | undefined;
let previousTap: EditorTap | undefined;

function bindPreviewEvents() {
    if (eventsBound) {
        return;
    }
    eventsBound = true;
    document.addEventListener("click", handleCaptureClick, true);
    document.addEventListener("dblclick", handleCaptureDblClick, true);
    if (EnvConfig.ins.isMobile) {
        document.addEventListener("touchstart", startEditorTap, { capture: true, passive: true });
        document.addEventListener("touchmove", moveEditorTap, { capture: true, passive: true });
        document.addEventListener("touchend", finishEditorTap, { capture: true, passive: false });
        document.addEventListener("touchcancel", clearEditorTaps, true);
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    EnvConfig.ins.plugin.eventBus.on("open-menu-image", addImagePrivacyMenu);
    EnvConfig.ins.plugin.eventBus.on("switch-protyle", handleDocumentSwitch);
}

function unbindPreviewEvents() {
    if (!eventsBound) {
        return;
    }
    eventsBound = false;
    document.removeEventListener("click", handleCaptureClick, true);
    document.removeEventListener("dblclick", handleCaptureDblClick, true);
    document.removeEventListener("touchstart", startEditorTap, true);
    document.removeEventListener("touchmove", moveEditorTap, true);
    document.removeEventListener("touchend", finishEditorTap, true);
    document.removeEventListener("touchcancel", clearEditorTaps, true);
    clearEditorTaps();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    EnvConfig.ins.plugin.eventBus.off("open-menu-image", addImagePrivacyMenu);
    EnvConfig.ins.plugin.eventBus.off("switch-protyle", handleDocumentSwitch);
}

function handleDocumentSwitch() {
    clearEditorTaps();
    relockImagePrivacyDom();
    relockPreviews();
}

function relockPreviews() {
    for (const session of previewSessions) {
        session.component?.relockPrivateImage();
    }
}

function handleVisibilityChange() {
    if (document.hidden) {
        clearEditorTaps();
        relockPreviews();
    }
}

function addImagePrivacyMenu(event: CustomEvent<IEventBusMap["open-menu-image"]>) {
    const { element, menu } = event.detail;
    const image = element instanceof HTMLImageElement ? element : element.querySelector("img");
    const src = image?.getAttribute("src") || image?.getAttribute("data-src") || "";
    if (!getImagePrivacyKey(src)) {
        return;
    }
    const { i18n } = EnvConfig.ins;
    const marked = isImagePrivate(src);
    menu.addItem({
        id: "ipp-privacy",
        icon: marked ? "iconEye" : "iconEyeoff",
        label: marked ? i18n.privacyUnmark || "取消隐私" : i18n.privacyMark || "设为隐私图片",
        click: async () => {
            try {
                await setImagePrivate(src, !marked);
            } catch {
                showPrivacySaveError();
            }
        },
    });
}

function showPrivacySaveError() {
    showMessage(EnvConfig.ins.i18n.privacySaveError || "保存图片隐私标记失败", 5000, "error");
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
    if (event.button !== 0 || isInsidePreviewer(event.target)) {
        return;
    }
    const image = asImageElement(event.target);
    if (!image || (!isAvAssetImage(image) && !isPreviewModeImage(image)) || !shouldUsePluginPreview(event, image)) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (isAvAssetImage(image)) {
        await openFromAvImage(image, event.ctrlKey || event.metaKey);
    } else {
        await openFromEditorImage(image, event.ctrlKey || event.metaKey);
    }
}

async function handleCaptureDblClick(event: MouseEvent) {
    if (isInsidePreviewer(event.target)) {
        return;
    }
    const image = asImageElement(event.target);
    if (!image || !isEditorContentImage(image) || isPreviewModeImage(image) || !shouldUsePluginPreview(event, image)) {
        return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    await openFromEditorImage(image, event.ctrlKey || event.metaKey);
}

function clearEditorTaps() {
    activeTap = previousTap = undefined;
}

function startEditorTap(event: TouchEvent) {
    const image = asImageElement(event.target);
    if (event.touches.length !== 1 || !image || isInsidePreviewer(image) ||
        !isEditorContentImage(image) || isPreviewModeImage(image) || !shouldUsePluginPreview(event, image)) {
        clearEditorTaps();
        return;
    }
    const touch = event.touches[0];
    activeTap = { image, x: touch.clientX, y: touch.clientY, time: event.timeStamp };
}

function isNearTap(touch: Touch, tap: EditorTap): boolean {
    return Math.hypot(touch.clientX - tap.x, touch.clientY - tap.y) <= TAP_SLOP;
}

function moveEditorTap(event: TouchEvent) {
    if (activeTap && (event.touches.length !== 1 || !isNearTap(event.touches[0], activeTap))) {
        clearEditorTaps();
    }
}

function finishEditorTap(event: TouchEvent) {
    const tap = activeTap;
    const touch = event.changedTouches[0];
    activeTap = undefined;
    if (!tap || !touch || event.touches.length || event.timeStamp - tap.time > DOUBLE_TAP_MS ||
        !isNearTap(touch, tap) || !tap.image.isConnected || !shouldUsePluginPreview(event, tap.image)) {
        previousTap = undefined;
        return;
    }
    if (previousTap?.image === tap.image && event.timeStamp - previousTap.time <= DOUBLE_TAP_MS && isNearTap(touch, previousTap)) {
        previousTap = undefined;
        event.preventDefault();
        event.stopImmediatePropagation();
        void openFromEditorImage(tap.image, event.ctrlKey || event.metaKey);
        return;
    }
    previousTap = { image: tap.image, x: touch.clientX, y: touch.clientY, time: event.timeStamp };
}

function shouldUsePluginPreview(event: MouseEvent | TouchEvent, image: HTMLImageElement): boolean {
    return (isPluginOpen() && !event.altKey) || isImagePrivate(image.getAttribute("src") || "");
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
    updateMobileDetailZIndex();

    const container = createPreviewContainer();
    container.addEventListener("pointerdown", handleContainerPointerDown, true);

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
            onAssetPathReplaced: replacePreviewAssetPath,
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

function handleContainerPointerDown(event: PointerEvent) {
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

function replacePreviewAssetPath(oldPath: string, newPath: string) {
    void replacePrivateAssetPath(oldPath, newPath).catch(showPrivacySaveError);
    for (const session of previewSessions) {
        session.images = session.images.map((src) => replaceAssetInSrc(src, oldPath, newPath));
        session.component?.replaceAssetSrc(oldPath, newPath);
    }
}

function bringHostToFront(host: HTMLElement) {
    const curZIndex = Number(window.getComputedStyle(host).zIndex);
    if (curZIndex === maxZIndex) {
        return;
    }
    maxZIndex++;
    updateMobileDetailZIndex();
    host.style.zIndex = String(maxZIndex);
}

function updateMobileDetailZIndex() {
    document.documentElement.style.setProperty("--ipp-detail-z", String(maxZIndex + 1));
}

function closeImagePreview(session: PreviewSession) {
    previewSessions.delete(session);
    session.component?.$destroy();
    session.container.remove();
    previewCount--;
    if (previewCount <= 0) {
        previewCount = 0;
        maxZIndex = 99999;
        document.documentElement.style.removeProperty("--ipp-detail-z");
    }
}

function closeAllPreviews() {
    [...previewSessions].forEach((session) => session.closer());
}
