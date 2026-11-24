<script lang="ts">
    import { openBy } from "@/libs/siyuan/editor/util";
    import { inputDialogSync } from "@/libs/dialog";
    import { MenuItem } from "@/libs/siyuan/menus/Menu";
    import { getMobileImageActions, isInAndroid, isInHarmony, openByMobile } from "@/libs/siyuan/protyle/util/compatibility";
    import { copyAssetFile, copyPNGByLink, exportAsset, getCopyFilePath } from "@/libs/siyuan/menus/util";
    import { getAssetName, isLocalPath } from "@/libs/siyuan/util/pathName";
    import { canCopyImageToClipboard, copyPlainText, notifyCopyFailed, notifyCopySuccess } from "@/utils/clipboard";
    import { getImageOCRText, ocrAsset, renameAsset, setImageOCRText } from "@/utils/api";
    import { loadImageDetail, type ImageDetailRow } from "@/service/image/ImageDetailService";
    import { getImagePrivacyKey, privateImages, setImagePrivate } from "@/service/image/ImagePrivacyService";
    import { getPrivacyMosaicCells, paintPrivacyMosaic } from "@/service/image/privacy-mosaic";
    import ImageDetailPage from "@/components/image/ImageDetailPage.svelte";
    import ImageDetailWindow from "@/components/image/ImageDetailWindow.svelte";
    import { getFrontend, showMessage } from "siyuan";
    import { onMount, onDestroy, tick } from "svelte";
    import {
        getEventPosition,
        Vector2,
    } from "@/utils/position-util";
    import {
        averagePoints,
        clampDisplayScale,
        clampFloatPosition,
        containFloatInViewport,
        distanceBetween,
        getPreviewFrame,
        getViewportContainScale,
        getViewportFitScale,
        getVisualSize,
        imageFlipCss,
        keepCenter,
        sampleNavSurface,
        type NavSurfaces,
        pickPinchFocalPoints,
        pinchZoomKeepFocal,
        PREVIEW_CHROME_FOOT,
        PREVIEW_CHROME_INFO,
        PREVIEW_CHROME_TOOLS,
        previewToolCapacity,
        switchDisplayScale,
        zoomKeepPoint,
    } from "@/service/image/ImagePreviewerService";
    import { SettingService } from "@/service/setting/SettingService";
    import { EnvConfig } from "@/config/EnvConfig";
    import { getDisplayImageName, getImageBasename, getPreviewAssetPath, getReachableImageURL, getSiYuanImageMarkdown, replaceAssetInSrc } from "@/utils/image-url";

    export let images: string[] = [];
    export let imageTitles: string[] = [];
    export let startIndex: number = 0;
    export let handleCloseClick: () => void = () => {};
    export let onAssetPathReplaced: (oldPath: string, newPath: string) => void = () => {};

    const DOUBLE_TAP_THRESHOLD = 300;
    const NAV_TOUCH_SIZE = 44;
    const COMPACT_NAV_SIZE = 40;
    const COMPACT_FOOT_WIDTH = 160;
    const LONG_PRESS_MS = 350;
    const LONG_PRESS_SLOP = 12;
    const MENU_CLICK_GUARD_MS = 700;
    const MIN_WIDTH = 80;
    const NAV_MIN_WIDTH = 168;
    const NAV_MIN_HEIGHT = 96;
    const PRIVACY_CONTROL_HEIGHT = 40;
    const NAME_LIMIT = 18;
    const isMobile = EnvConfig.ins.isMobile;

    interface PreviewToolAction {
        id: string;
        label: string;
        icon: string;
        active: boolean;
        run: () => void;
    }

    let showOptionButton = SettingService.ins.SettingConfig?.showOptionButton !== false;
    let showImageNav = SettingService.ins.SettingConfig?.showImageNav !== false;
    let collapseToolbar = SettingService.ins.SettingConfig?.collapseToolbar !== false;
    let toolsOpen = false;
    let mobileToolsOpen = false;
    let mobileBrowseWidth = 0;
    let mobileNavRow: HTMLElement;
    let toolsPinned = false;
    let sizing = false;
    let sizingTimer: ReturnType<typeof setTimeout> | undefined;
    let currentIndex = Math.min(Math.max(startIndex, 0), Math.max(images.length - 1, 0));
    let currentSrc = "";
    let naturalW = 0;
    let naturalH = 0;
    let displayScale = 1;
    let lastCustomScale = 0;
    let rotate = 0;
    let flipH = false;
    let flipV = false;
    let position: Vector2 = { x: 0, y: 0 };
    let ready = false;
    let loading = false;
    let loadError = false;
    let imageLoadToken = 0;
    let lastTapTime = 0;
    let initialMobileScale = 1;
    let lastTouchTap: { x: number; y: number; time: number } | undefined;
    let tapTouchId: number | undefined;
    let revealedPrivacyKey = "";
    let privateImageKeys: ReadonlySet<string> = new Set();
    const unsubscribePrivacy = privateImages.subscribe((keys) => {
        privateImageKeys = keys;
        if (revealedPrivacyKey && !keys.has(revealedPrivacyKey)) {
            relockPrivateImage();
        }
    });

    let isDragging = false;
    let dragPointerId: number | null = null;
    let dragStartPos: Vector2 = { x: 0, y: 0 };
    let dragOrigin: Vector2 = { x: 0, y: 0 };
    let isPinching = false;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;
    let pinchStartRect: { left: number; top: number; width: number; height: number } | null = null;
    let pinchStartFocal: Vector2 | null = null;
    let pinchTouchIds: [number, number] | null = null;
    let pinchFocalIds: number[] = [];
    const imageTouchIds = new Set<number>();
    let touchOnControl = false;
    let longPressTimeout: ReturnType<typeof setTimeout>;
    let longPressOrigin: Vector2 | null = null;
    let longPressMoved = false;
    let longPressOpened = false;
    let longPressStartedAt = 0;
    let suppressClickUntil = 0;
    let contextMenuItem: HTMLElement | undefined;

    let floatEl: HTMLElement;
    let flashing = false;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    $: contentW = Math.max(1, naturalW * displayScale);
    $: contentH = Math.max(1, naturalH * displayScale);
    $: visual = getVisualSize(naturalW, naturalH, displayScale, rotate);
    $: imageCss = imageFlipCss(rotate, flipH, flipV);
    $: privacyLocked = isImageLocked(images[currentIndex] || currentSrc, privateImageKeys, revealedPrivacyKey);
    $: obscureImage = privacyLocked || isImageLocked(currentSrc, privateImageKeys, revealedPrivacyKey);
    $: unlockInFooter = privacyLocked && needsUnlockFooter(visual.width, visual.height);
    $: fileName = getDisplayImageName(currentSrc || images[currentIndex] || "");
    $: imageTitle = (imageTitles[currentIndex] || "").trim();
    $: distinctTitle = imageTitle && imageTitle !== fileName ? imageTitle : "";
    $: fileLabel = isMobile ? fileName : clipLabel(fileName);
    $: titleLabel = isMobile ? distinctTitle : clipLabel(distinctTitle);
    $: showCopyFile = !!getCopyFilePath(currentSrc || images[currentIndex] || "");
    $: showCopyPNG = !isMobile && !showCopyFile && canCopyImageToClipboard();
    $: showZoomButtons = !["desktop", "desktop-window"].includes(getFrontend());
    $: toolsExpanded = showOptionButton && (isMobile ? mobileToolsOpen : !collapseToolbar || toolsOpen || toolsPinned);
    $: showOverlayNav = showOptionButton && showImageNav && images.length > 1 && (isMobile || (visual.width >= NAV_MIN_WIDTH && visual.height >= NAV_MIN_HEIGHT));
    $: showOverlayClose = showOptionButton && showImageNav;
    $: mobileNav = isMobile && showOverlayNav;
    $: bottomAnchored = isMobile && showOptionButton;
    $: compactFooter = isMobile && isCompactFooter(mobileBrowseWidth);
    $: frame = getPreviewFrame(visual.width, visual.height, previewChrome(showOptionButton, toolsExpanded, unlockInFooter, mobileBrowseWidth, mobileNav));
    $: toolActions = collectToolActions(showZoomButtons, showCopyFile, showCopyPNG, rotate, flipH, flipV, toolsPinned, showImageNav, isMobile ? detailPageOpen : detailOverlay, obscureImage);
    $: shownTools = visibleToolActions(toolActions, isMobile ? Math.min(frame.width, window.innerWidth) : frame.width);
    $: toolsOverflow = isMobile || shownTools.length < toolActions.length;

    let previewImage: HTMLImageElement | undefined;
    let privacyMosaic: HTMLCanvasElement | undefined;
    let loadedImage: HTMLImageElement | undefined;
    $: privacyMosaicCells = getPrivacyMosaicCells(contentW, contentH);
    $: if (privacyMosaic) paintPrivacyMosaic(privacyMosaic, loadedImage, privacyMosaicCells);
    let navSurface: NavSurfaces = { prev: "light", next: "light", close: "light" };

    function refreshNavSurface(locked = obscureImage) {
        if (locked) {
            navSurface = { prev: "dark", next: "dark", close: "dark" };
            return;
        }
        const image = previewImage;
        if (!image?.complete || !image.naturalWidth || visual.width < 1 || visual.height < 1) {
            return;
        }
        const next = sampleNavSurface(image, rotate, flipH, flipV, visual.width, visual.height);
        if (!next || (next.prev === navSurface.prev && next.next === navSurface.next && next.close === navSurface.close)) {
            return;
        }
        navSurface = next;
    }

    $: previewImage, rotate, flipH, flipV, visual.width, visual.height, refreshNavSurface(obscureImage);

    let copiedTipKey = "";
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;
    let fileNameCut = false;
    let titleCut = false;
    let detailOverlay = false;
    let detailPageOpen = false;
    let detailWindowOpen = false;
    let detailWindowX = 24;
    let detailWindowY = 24;
    let detailWindowPlaced = false;
    let detailRows: ImageDetailRow[] = [];
    let detailPartial = false;
    let detailLoading = false;
    let detailToken = 0;
    let detailRequestKey = "";

    $: detailFileName = getImageBasename(currentSrc || images[currentIndex] || "");
    $: detailIndexLabel = images.length ? `[${currentIndex + 1}/${images.length}]` : "";
    $: detailWatchKey = `${detailOverlay}|${detailPageOpen}|${detailWindowOpen}|${currentIndex}|${currentSrc}|${naturalW}|${naturalH}|${loading}`;
    $: if (obscureImage) {
        closeOwnedContextMenu();
        clearImageDetails();
    }
    $: if (!obscureImage && (detailOverlay || detailPageOpen || detailWindowOpen) && !loading && currentSrc && detailWatchKey !== detailRequestKey) {
        detailRequestKey = detailWatchKey;
        void refreshDetail();
    }

    onMount(() => {
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        window.addEventListener("touchstart", handleWindowTouchStart, { capture: true, passive: false });
        window.addEventListener("touchmove", handleWindowTouchMove, { capture: true, passive: false });
        window.addEventListener("touchend", handleWindowTouchEnd, { capture: true, passive: false });
        window.addEventListener("touchcancel", handleWindowTouchEnd, { capture: true, passive: false });
        window.addEventListener("contextmenu", handleWindowContextMenu, true);
        window.addEventListener("click", handleWindowClickCapture, true);
        floatEl?.addEventListener("wheel", handleWheel, { passive: false });
        floatEl?.addEventListener("copy", handleCopyEvent);
        window.addEventListener("keydown", handleKeydown, true);
        openCurrent(true);
    });

    onDestroy(() => {
        imageLoadToken++;
        unsubscribePrivacy();
        closeOwnedContextMenu();
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        window.removeEventListener("touchstart", handleWindowTouchStart, true);
        window.removeEventListener("touchmove", handleWindowTouchMove, true);
        window.removeEventListener("touchend", handleWindowTouchEnd, true);
        window.removeEventListener("touchcancel", handleWindowTouchEnd, true);
        window.removeEventListener("contextmenu", handleWindowContextMenu, true);
        window.removeEventListener("click", handleWindowClickCapture, true);
        window.removeEventListener("keydown", handleKeydown, true);
        floatEl?.removeEventListener("wheel", handleWheel);
        floatEl?.removeEventListener("copy", handleCopyEvent);
        clearTimeout(longPressTimeout);
        clearTimeout(flashTimer);
        clearTimeout(sizingTimer);
        clearTimeout(copiedTimer);
    });

    export function getCurrentSrc(): string {
        return currentSrc || images[currentIndex] || "";
    }

    export function replaceAssetSrc(oldPath: string, newPath: string) {
        const pendingSrc = images[currentIndex];
        images = images.map((src) => replaceAssetInSrc(src, oldPath, newPath));
        const nextCurrent = replaceAssetInSrc(currentSrc || images[currentIndex] || "", oldPath, newPath);
        if (nextCurrent && nextCurrent !== currentSrc) {
            currentSrc = nextCurrent;
        }
        if (loading && images[currentIndex] !== pendingSrc) {
            openCurrent(!ready);
        }
    }

    export function relockPrivateImage() {
        revealedPrivacyKey = "";
    }

    export function flashHighlight() {
        flashing = false;
        clearTimeout(flashTimer);
        requestAnimationFrame(() => {
            flashing = true;
            floatEl?.focus();
            flashTimer = setTimeout(() => {
                flashing = false;
            }, 650);
        });
    }

    function t(pluginKey: string, fallback: string, siyuanKey?: string): string {
        if (siyuanKey && window.siyuan?.languages?.[siyuanKey]) {
            return window.siyuan.languages[siyuanKey];
        }
        return EnvConfig.ins.i18n?.[pluginKey] || fallback;
    }

    function isImageLocked(src: string, keys = privateImageKeys, revealed = revealedPrivacyKey): boolean {
        const key = getImagePrivacyKey(src);
        return !!key && keys.has(key) && key !== revealed;
    }

    function canAccessImage(src = currentPreviewSrc()): boolean {
        return !loading && !!src && src === currentPreviewSrc() && !isImageLocked(src) && !isImageLocked(images[currentIndex] || "");
    }

    function imageAction(src: string, action: () => void): () => void {
        return () => {
            if (canAccessImage(src)) {
                action();
            }
        };
    }

    function unlockPrivateImage() {
        const key = getImagePrivacyKey(images[currentIndex] || currentSrc);
        if (!key || !privateImageKeys.has(key)) {
            return;
        }
        if (unlockInFooter) {
            position = { x: position.x + frame.offsetX, y: position.y };
        }
        revealedPrivacyKey = key;
        floatEl?.focus();
    }

    async function updateImagePrivacy(src: string, value: boolean) {
        suppressClickUntil = 0;
        try {
            await setImagePrivate(src, value);
        } catch {
            showMessage(t("privacySaveError", "保存图片隐私标记失败"), 5000, "error");
        }
    }

    function needsUnlockFooter(width: number, height: number): boolean {
        return !isMobile && (width < 200 || height < 90);
    }

    function isCompactFooter(width: number) {
        return Math.min(window.innerWidth, width) <= COMPACT_FOOT_WIDTH;
    }

    function previewChrome(optionButton: boolean, expanded: boolean, compactUnlock: boolean, browseWidth: number, hasPages: boolean) {
        if (isMobile && optionButton) {
            const compact = isCompactFooter(browseWidth);
            const info = compact ? 0 : PREVIEW_CHROME_INFO;
            const tools = expanded && !(compact && hasPages) ? PREVIEW_CHROME_TOOLS : 0;
            return {
                head: 0,
                foot: info + (compact ? COMPACT_NAV_SIZE : NAV_TOUCH_SIZE) + tools,
                minWidth: Math.min(window.innerWidth, Math.max(2 * COMPACT_NAV_SIZE, browseWidth)),
            };
        }
        return {
            head: 0,
            foot: (optionButton ? (expanded ? PREVIEW_CHROME_FOOT : PREVIEW_CHROME_INFO) : 0)
                + (compactUnlock ? PRIVACY_CONTROL_HEIGHT : 0),
            minWidth: compactUnlock ? 136 : 0,
        };
    }

    function frameFor(imageWidth: number, imageHeight: number) {
        const compactUnlock = privacyLocked && needsUnlockFooter(imageWidth, imageHeight);
        return getPreviewFrame(imageWidth, imageHeight, previewChrome(showOptionButton, toolsExpanded, compactUnlock, mobileBrowseWidth, mobileNav));
    }

    function fitReservedFoot(width = visual.width, height = visual.height) {
        return previewChrome(showOptionButton, !isMobile || mobileToolsOpen, privacyLocked && needsUnlockFooter(width, height), width, mobileNav).foot;
    }

    function mobileContainedScale(scale: number, rotation: number) {
        if (!isMobile) return scale;
        const size = getVisualSize(naturalW, naturalH, scale, rotation);
        return Math.min(scale, getViewportContainScale(naturalW, naturalH, rotation, fitReservedFoot(size.width, size.height)));
    }

    function fittedScale(rotation: number) {
        const size = getVisualSize(naturalW, naturalH, 1, rotation);
        const foot = isMobile ? fitReservedFoot(size.width, size.height) : fitReservedFoot();
        return mobileContainedScale(getViewportFitScale(naturalW, naturalH, rotation, foot), rotation);
    }

    function containHeightFor(imageHeight: number, frameHeight: number) {
        return isMobile ? frameHeight : Math.max(frameHeight, imageHeight + fitReservedFoot());
    }

    function stageRect() {
        return {
            left: position.x + frame.offsetX,
            top: position.y + frame.offsetY,
            width: visual.width,
            height: visual.height,
        };
    }

    function placeCard(imageX: number, imageY: number, imageWidth: number, imageHeight: number, stayOnScreen: boolean) {
        if (isMobile) mobileBrowseWidth = imageWidth;
        const nextFrame = frameFor(imageWidth, imageHeight);
        const card = {
            x: imageX - nextFrame.offsetX,
            y: imageY - nextFrame.offsetY,
        };
        position = stayOnScreen
            ? containFloatInViewport(card.x, card.y, nextFrame.width, containHeightFor(imageHeight, nextFrame.height))
            : clampFloatPosition(card.x, card.y, nextFrame.width, nextFrame.height);
    }

    function applyPosition(next: Vector2) {
        position = clampFloatPosition(next.x, next.y, frame.width, frame.height);
    }

    function placeAtCenter(nextScale = displayScale, nextRotate = rotate) {
        const size = getVisualSize(naturalW, naturalH, nextScale, nextRotate);
        if (isMobile) mobileBrowseWidth = size.width;
        const nextFrame = frameFor(size.width, size.height);
        const reservedHeight = containHeightFor(size.height, nextFrame.height);
        const x = (window.innerWidth - nextFrame.width) / 2;
        const y = (window.innerHeight - reservedHeight) / 2;
        position = containFloatInViewport(x, y, nextFrame.width, reservedHeight);
    }

    function keepCurrentCenter(nextScale: number, nextRotate = rotate, stayOnScreen = false) {
        const nextSize = getVisualSize(naturalW, naturalH, nextScale, nextRotate);
        const stage = stageRect();
        const next = keepCenter(stage.left, stage.top, stage.width, stage.height, nextSize.width, nextSize.height);
        placeCard(next.x, next.y, nextSize.width, nextSize.height, stayOnScreen);
    }

    function markSizing() {
        sizing = true;
        clearTimeout(sizingTimer);
        sizingTimer = setTimeout(() => {
            sizing = false;
        }, 200);
    }

    function openTools() {
        if (!isMobile && collapseToolbar) {
            toolsOpen = true;
        }
    }

    function closeTools() {
        if (!toolsPinned) {
            toolsOpen = false;
        }
    }

    function toggleMobileTools() {
        if (!mobileToolsOpen) {
            const overflow = position.y + frame.height + PREVIEW_CHROME_TOOLS - window.innerHeight;
            if (overflow > 0) position = { x: position.x, y: position.y - overflow };
        }
        mobileToolsOpen = !mobileToolsOpen;
    }

    function toggleToolsPin() {
        toolsPinned = !toolsPinned;
        toolsOpen = true;
    }

    function openToolsOverflow(event: MouseEvent) {
        openContextMenu({ x: event.clientX, y: event.clientY });
    }

    function collectToolActions(
        zoomButtons: boolean,
        copyFile: boolean,
        copyPng: boolean,
        rotation: number,
        flippedH: boolean,
        flippedV: boolean,
        pinned: boolean,
        imageNav: boolean,
        detailActive: boolean,
        locked: boolean,
    ): PreviewToolAction[] {
        const actions: PreviewToolAction[] = [{
            id: "fit",
            label: t("fitWindow", "适应窗口", "reset"),
            icon: "#iconRefresh",
            active: false,
            run: fitToViewport,
        }];
        if (!locked && !isMobile) {
            actions.push({
                id: "detail",
                label: t("imageDetail", "图片详情"),
                icon: "#iconInfo",
                active: detailActive,
                run: isMobile ? openDetailPage : toggleDetailOverlay,
            });
        }
        if (zoomButtons) {
            actions.push(
                {
                    id: "zoomIn",
                    label: t("zoomIn", "放大", "zoomIn"),
                    icon: "#iconAdd",
                    active: false,
                    run: () => setScale(displayScale * 1.2),
                },
                {
                    id: "zoomOut",
                    label: t("zoomOut", "缩小", "zoomOut"),
                    icon: "#iconLine",
                    active: false,
                    run: () => setScale(displayScale / 1.2),
                },
            );
        }
        const copyAction: PreviewToolAction = copyFile
            ? {
                id: "copyFile",
                label: window.siyuan.languages.copyFile || t("copyFile", "复制文件"),
                icon: "#iconFile",
                active: false,
                run: copyCurrentFile,
            }
            : copyPng
                ? {
                    id: "copyPng",
                    label: window.siyuan.languages.copyAsPNG || t("copyAsPNG", "复制为 PNG"),
                    icon: "#iconImage",
                    active: false,
                    run: copyCurrentFile,
                }
                : isMobile
                    ? {
                        id: "copyForSiYuan",
                        label: t("copyForSiYuan", "复制", "copy"),
                        icon: "#iconCopy",
                        active: false,
                        run: copyForSiYuan,
                    }
                    : {
                        id: "export",
                        label: window.siyuan.languages.export,
                        icon: "#iconUpload",
                        active: false,
                        run: () => {
                            if (canAccessImage(currentSrc)) {
                                exportAsset(currentSrc);
                            }
                        },
                    };
        if (!isMobile) {
            actions.push({
                id: "actual",
                label: t("actualSize", "实际大小", "pageScaleActual"),
                icon: "#ippIconActual",
                active: false,
                run: () => setActualSize(),
            });
        }
        if (!locked) {
            actions.push(copyAction);
        }
        actions.push(
            {
                id: "rotateRight",
                label: t("rotateRight", "向右旋转", "rotateCw"),
                icon: "#iconRedo",
                active: rotation !== 0,
                run: () => rotateBy(90),
            },
            {
                id: "rotateLeft",
                label: t("rotateLeft", "向左旋转", "rotateCcw"),
                icon: "#iconUndo",
                active: rotation !== 0,
                run: () => rotateBy(-90),
            },
            {
                id: "flipH",
                label: t("flipHorizontal", "水平翻转", "imageFlipHorizontal"),
                icon: "#iconSplitLR",
                active: flippedH,
                run: () => flip("h"),
            },
            {
                id: "flipV",
                label: t("flipVertical", "垂直翻转", "imageFlipVertical"),
                icon: "#iconSplitTB",
                active: flippedV,
                run: () => flip("v"),
            },
        );
        if (!isMobile) {
            actions.push(
                {
                    id: "imageNav",
                    label: imageNavLabel(imageNav),
                    icon: imageNav ? "#iconEye" : "#iconEyeoff",
                    active: !imageNav,
                    run: toggleImageNav,
                },
                {
                    id: "pin",
                    label: pinned ? t("unpinToolbar", "取消钉住工具栏") : t("pinToolbar", "钉住工具栏"),
                    icon: pinned ? "#iconUnpin" : "#iconPin",
                    active: pinned,
                    run: toggleToolsPin,
                },
            );
        }
        return actions;
    }

    function visibleToolActions(actions: PreviewToolAction[], width: number): PreviewToolAction[] {
        const capacity = previewToolCapacity(width);
        if (!isMobile && capacity >= actions.length) {
            return actions;
        }
        return actions.slice(0, Math.max(0, capacity - 1));
    }

    function setScale(nextScale: number, zoomPosition?: Vector2, minWidth = MIN_WIDTH) {
        markSizing();
        const scale = clampDisplayScale(nextScale, naturalW, minWidth);
        const nextSize = getVisualSize(naturalW, naturalH, scale, rotate);
        if (zoomPosition) {
            const next = zoomKeepPoint(stageRect(), nextSize.width, nextSize.height, zoomPosition);
            placeCard(next.x, next.y, nextSize.width, nextSize.height, false);
        } else {
            keepCurrentCenter(scale, rotate);
        }
        displayScale = scale;
        lastCustomScale = scale;
    }

    function fitToViewport() {
        const scale = fittedScale(rotate);
        displayScale = scale;
        lastCustomScale = 0;
        keepCurrentCenter(scale, rotate, true);
    }

    function setActualSize(zoomPosition?: Vector2) {
        setScale(1, zoomPosition);
    }

    function toggleFitOrActual(pos: Vector2) {
        const fitScale = getViewportFitScale(naturalW, naturalH, rotate, fitReservedFoot());
        if (Math.abs(displayScale - fitScale) > 0.02) {
            const custom = displayScale;
            setScale(fitScale, pos);
            lastCustomScale = custom;
            return;
        }
        const target = lastCustomScale && Math.abs(lastCustomScale - fitScale) > 0.02 ? lastCustomScale : 1;
        setScale(target, pos);
    }

    function rotateBy(delta: number) {
        const nextRotate = (rotate + delta + 360) % 360;
        const nextScale = mobileContainedScale(Math.min(displayScale, getViewportContainScale(naturalW, naturalH, nextRotate, fitReservedFoot())), nextRotate);
        keepCurrentCenter(nextScale, nextRotate, true);
        displayScale = nextScale;
        rotate = nextRotate;
    }

    function flip(axis: "h" | "v") {
        if (axis === "h") {
            flipH = !flipH;
        } else {
            flipV = !flipV;
        }
    }

    function preloadNeighbors() {
        if (images.length < 2) {
            return;
        }
        for (const offset of [-1, 1]) {
            const src = images[(currentIndex + offset + images.length) % images.length];
            if (src) {
                const preloader = new Image();
                preloader.src = src;
            }
        }
    }

    function placeMobileGalleryImage(anchor: DOMRect) {
        // Snap the anchor once so fractional image heights cannot accumulate drift over many turns.
        const imageBottom = Math.round(anchor.top) - (compactFooter ? 0 : PREVIEW_CHROME_INFO);
        // Keep the preferred width across page turns, even if a portrait fits only at a smaller scale.
        displayScale = Math.min(mobileBrowseWidth / naturalW, window.innerWidth / naturalW,
            Math.max(1, imageBottom) / naturalH);
        const size = getVisualSize(naturalW, naturalH, displayScale, 0);
        const nextFrame = frameFor(size.width, size.height);
        position = {
            x: anchor.left + (anchor.width - nextFrame.width) / 2,
            y: imageBottom - size.height,
        };
    }

    function openCurrent(isFirst: boolean) {
        cancelTouchTap();
        const src = images[currentIndex];
        if (!src) {
            return;
        }
        loading = true;
        loadError = false;
        copiedTipKey = "";
        const token = ++imageLoadToken;
        const keepWidth = visual.width;
        const oldStage = stageRect();
        const oldVisual = { ...visual };
        const loader = new Image();
        loader.onload = () => {
            if (token !== imageLoadToken) {
                return;
            }
            const navAnchor = ready && !isFirst ? mobileNavRow?.getBoundingClientRect() : undefined;
            naturalW = loader.naturalWidth;
            naturalH = loader.naturalHeight;
            loadedImage = loader;
            currentSrc = src;
            rotate = 0;
            flipH = false;
            flipV = false;
            if (isFirst || !ready) {
                displayScale = fittedScale(0);
                lastCustomScale = 0;
                placeAtCenter(displayScale, 0);
                ready = true;
                requestAnimationFrame(() => floatEl?.focus());
            } else if (navAnchor) {
                placeMobileGalleryImage(navAnchor);
            } else {
                displayScale = mobileContainedScale(switchDisplayScale(naturalW, naturalH, keepWidth, 0, fitReservedFoot(keepWidth)), 0);
                const nextSize = getVisualSize(naturalW, naturalH, displayScale, 0);
                const next = keepCenter(
                    oldStage.left,
                    oldStage.top,
                    oldVisual.width,
                    oldVisual.height,
                    nextSize.width,
                    nextSize.height,
                );
                placeCard(next.x, next.y, nextSize.width, nextSize.height, true);
            }
            initialMobileScale = displayScale;
            loading = false;
            preloadNeighbors();
        };
        loader.onerror = () => {
            if (token !== imageLoadToken) {
                return;
            }
            loadedImage = undefined;
            currentSrc = src;
            loadError = true;
            loading = false;
            if (!ready) {
                naturalW = 360;
                naturalH = 240;
                displayScale = 1;
                ready = true;
                placeAtCenter(1, 0);
                requestAnimationFrame(() => floatEl?.focus());
            }
        };
        loader.src = src;
    }

    function goTo(index: number) {
        if (!images.length) {
            return;
        }
        const nextIndex = (index + images.length) % images.length;
        if (currentIndex !== nextIndex) {
            closeOwnedContextMenu();
            relockPrivateImage();
            currentIndex = nextIndex;
        }
        openCurrent(false);
    }

    function handlePrev() {
        goTo(currentIndex - 1);
    }

    function handleNext() {
        goTo(currentIndex + 1);
    }

    function handleWheel(event: WheelEvent) {
        event.preventDefault();
        event.stopPropagation();
        if (event.ctrlKey) {
            applyPosition({ x: position.x, y: position.y - event.deltaY * 0.5 });
            return;
        }
        if (event.shiftKey) {
            applyPosition({ x: position.x - event.deltaY * 0.5, y: position.y });
            return;
        }
        const factor = Math.exp(-event.deltaY * 0.0016);
        setScale(displayScale * factor, { x: event.clientX, y: event.clientY });
    }

    function pointerPos(event: PointerEvent): Vector2 {
        return { x: event.clientX, y: event.clientY };
    }

    function currentFloatRect() {
        return stageRect();
    }

    function isOnFloat(target: EventTarget | null) {
        return !!(floatEl && target instanceof Node && floatEl.contains(target));
    }

    function ownsTouchGesture() {
        return imageTouchIds.size > 0 || isDragging || isPinching;
    }

    function touchesToPoints(touches: TouchList) {
        const points: { id: number; x: number; y: number }[] = [];
        for (let i = 0; i < touches.length; i++) {
            points.push({
                id: touches[i].identifier,
                x: touches[i].clientX,
                y: touches[i].clientY,
            });
        }
        return points;
    }

    function pickPinchTouchPair(touches: TouchList) {
        const points = touchesToPoints(touches);
        if (points.length < 2) {
            return null;
        }
        const onImage = points.filter((point) => imageTouchIds.has(point.id));
        const first = onImage[0] || points[0];
        const second = points.find((point) => point.id !== first.id);
        if (!second) {
            return null;
        }
        return [first, second] as const;
    }

    function beginPinchFromTouches(touches: TouchList) {
        const pair = pickPinchTouchPair(touches);
        if (!pair) {
            return;
        }
        const [first, second] = pair;
        const rect = currentFloatRect();
        const focalPoints = pickPinchFocalPoints([first, second], rect);
        pinchTouchIds = [first.id, second.id];
        pinchFocalIds = focalPoints.map((point) => point.id);
        pinchStartFocal = averagePoints(focalPoints);
        pinchStartDistance = distanceBetween(first, second);
        pinchStartScale = displayScale;
        pinchStartRect = rect;
        isPinching = true;
        isDragging = false;
        dragPointerId = null;
        longPressMoved = true;
        clearTimeout(longPressTimeout);
    }

    function updatePinchFromTouches(touches: TouchList) {
        if (!pinchTouchIds || !pinchStartRect || !pinchStartFocal) {
            return;
        }
        const points = touchesToPoints(touches);
        const first = points.find((point) => point.id === pinchTouchIds[0]);
        const second = points.find((point) => point.id === pinchTouchIds[1]);
        if (!first || !second) {
            return;
        }
        const focalPoints = pinchFocalIds
            .map((id) => points.find((point) => point.id === id))
            .filter((point): point is { id: number; x: number; y: number } => !!point);
        const currentFocal = averagePoints(focalPoints.length ? focalPoints : [first, second]);
        const nextScale = clampDisplayScale(
            pinchStartScale * (distanceBetween(first, second) / (pinchStartDistance || 1)),
            naturalW,
            MIN_WIDTH,
        );
        const nextSize = getVisualSize(naturalW, naturalH, nextScale, rotate);
        const next = pinchZoomKeepFocal(
            pinchStartRect,
            pinchStartFocal,
            currentFocal,
            nextSize.width,
            nextSize.height,
        );
        placeCard(next.x, next.y, nextSize.width, nextSize.height, false);
        markSizing();
        displayScale = nextScale;
        lastCustomScale = nextScale;
    }

    function endPinch() {
        isPinching = false;
        pinchTouchIds = null;
        pinchStartRect = null;
        pinchStartFocal = null;
        pinchFocalIds = [];
    }

    function resumeDragFromTouch(touch: Touch) {
        isDragging = true;
        dragPointerId = null;
        dragStartPos = { x: touch.clientX, y: touch.clientY };
        dragOrigin = { ...position };
    }

    function handlePointerDown(event: PointerEvent) {
        if (event.button === 2) {
            longPressOpened = false;
            return;
        }
        if (event.button !== 0 && event.button !== 1) {
            return;
        }
        const target = event.target as HTMLElement;
        if (target.closest("button, .ipp-detail-overlay")) {
            return;
        }
        if (isPinching || (dragPointerId !== null && event.pointerId !== dragPointerId)) {
            return;
        }
        floatEl?.focus();
        window.siyuan?.menus?.menu?.remove();
        const pos = pointerPos(event);
        const now = Date.now();
        if (!isMobile && now - lastTapTime < DOUBLE_TAP_THRESHOLD && event.button === 0) {
            toggleFitOrActual(pos);
            lastTapTime = 0;
            return;
        }
        lastTapTime = now;
        if (event.button === 1) {
            event.preventDefault();
        }
        isDragging = true;
        dragPointerId = event.pointerId;
        dragStartPos = pos;
        dragOrigin = { ...position };
    }

    function handlePointerMove(event: PointerEvent) {
        if (!isDragging || isPinching) {
            return;
        }
        if (dragPointerId !== null && event.pointerId !== dragPointerId) {
            return;
        }
        const pos = pointerPos(event);
        if (event.pointerType === "touch") {
            markLongPressMoved(pos.x, pos.y);
            if (longPressOrigin && !longPressMoved) {
                return;
            }
        }
        applyPosition({
            x: dragOrigin.x + pos.x - dragStartPos.x,
            y: dragOrigin.y + pos.y - dragStartPos.y,
        });
    }

    function handlePointerUp(event: PointerEvent) {
        if (isPinching || dragPointerId === null || event.pointerId !== dragPointerId) {
            return;
        }
        isDragging = false;
        dragPointerId = null;
    }

    function previewOwnsPoint(target: EventTarget | null, x: number, y: number) {
        if (isOnFloat(target)) {
            return true;
        }
        const top = document.elementFromPoint(x, y);
        if (isOnFloat(top)) {
            return true;
        }
        if (!floatEl || top?.closest(".ipp-detail-page, .ipp-float") || !(target instanceof Element) || !target.closest("img")) {
            return false;
        }
        const rect = floatEl.getBoundingClientRect();
        return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    }

    function markLongPressMoved(x: number, y: number) {
        if (!longPressOrigin || longPressMoved) {
            return;
        }
        const dx = x - longPressOrigin.x;
        const dy = y - longPressOrigin.y;
        if (dx * dx + dy * dy <= LONG_PRESS_SLOP * LONG_PRESS_SLOP) {
            return;
        }
        longPressMoved = true;
        cancelTouchTap();
        clearTimeout(longPressTimeout);
    }

    function openLongPressMenu(pos: Vector2) {
        if (longPressOpened || longPressMoved) {
            return;
        }
        longPressOpened = true;
        cancelTouchTap();
        clearTimeout(longPressTimeout);
        isDragging = false;
        dragPointerId = null;
        openContextMenu(pos);
    }

    // 长按坐标在预览上时，系统仍会把 contextmenu 指到下层文档图片。
    function contextMenuHitsPreview(event: MouseEvent) {
        return previewOwnsPoint(event.target, event.clientX, event.clientY);
    }

    function handleWindowContextMenu(event: MouseEvent) {
        if (!contextMenuHitsPreview(event)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        if (longPressOpened) {
            return;
        }
        longPressMoved = false;
        openLongPressMenu({ x: event.clientX, y: event.clientY });
    }

    function handleWindowClickCapture(event: MouseEvent) {
        if (!suppressClickUntil || Date.now() > suppressClickUntil) {
            return;
        }
        const menu = window.siyuan?.menus?.menu?.element;
        if (event.target instanceof Node && menu?.contains(event.target)) {
            return;
        }
        if (!previewOwnsPoint(event.target, event.clientX, event.clientY)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }

    function cancelTouchTap() {
        lastTouchTap = undefined;
        tapTouchId = undefined;
    }

    function finishTouchTap(event: TouchEvent) {
        const touch = event.changedTouches[0];
        if (!touch || tapTouchId !== touch.identifier) return;
        tapTouchId = undefined;
        const point = { x: touch.clientX, y: touch.clientY };
        const time = Date.now();
        if (!longPressOrigin || time - longPressStartedAt >= LONG_PRESS_MS || distanceBetween(point, longPressOrigin) > LONG_PRESS_SLOP) {
            cancelTouchTap();
            return;
        }
        if (lastTouchTap && time - lastTouchTap.time <= DOUBLE_TAP_THRESHOLD && distanceBetween(point, lastTouchTap) <= LONG_PRESS_SLOP) {
            lastTouchTap = undefined;
            const target = displayScale > initialMobileScale ? initialMobileScale : initialMobileScale * 2;
            setScale(target, point, Math.min(MIN_WIDTH, naturalW * initialMobileScale));
        } else {
            lastTouchTap = { ...point, time };
        }
    }

    function handleWindowTouchStart(event: TouchEvent) {
        const touch = event.changedTouches[0];
        const ownsPreview = !!touch && previewOwnsPoint(event.target, touch.clientX, touch.clientY);
        if (isMobile && ownsPreview && event.touches.length === 1 && !loading && !loadError &&
            event.target instanceof Element && event.target.closest(".ipp-stage") && !isFloatControl(event.target)) {
            tapTouchId = touch.identifier;
        } else {
            cancelTouchTap();
        }
        if (ownsPreview) {
            for (let i = 0; i < event.changedTouches.length; i++) {
                imageTouchIds.add(event.changedTouches[i].identifier);
            }
            clearOutsideSelection();
            touchOnControl = isFloatControl(event.target);
            if (!touchOnControl) {
                event.preventDefault();
                event.stopPropagation();
            }
            window.siyuan?.menus?.menu?.remove();
            if (event.touches.length === 1 && !touchOnControl && touch) {
                const pos = { x: touch.clientX, y: touch.clientY };
                longPressOrigin = pos;
                longPressMoved = false;
                longPressOpened = false;
                longPressStartedAt = Date.now();
                longPressTimeout = setTimeout(() => openLongPressMenu(pos), LONG_PRESS_MS);
            } else {
                longPressMoved = true;
                clearTimeout(longPressTimeout);
            }
        }
        if (event.touches.length >= 2 && ownsTouchGesture()) {
            event.preventDefault();
            event.stopPropagation();
            if (!isPinching) {
                beginPinchFromTouches(event.touches);
            }
        }
    }

    function handleWindowTouchMove(event: TouchEvent) {
        if (event.touches.length === 1) {
            const touch = event.touches[0];
            markLongPressMoved(touch.clientX, touch.clientY);
        } else if (longPressOrigin) {
            longPressMoved = true;
            clearTimeout(longPressTimeout);
        }
        if (ownsTouchGesture() && !touchOnControl) {
            event.preventDefault();
            event.stopPropagation();
        }
        if (event.touches.length >= 2 && ownsTouchGesture()) {
            event.preventDefault();
            event.stopPropagation();
            if (!isPinching) {
                beginPinchFromTouches(event.touches);
            }
            updatePinchFromTouches(event.touches);
            return;
        }
        if (isDragging && event.touches.length === 1 && dragPointerId === null) {
            event.preventDefault();
            const touch = event.touches[0];
            if (longPressOrigin && !longPressMoved) {
                return;
            }
            applyPosition({
                x: dragOrigin.x + touch.clientX - dragStartPos.x,
                y: dragOrigin.y + touch.clientY - dragStartPos.y,
            });
            return;
        }
        if (isDragging && imageTouchIds.size > 0) {
            event.preventDefault();
        }
    }

    function handleWindowTouchEnd(event: TouchEvent) {
        if (event.type === "touchcancel") {
            cancelTouchTap();
            longPressMoved = true;
        } else if (!event.touches.length) {
            finishTouchTap(event);
        }
        for (let i = 0; i < event.changedTouches.length; i++) {
            imageTouchIds.delete(event.changedTouches[i].identifier);
        }
        const held = longPressStartedAt ? Date.now() - longPressStartedAt : 0;
        const origin = longPressOrigin;
        const openHeld = event.touches.length === 0 && !longPressOpened && !longPressMoved && !!origin && held >= LONG_PRESS_MS;
        clearTimeout(longPressTimeout);
        if (openHeld && origin) {
            longPressOpened = true;
            isDragging = false;
            dragPointerId = null;
            openContextMenu(origin);
        }
        if (isPinching) {
            const ids = pinchTouchIds;
            const pinchAlive = !!(
                ids
                && [...event.touches].some((touch) => touch.identifier === ids[0])
                && [...event.touches].some((touch) => touch.identifier === ids[1])
            );
            if (!pinchAlive) {
                if (event.touches.length >= 2) {
                    beginPinchFromTouches(event.touches);
                } else {
                    endPinch();
                    const remaining = event.touches[0];
                    if (remaining && imageTouchIds.has(remaining.identifier)) {
                        resumeDragFromTouch(remaining);
                    }
                }
            }
        }
        if (event.touches.length === 0) {
            longPressOrigin = null;
            longPressStartedAt = 0;
            imageTouchIds.clear();
            touchOnControl = false;
            isDragging = false;
            dragPointerId = null;
        }
    }

    function handleTouchStart(event: TouchEvent) {
        window.siyuan?.menus?.menu?.remove();
        if (event.touches.length >= 2) {
            longPressMoved = true;
            clearTimeout(longPressTimeout);
        }
    }

    function handleTouchMove(event: TouchEvent) {
        const touch = event.touches[0];
        if (!touch || event.touches.length !== 1) {
            longPressMoved = true;
            clearTimeout(longPressTimeout);
            return;
        }
        markLongPressMoved(touch.clientX, touch.clientY);
    }

    function handleTouchEnd() {
        clearTimeout(longPressTimeout);
    }

    function handleContextmenu(event: MouseEvent) {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(getEventPosition(event));
    }

    function isPreviewSelected(): boolean {
        const active = document.activeElement;
        return !!floatEl && !!active && (active === floatEl || floatEl.contains(active));
    }

    function hasOverlayTextSelection(): boolean {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString().trim()) {
            return false;
        }
        const node = selection.anchorNode;
        return !!node && !!floatEl?.contains(node);
    }

    function isFloatControl(target: EventTarget | null): boolean {
        return target instanceof Element && !!target.closest("button, a, input, textarea, .ipp-detail-overlay");
    }

    function clearOutsideSelection() {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
            return;
        }
        const node = selection.anchorNode;
        if (node && floatEl?.contains(node)) {
            return;
        }
        selection.removeAllRanges();
    }

    function currentPreviewSrc(): string {
        return currentSrc || images[currentIndex] || "";
    }

    function copyText(text: string) {
        copyPlainText(text).then((ok) => ok ? notifyCopySuccess() : notifyCopyFailed("text"));
    }

    function copyForSiYuan() {
        const src = currentPreviewSrc();
        if (canAccessImage(src)) {
            copyText(getSiYuanImageMarkdown(src, getDisplayImageName(src)));
        }
    }

    function copyFullLink() {
        const src = currentPreviewSrc();
        if (canAccessImage(src)) {
            copyText(getReachableImageURL(src));
        }
    }

    function copyCurrentFile() {
        const src = currentPreviewSrc();
        if (!canAccessImage(src)) {
            return;
        }
        if (showCopyFile) {
            copyAssetFile(src);
            return;
        }
        if (showCopyPNG) {
            copyPNGByLink(src);
            return;
        }
        if (isMobile) {
            copyForSiYuan();
            return;
        }
        notifyCopyFailed("file");
    }

    function handleCopyEvent(event: ClipboardEvent) {
        if (!isPreviewSelected() || hasOverlayTextSelection()) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        copyCurrentFile();
    }

    function isSiyuanMenuOpen(): boolean {
        const element = window.siyuan?.menus?.menu?.element;
        if (!element || element.classList.contains("fn__none")) {
            return false;
        }
        return element.style.display !== "none";
    }

    function handleKeydown(event: KeyboardEvent) {
        if (!isPreviewSelected()) {
            return;
        }
        event.stopPropagation();
        const key = event.key.toLowerCase();
        const mod = event.ctrlKey || event.metaKey;
        if (event.key === "Escape") {
            event.preventDefault();
            if (isSiyuanMenuOpen()) {
                window.siyuan.menus.menu.remove();
                return;
            }
            handleCloseClick();
            return;
        }
        if (event.key === "ArrowLeft" || key === "a") {
            event.preventDefault();
            handlePrev();
            return;
        }
        if (event.key === "ArrowRight" || key === "d") {
            event.preventDefault();
            handleNext();
            return;
        }
        if (event.key === "+" || event.key === "=") {
            event.preventDefault();
            setScale(displayScale * 1.2);
            return;
        }
        if (event.key === "-" || event.key === "_") {
            event.preventDefault();
            setScale(displayScale / 1.2);
            return;
        }
        if (key === "0") {
            event.preventDefault();
            fitToViewport();
            return;
        }
        if (key === "1") {
            event.preventDefault();
            setActualSize();
            return;
        }
        if (key === "r") {
            event.preventDefault();
            rotateBy(event.shiftKey ? -90 : 90);
            return;
        }
        if (key === "l") {
            event.preventDefault();
            rotateBy(-90);
            return;
        }
        if (key === "h") {
            event.preventDefault();
            flip("h");
            return;
        }
        if (key === "v") {
            event.preventDefault();
            flip("v");
            return;
        }
        if (mod && event.shiftKey && key === "c") {
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!canAccessImage()) {
                return;
            }
            if (isMobile) {
                copyForSiYuan();
                return;
            }
            if (!showCopyPNG) {
                notifyCopyFailed("permission");
                return;
            }
            copyPNGByLink(currentSrc);
            return;
        }
        if (mod && key === "c") {
            if (hasOverlayTextSelection()) {
                return;
            }
            event.preventDefault();
            event.stopImmediatePropagation();
            copyCurrentFile();
        }
    }

    function initSizeAndPosition() {
        displayScale = fittedScale(0);
        rotate = 0;
        flipH = false;
        flipV = false;
        lastCustomScale = 0;
        placeAtCenter(displayScale, 0);
    }

    function alignFloat(direction: "center" | "top" | "bottom" | "left" | "right") {
        let x = position.x;
        let y = position.y;
        if (direction === "center") {
            x = (window.innerWidth - frame.width) / 2;
            y = (window.innerHeight - frame.height) / 2;
        } else if (direction === "top") {
            y = 0;
        } else if (direction === "bottom") {
            y = window.innerHeight - frame.height;
        } else if (direction === "left") {
            x = 0;
        } else if (direction === "right") {
            x = window.innerWidth - frame.width;
        }
        applyPosition({ x, y });
    }

    function appendSeparator(menu: { append: (element: HTMLElement) => void }) {
        menu.append(new MenuItem({ type: "separator" }).element);
    }

    function appendImageFileMenu(menu: { append: (element: HTMLElement) => void }, src: string) {
        const frontend = getFrontend();
        if (isLocalPath(src) && (frontend === "desktop" || frontend === "desktop-window")) {
            menu.append(new MenuItem({
                icon: "iconFolder",
                label: t("openFileLocation", "打开文件位置"),
                click: imageAction(src, () => openBy(src, "folder")),
            }).element);
            menu.append(new MenuItem({
                icon: "iconOpen",
                label: window.siyuan.languages.useDefault,
                click: imageAction(src, () => openBy(src, "app")),
            }).element);
        }
        if ((frontend === "mobile" || frontend === "browser-mobile") && src) {
            const useSystemApp = isInAndroid() || isInHarmony();
            menu.append(new MenuItem({
                id: useSystemApp ? "useDefault" : "useBrowserView",
                icon: "iconOpen",
                label: useSystemApp ? window.siyuan.languages.useDefault : window.siyuan.languages.useBrowserView,
                click: imageAction(src, () => openByMobile(src)),
            }).element);
        }
        menu.append(new MenuItem({
            label: window.siyuan.languages.export,
            icon: "iconUpload",
            click: imageAction(src, () => exportAsset(src)),
        }).element);
        if (frontend === "mobile") {
            const { share, saveToGallery } = getMobileImageActions(src);
            if (share) {
                menu.append(new MenuItem({
                    id: "shareAsset",
                    label: t("shareAsset", "分享", "shareAsset"),
                    icon: "iconForward",
                    click: imageAction(src, share),
                }).element);
            }
            if (saveToGallery) {
                menu.append(new MenuItem({
                    id: "saveToGallery",
                    label: t("saveToGallery", "保存到相册", "saveToGallery"),
                    icon: "iconGallery",
                    click: imageAction(src, saveToGallery),
                }).element);
            }
        }
        appendSeparator(menu);
        menu.append(new MenuItem({
            icon: "iconCopy",
            label: t("copyForSiYuan", "复制", "copy"),
            click: imageAction(src, copyForSiYuan),
        }).element);
        menu.append(new MenuItem({
            icon: "iconLink",
            label: t("copyFullLink", "复制网页链接"),
            click: imageAction(src, copyFullLink),
        }).element);
        if (showCopyPNG) {
            menu.append(new MenuItem({
                icon: "iconImage",
                label: window.siyuan.languages.copyAsPNG,
                click: imageAction(src, () => copyPNGByLink(src)),
            }).element);
        }
        if (showCopyFile) {
            menu.append(new MenuItem({
                icon: "iconFile",
                label: window.siyuan.languages.copyFile || t("copyFile", "复制文件"),
                click: imageAction(src, () => copyAssetFile(src)),
            }).element);
        }
        appendSeparator(menu);
        menu.append(new MenuItem({
            icon: "iconInfo",
            label: t("imageDetail", "图片详情"),
            click: imageAction(src, () => {
                if (isMobile) {
                    openDetailPage();
                    return;
                }
                openDetailWindow();
            }),
        }).element);
        appendSeparator(menu);
    }

    function closeOwnedContextMenu() {
        if (contextMenuItem?.isConnected) {
            window.siyuan.menus.menu.remove();
        }
        contextMenuItem = undefined;
    }

    function openContextMenu(pos: Vector2) {
        window.siyuan.menus.menu.remove();
        const menu = window.siyuan.menus.menu;
        const src = currentPreviewSrc();
        const selectedSrc = images[currentIndex] || src;
        const privacyKey = getImagePrivacyKey(selectedSrc);
        const canAccess = canAccessImage(src);
        contextMenuItem = new MenuItem({ icon: "ippIconPrev", label: t("prevImage", "上一张", "previous"), click: handlePrev }).element;
        menu.append(contextMenuItem);
        menu.append(new MenuItem({ icon: "ippIconNext", label: t("nextImage", "下一张", "next"), click: handleNext }).element);
        menu.append(new MenuItem({ icon: "iconClose", label: t("closeImage", "关闭图片", "close"), click: handleCloseClick }).element);
        appendSeparator(menu);
        if (privacyKey) {
            const marked = privateImageKeys.has(privacyKey);
            if (isImageLocked(selectedSrc)) {
                menu.append(new MenuItem({
                    icon: "iconEye",
                    label: t("privacyUnlock", "解锁查看"),
                    click: unlockPrivateImage,
                }).element);
            }
            menu.append(new MenuItem({
                icon: "iconEyeoff",
                label: marked ? t("privacyUnmark", "取消隐私") : t("privacyMark", "设为隐私图片"),
                click: () => updateImagePrivacy(selectedSrc, !marked),
            }).element);
            appendSeparator(menu);
        }
        if (canAccess) {
            appendImageFileMenu(menu, src);
        }
        menu.append(new MenuItem({
            icon: "iconImage",
            label: t("viewMenu", "视图"),
            type: "submenu",
            submenu: [
                { icon: "iconAdd", label: t("zoomIn", "放大", "zoomIn"), click: () => setScale(displayScale * 1.2) },
                { icon: "iconLine", label: t("zoomOut", "缩小", "zoomOut"), click: () => setScale(displayScale / 1.2) },
                { icon: "ippIconRotateRight", label: t("rotateRight", "向右旋转", "rotateCw"), click: () => rotateBy(90) },
                { icon: "ippIconRotateLeft", label: t("rotateLeft", "向左旋转", "rotateCcw"), click: () => rotateBy(-90) },
                { icon: "ippIconFlipH", label: t("flipHorizontal", "水平翻转", "imageFlipHorizontal"), click: () => flip("h") },
                { icon: "ippIconFlipV", label: t("flipVertical", "垂直翻转", "imageFlipVertical"), click: () => flip("v") },
                { icon: "ippIconActual", label: t("actualSize", "实际大小", "pageScaleActual"), click: () => setActualSize() },
                { icon: "iconRefresh", label: t("fitWindow", "适应窗口", "reset"), click: fitToViewport },
            ],
        }).element);
        appendSeparator(menu);
        const assetPath = canAccess ? getPreviewAssetPath(src) : undefined;
        const ocrState = { skip: false, original: "" };
        if (assetPath) {
            menu.append(new MenuItem({
                id: "rename",
                icon: "iconEdit",
                label: window.siyuan.languages.rename,
                click: imageAction(src, () => renameCurrentAsset(assetPath)),
            }).element);
            menu.append(new MenuItem({
                id: "ocr",
                label: "OCR",
                submenu: [{
                    id: "ocrResult",
                    type: "readonly",
                    label: `<textarea spellcheck="false" data-type="ocr" rows="6" class="b3-text-field fn__block" style="width:280px;margin:4px 0" placeholder="${window.siyuan.languages.ocrResult || "OCR"}"></textarea>`,
                    bind(element) {
                        const textarea = element.querySelector("textarea") as HTMLTextAreaElement | null;
                        if (!textarea) {
                            return;
                        }
                        getImageOCRText(assetPath).then((text) => {
                            if (canAccessImage(src) && !textarea.value) {
                                textarea.value = text;
                                ocrState.original = text;
                            }
                        });
                    },
                }, {
                    id: "separator_reOCR",
                    type: "separator",
                }, {
                    id: "reOCR",
                    label: window.siyuan.languages.reOCR,
                    click: imageAction(src, () => {
                        ocrState.skip = true;
                        ocrAsset(assetPath);
                    }),
                }],
            }).element);
            appendSeparator(menu);
        }
        menu.append(new MenuItem({
            icon: showImageNav ? "iconEye" : "iconEyeoff",
            label: imageNavLabel(showImageNav),
            click: toggleImageNav,
        }).element);
        appendSeparator(menu);
        menu.append(new MenuItem({
            icon: "iconAlignSettings",
            label: t("alignImage", "图片对齐"),
            type: "submenu",
            submenu: [
                { icon: "iconAlignCenter", label: t("alignCenter", "居中"), click: () => alignFloat("center") },
                { icon: "iconAlignTop", label: t("alignTop", "顶部对齐"), click: () => alignFloat("top") },
                { icon: "iconAlignBottom", label: t("alignBottom", "底部对齐"), click: () => alignFloat("bottom") },
                { icon: "iconAlignLeft", label: t("alignLeft", "左边对齐"), click: () => alignFloat("left") },
                { icon: "iconAlignRight", label: t("alignRight", "右边对齐"), click: () => alignFloat("right") },
                { icon: "iconRefresh", label: t("initSizeAndPosition", "初始化大小和位置"), click: initSizeAndPosition },
            ],
        }).element);

        suppressClickUntil = Date.now() + MENU_CLICK_GUARD_MS;
        menu.popup({ x: pos.x, y: pos.y });
        menu.element.style.zIndex = "999999";
        if (assetPath) {
            menu.removeCB = () => {
                if (ocrState.skip || !canAccessImage(src)) {
                    return;
                }
                const textarea = menu.element.querySelector('[data-type="ocr"]') as HTMLTextAreaElement | null;
                if (!textarea || textarea.value === ocrState.original) {
                    return;
                }
                setImageOCRText(assetPath, textarea.value);
            };
        }
    }

    function escapeDialogText(value: string): string {
        return value.replace(/[&<>"']/g, (char) => {
            switch (char) {
                case "&": return "&amp;";
                case "<": return "&lt;";
                case ">": return "&gt;";
                case "\"": return "&quot;";
                default: return "&#39;";
            }
        });
    }

    async function renameCurrentAsset(assetPath: string) {
        const oldName = getAssetName(assetPath.split("?")[0]);
        const value = await inputDialogSync({
            title: window.siyuan.languages.rename,
            defaultText: escapeDialogText(oldName),
        });
        const nextName = value?.trim();
        if (!nextName || nextName === oldName) {
            return;
        }
        const newPath = await renameAsset(assetPath, nextName);
        if (newPath) {
            onAssetPathReplaced(assetPath, newPath);
        }
    }

    function copyOverlayText(event: MouseEvent, key: string, text: string) {
        event.preventDefault();
        event.stopPropagation();
        if (!text || !canAccessImage()) {
            return;
        }
        copyPlainText(text).then((ok) => {
            if (ok) {
                copiedTipKey = key;
                clearTimeout(copiedTimer);
                copiedTimer = setTimeout(() => {
                    if (copiedTipKey === key) {
                        copiedTipKey = "";
                    }
                }, 1500);
                return;
            }
            copiedTipKey = "";
            notifyCopyFailed("text");
        });
    }

    function clipLabel(text: string): string {
        const chars = Array.from(text || "");
        if (chars.length <= NAME_LIMIT) {
            return text || "";
        }
        return `${chars.slice(0, NAME_LIMIT).join("")}…`;
    }

    function syncNameCut(event: PointerEvent, key: "name" | "title", full: string) {
        const host = event.currentTarget as HTMLElement;
        const button = host.querySelector("button");
        const target = button || host;
        const cut = (!isMobile && Array.from(full).length > NAME_LIMIT) || target.scrollWidth > target.clientWidth;
        if (key === "name") {
            fileNameCut = cut;
        } else {
            titleCut = cut;
        }
    }

    function leaveCopy(key: "name" | "title") {
        if (copiedTipKey === key) {
            copiedTipKey = "";
            clearTimeout(copiedTimer);
        }
    }

    function nameTip(full: string, cut: boolean, copied: boolean): string {
        if (copied && !cut) {
            return t("copiedSuccess", "复制成功");
        }
        if (cut) {
            return full;
        }
        return t("clickToCopy", "点击复制");
    }

    function imageNavLabel(visible: boolean): string {
        return visible ? t("hideImageIcons", "隐藏图片内按钮") : t("showImageIcons", "显示图片内按钮");
    }

    function toggleImageNav() {
        showImageNav = !showImageNav;
        SettingService.ins.updateSettingCofnigValue("showImageNav", showImageNav);
    }

    function placeDetailWindow() {
        const width = 440;
        const margin = 12;
        let x = position.x + frame.width + margin;
        let y = Math.max(margin, position.y);
        if (x + width > window.innerWidth - margin) {
            x = position.x - width - margin;
        }
        if (x < margin) {
            x = Math.max(margin, window.innerWidth - width - margin);
        }
        const maxY = Math.max(margin, window.innerHeight - 160);
        if (y > maxY) {
            y = maxY;
        }
        return { x, y };
    }

    function toggleDetailOverlay() {
        if (canAccessImage()) {
            detailOverlay = !detailOverlay;
        }
    }

    function openDetailPage() {
        if (canAccessImage()) {
            detailPageOpen = true;
        }
    }

    async function closeDetailPage() {
        detailPageOpen = false;
        await tick();
        const sheets = document.querySelectorAll<HTMLElement>(".ipp-detail-page");
        (sheets[sheets.length - 1] || floatEl)?.focus();
    }

    function openDetailWindow() {
        if (!canAccessImage()) {
            return;
        }
        if (!detailWindowPlaced) {
            const placed = placeDetailWindow();
            detailWindowX = placed.x;
            detailWindowY = placed.y;
            detailWindowPlaced = true;
        }
        detailWindowOpen = true;
    }

    function clearImageDetails() {
        detailToken++;
        detailOverlay = false;
        detailPageOpen = false;
        detailWindowOpen = false;
        detailRows = [];
        detailLoading = false;
        detailPartial = false;
        detailRequestKey = "";
    }

    async function refreshDetail() {
        const token = ++detailToken;
        const source = {
            src: currentSrc,
            fileName: detailFileName,
            indexLabel: detailIndexLabel,
            width: naturalW,
            height: naturalH,
        };
        detailLoading = true;
        try {
            const result = await loadImageDetail(source, t);
            if (token !== detailToken) {
                return;
            }
            detailRows = result.rows;
            detailPartial = result.partial;
        } finally {
            if (token === detailToken) {
                detailLoading = false;
            }
        }
    }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<div
    bind:this={floatEl}
    class="ipp-float"
    class:ipp-float--mobile={isMobile}
    class:ipp-float--ready={ready}
    class:ipp-float--dragging={isDragging}
    class:ipp-float--instant={isDragging || isPinching || sizing}
    class:ipp-float--flash={flashing}
    class:ipp-float--chrome={showOptionButton}
    tabindex="0"
    style:top={bottomAnchored ? undefined : `${position.y}px`}
    style:bottom={bottomAnchored ? `calc(100% - ${position.y + frame.height}px)` : undefined}
    style:height={bottomAnchored ? undefined : `${frame.height}px`}
    style="left:{position.x}px;width:{frame.width}px;--ipp-info:{PREVIEW_CHROME_INFO}px;--ipp-tools:{PREVIEW_CHROME_TOOLS}px;--ipp-stage-h:{visual.height}px;--ipp-foot-h:{frame.height - visual.height}px;--ipp-privacy-control-h:{PRIVACY_CONTROL_HEIGHT}px"
    on:pointerdown={handlePointerDown}
    on:contextmenu|stopPropagation={handleContextmenu}
    on:touchstart={handleTouchStart}
    on:touchmove|stopPropagation={handleTouchMove}
    on:touchend|stopPropagation={handleTouchEnd}
>
    {#if showOverlayClose}
        <button type="button" class="ipp-btn ipp-nav ipp-nav--close" class:ipp-nav--on-light={navSurface.close === "light"} class:ipp-nav--on-dark={navSurface.close === "dark"} aria-label={t("closeImage", "关闭图片", "close")} on:click|stopPropagation={handleCloseClick} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
            <svg class="ipp-icon"><use xlink:href="#ippIconClose"></use></svg>
        </button>
    {/if}
    <div class="ipp-body">
        <div class="ipp-stage" style="width:{visual.width}px;height:{visual.height}px">
            {#if currentSrc}
                <img
                    bind:this={previewImage}
                    class="ipp-image"
                    class:ipp-image--loading={loading}
                    class:ipp-image--private={obscureImage}
                    src={currentSrc}
                    alt={obscureImage ? "" : fileName || "image"}
                    draggable="false"
                    style="width:{contentW}px;height:{contentH}px;transform:{imageCss};"
                    on:load={() => refreshNavSurface()}
                />
            {/if}
            {#if obscureImage}
                <canvas
                    bind:this={privacyMosaic}
                    class="ipp-image ipp-privacy-mosaic"
                    style="width:{contentW}px;height:{contentH}px;transform:{imageCss};"
                    aria-hidden="true"
                ></canvas>
                <div class="ipp-privacy-mask"></div>
            {/if}
            {#if loadError && !obscureImage}
                <div class="ipp-status">{t("imageLoadFailed", "图片加载失败")}</div>
            {/if}
            {#if detailOverlay && !isMobile && !obscureImage}
                <div
                    class="ipp-detail-overlay"
                    on:pointerdown|stopPropagation
                    on:dblclick|stopPropagation
                    on:wheel|stopPropagation
                >
                    {#if detailLoading && !detailRows.length}
                        <div>{t("detailLoading", "正在读取…")}</div>
                    {/if}
                    {#if detailPartial}
                        <div>{t("detailUnavailable", "无法读取详细信息")}</div>
                    {/if}
                    {#each detailRows as row (row.key)}
                        <div>{row.label}: {row.value}</div>
                    {/each}
                </div>
            {/if}
            <div class="ipp-hit"></div>
            {#if showOverlayNav && !isMobile}
                <button type="button" class="ipp-btn ipp-nav ipp-nav--prev" class:ipp-nav--on-light={navSurface.prev === "light"} class:ipp-nav--on-dark={navSurface.prev === "dark"} title={t("prevImage", "上一张", "previous")} on:click|stopPropagation={handlePrev} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconPrev"></use></svg>
                </button>
                <button type="button" class="ipp-btn ipp-nav ipp-nav--next" class:ipp-nav--on-light={navSurface.next === "light"} class:ipp-nav--on-dark={navSurface.next === "dark"} title={t("nextImage", "下一张", "next")} on:click|stopPropagation={handleNext} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconNext"></use></svg>
                </button>
            {/if}
        </div>
    </div>

    {#if privacyLocked}
        <div class="ipp-privacy-control" class:ipp-privacy-control--footer={unlockInFooter}>
            <button
                type="button"
                class="ipp-privacy-unlock"
                on:click|stopPropagation={unlockPrivateImage}
                on:pointerdown|stopPropagation
                on:dblclick|stopPropagation
            >{t("privacyUnlock", "解锁查看")}</button>
        </div>
    {/if}

    {#if showOptionButton}
        <div
            class="ipp-foot"
            class:ipp-foot--compact={compactFooter}
            class:ipp-foot--tools={toolsExpanded}
            on:pointerenter={openTools}
            on:pointerleave={closeTools}
        >
            <div class="ipp-info">
                <div class="ipp-info__names" class:ipp-info__names--pair={isMobile && fileName && distinctTitle && !obscureImage}>
                    {#if obscureImage}
                        <span>{t("privacyLocked", "隐私图片")}</span>
                    {:else if fileName}
                        <span class="ipp-copy" on:pointerenter={(event) => syncNameCut(event, "name", fileName)} on:pointerleave={() => leaveCopy("name")}>
                            <button
                                type="button"
                                class="ipp-copy__text"
                                on:click|stopPropagation={(event) => copyOverlayText(event, "name", fileName)}
                                on:pointerdown|stopPropagation
                                on:dblclick|stopPropagation
                            >{fileLabel}</button>
                            <span class="ipp-copy__pop">
                                {#if copiedTipKey === "name" && fileNameCut}
                                    <span class="ipp-copy__done">{t("copiedSuccess", "复制成功")}</span>
                                {/if}
                                <span class="ipp-copy__tip" class:ipp-copy__tip--full={fileNameCut}>{nameTip(fileName, fileNameCut, copiedTipKey === "name")}</span>
                            </span>
                        </span>
                    {/if}
                    {#if distinctTitle && !obscureImage}
                        <span class="ipp-copy" on:pointerenter={(event) => syncNameCut(event, "title", distinctTitle)} on:pointerleave={() => leaveCopy("title")}>
                            <button
                                type="button"
                                class="ipp-copy__text"
                                on:click|stopPropagation={(event) => copyOverlayText(event, "title", distinctTitle)}
                                on:pointerdown|stopPropagation
                                on:dblclick|stopPropagation
                            >{titleLabel}</button>
                            <span class="ipp-copy__pop">
                                {#if copiedTipKey === "title" && titleCut}
                                    <span class="ipp-copy__done">{t("copiedSuccess", "复制成功")}</span>
                                {/if}
                                <span class="ipp-copy__tip" class:ipp-copy__tip--full={titleCut}>{nameTip(distinctTitle, titleCut, copiedTipKey === "title")}</span>
                            </span>
                        </span>
                    {/if}
                </div>
                {#if !isMobile && images.length}
                    <span class="ipp-info__index">{currentIndex + 1} / {images.length}</span>
                {/if}
                {#if naturalW && naturalH && !obscureImage}
                    <span class="ipp-info__dim">{naturalW} × {naturalH}</span>
                {/if}
            </div>
            {#if isMobile}
                <div bind:this={mobileNavRow} class="ipp-mobile-nav" class:ipp-mobile-nav--pages={mobileNav} style="--nav-size:{compactFooter ? COMPACT_NAV_SIZE : NAV_TOUCH_SIZE}px">
                    <button type="button" class="ipp-mobile-detail" disabled={obscureImage || loading}
                        aria-label={t("imageDetail", "图片详情")} on:click|stopPropagation={openDetailPage}>
                        <svg class="ipp-icon"><use xlink:href="#iconInfo"></use></svg>
                    </button>
                    <div class="ipp-mobile-pages">
                        {#if mobileNav}
                            <button type="button" aria-label={t("prevImage", "上一张", "previous")} on:click|stopPropagation={handlePrev}>
                                <svg class="ipp-icon"><use xlink:href="#ippIconPrev"></use></svg>
                            </button>
                        {/if}
                        <span class="ipp-mobile-index" style="min-width:{2 * String(images.length).length + 1}ch">{currentIndex + 1}/{images.length}</span>
                        {#if mobileNav}
                            <button type="button" aria-label={t("nextImage", "下一张", "next")} on:click|stopPropagation={handleNext}>
                                <svg class="ipp-icon"><use xlink:href="#ippIconNext"></use></svg>
                            </button>
                        {/if}
                    </div>
                    <button type="button" class="ipp-mobile-expand" aria-expanded={mobileToolsOpen}
                        aria-label={mobileToolsOpen ? t("hideImageTools", "收起工具栏") : t("showImageTools", "展开工具栏")}
                        on:click|stopPropagation={toggleMobileTools}>
                        <svg class="ipp-icon"><use xlink:href="#ippIconNext"></use></svg>
                    </button>
                </div>
            {/if}
            {#if !isMobile || (mobileToolsOpen && !(compactFooter && mobileNav))}
                <div class="ipp-tools">
                    {#each shownTools as action (action.id)}
                        <button
                            type="button"
                            class="ipp-btn"
                            class:ipp-btn--active={action.active}
                            aria-label={action.label}
                            on:click|stopPropagation={action.run}
                            on:pointerdown|stopPropagation
                            on:dblclick|stopPropagation
                        >
                            <svg class="ipp-icon ipp-icon--line"><use xlink:href={action.icon}></use></svg>
                        </button>
                    {/each}
                    {#if toolsOverflow}
                        <button
                            type="button"
                            class="ipp-btn"
                            aria-label={t("moreTools", "更多操作")}
                            on:click|stopPropagation={openToolsOverflow}
                            on:pointerdown|stopPropagation
                            on:dblclick|stopPropagation
                        >
                            <svg class="ipp-icon"><use xlink:href="#iconMore"></use></svg>
                        </button>
                    {/if}
                </div>
            {/if}
        </div>
    {/if}
</div>
{#if detailWindowOpen && !isMobile && !obscureImage}
    <ImageDetailWindow
        bind:x={detailWindowX}
        bind:y={detailWindowY}
        title={t("imageDetail", "图片详情")}
        rows={detailRows}
        loading={detailLoading}
        partial={detailPartial}
        loadingText={t("detailLoading", "正在读取…")}
        partialText={t("detailUnavailable", "无法读取详细信息")}
        copiedText={t("copiedSuccess", "复制成功")}
        closeLabel={t("closeImage", "关闭图片", "close")}
        onClose={() => detailWindowOpen = false}
    />
{/if}
{#if detailPageOpen && isMobile && !obscureImage}
    <ImageDetailPage
        title={t("imageDetail", "图片详情")}
        rows={detailRows}
        loading={detailLoading}
        partial={detailPartial}
        loadingText={t("detailLoading", "正在读取…")}
        partialText={t("detailUnavailable", "无法读取详细信息")}
        copiedText={t("copiedSuccess", "复制成功")}
        backLabel={t("back", "返回")}
        resizeLabel={t("resizeDetailSheet", "切换半屏或全屏")}
        onClose={closeDetailPage}
    />
{/if}

<style>
    .ipp-float {
        --ipp-panel-bg: rgba(0, 0, 0, 0.62);
        position: fixed;
        z-index: 1;
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        visibility: hidden;
        overflow: visible;
        background: transparent;
        outline: none;
        cursor: grab;
        touch-action: none;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
        transition: height 0.18s ease;
    }

    .ipp-float--instant {
        transition: none;
    }

    .ipp-float--ready {
        visibility: visible;
    }

    .ipp-float--chrome {
        overflow: visible;
        border-radius: 8px;
    }

    .ipp-float:hover,
    .ipp-float:focus,
    .ipp-float:focus-visible {
        box-shadow: 0 8px 16px rgba(3, 185, 226, 0.35);
    }

    .ipp-float--flash,
    .ipp-float--flash:hover,
    .ipp-float--flash:focus,
    .ipp-float--flash:focus-visible {
        animation: ipp-flash 0.6s ease;
    }

    @keyframes ipp-flash {
        0%, 100% {
            box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
        }
        25%, 75% {
            box-shadow: 0 0 0 3px rgba(3, 185, 226, 0.9), 0 8px 24px rgba(3, 185, 226, 0.55);
        }
    }

    .ipp-float--dragging {
        cursor: grabbing;
    }

    .ipp-foot {
        container-type: inline-size;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        flex: none;
        background: var(--ipp-panel-bg);
        color: #fff;
        border-radius: 0 0 8px 8px;
        touch-action: none;
    }

    .ipp-info {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
        align-items: center;
        height: var(--ipp-info);
        padding: 0 8px;
        font-size: 12px;
        line-height: 16px;
    }

    .ipp-info__names {
        grid-column: 1;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        gap: 8px;
        min-width: 0;
    }

    .ipp-info__index {
        grid-column: 2;
        justify-self: center;
        padding: 0 8px;
        opacity: 0.86;
        white-space: nowrap;
    }

    .ipp-info__dim {
        grid-column: 3;
        justify-self: end;
        opacity: 0.86;
        white-space: nowrap;
    }

    @container (max-width: 240px) {
        .ipp-info__dim {
            display: none;
        }
    }

    @container (max-width: 180px) {
        .ipp-info {
            grid-template-columns: 1fr;
            padding: 0 4px;
            overflow: hidden;
        }

        .ipp-info__names,
        .ipp-info__dim {
            display: none;
        }

        .ipp-info__index {
            grid-column: 1;
            justify-self: center;
            max-width: 100%;
            padding: 0;
            opacity: 1;
        }

        .ipp-info__index::before,
        .ipp-info__index::after {
            content: "···";
            margin: 0 4px;
            opacity: 0.55;
        }
    }

    @container (max-width: 84px) {
        .ipp-info__index::before,
        .ipp-info__index::after {
            content: none;
            margin: 0;
        }
    }

    .ipp-tools {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 0;
        opacity: 0;
        overflow: hidden;
        pointer-events: none;
        gap: 2px;
        padding: 0 8px;
        transition: height 0.18s ease, opacity 0.18s ease;
    }

    .ipp-foot--tools .ipp-tools {
        height: var(--ipp-tools);
        opacity: 1;
        overflow: visible;
        pointer-events: auto;
    }

    .ipp-float--instant .ipp-tools {
        transition: none;
    }

    .ipp-body {
        display: flex;
        width: 100%;
        flex: none;
        border-radius: 8px 8px 0 0;
        overflow: hidden;
        touch-action: none;
    }

    .ipp-body::before,
    .ipp-body::after {
        content: "";
        flex: 1 1 auto;
        background: var(--ipp-panel-bg);
    }

    /* Keep the footer and shadow on the same bottom edge throughout a page turn. */
    .ipp-float--mobile.ipp-float--chrome.ipp-float--ready .ipp-body {
        height: var(--ipp-stage-h);
    }

    .ipp-float--mobile.ipp-float--chrome .ipp-stage {
        align-self: flex-end;
    }

    @media (prefers-reduced-motion: no-preference) {
        .ipp-float--mobile.ipp-float--chrome.ipp-float--ready:not(.ipp-float--instant) .ipp-body {
            transition: height 0.18s ease;
        }
    }

    .ipp-stage {
        position: relative;
        flex: none;
    }

    .ipp-hit {
        position: absolute;
        inset: 0;
        z-index: 0;
        background: rgba(0, 0, 0, 0.01);
        touch-action: none;
        -webkit-touch-callout: none;
    }

    .ipp-image {
        position: absolute;
        left: 50%;
        top: 50%;
        display: block;
        max-width: none !important;
        max-height: none !important;
        pointer-events: auto;
        -webkit-user-drag: none;
        -webkit-touch-callout: none;
        transform-origin: center center;
        transition: opacity 0.12s ease;
        z-index: 1;
    }

    .ipp-image--loading {
        opacity: 0.75;
    }

    .ipp-image--private {
        opacity: 0;
        transition: none;
        pointer-events: none;
    }

    .ipp-privacy-mosaic {
        image-rendering: pixelated;
        pointer-events: none;
    }

    .ipp-privacy-mask {
        position: absolute;
        inset: 0;
        z-index: 2;
        background: rgba(22, 27, 35, 0.16);
        pointer-events: none;
    }

    .ipp-privacy-control {
        position: absolute;
        inset: 0 0 auto;
        z-index: 3;
        display: flex;
        height: var(--ipp-stage-h);
        align-items: center;
        justify-content: center;
        pointer-events: none;
    }

    .ipp-privacy-control--footer {
        position: relative;
        height: var(--ipp-privacy-control-h);
        flex: none;
        background: var(--ipp-panel-bg);
    }

    .ipp-privacy-control--footer:last-child {
        border-radius: 0 0 8px 8px;
    }

    .ipp-float--mobile .ipp-privacy-control {
        top: auto;
        bottom: var(--ipp-foot-h);
        height: min(var(--ipp-stage-h), calc(100% - var(--ipp-foot-h)));
        overflow: hidden;
    }

    .ipp-privacy-unlock {
        box-sizing: border-box;
        max-width: 100%;
        min-height: 32px;
        margin: 0;
        padding: 4px 12px;
        border: 1px solid rgba(255, 255, 255, 0.65);
        border-radius: 6px;
        background: #242a33;
        color: #fff;
        font-size: 13px;
        line-height: 18px;
        cursor: pointer;
        pointer-events: auto;
    }

    .ipp-privacy-unlock:hover {
        background: #394352;
    }

    .ipp-privacy-unlock:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
    }

    .ipp-status {
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        color: #fff;
        font-size: 13px;
        line-height: 1.4;
        pointer-events: none;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
        z-index: 2;
    }

    .ipp-btn {
        appearance: none;
        -webkit-appearance: none;
        display: inline-flex !important;
        align-items: center;
        justify-content: center;
        width: 32px !important;
        height: 32px !important;
        min-width: 32px !important;
        min-height: 32px !important;
        max-width: 32px !important;
        max-height: 32px !important;
        padding: 0 !important;
        margin: 0 !important;
        border: 0 !important;
        border-radius: 50% !important;
        line-height: 0 !important;
        font-size: 0 !important;
        flex: 0 0 32px !important;
        box-sizing: border-box !important;
        position: relative;
        overflow: visible;
        background: transparent;
        color: #fff;
        box-shadow: none;
        cursor: pointer;
    }

    .ipp-btn:hover:not(.ipp-nav) {
        background: rgba(255, 255, 255, 0.18);
        color: #fff;
    }

    .ipp-btn--active {
        background: rgba(255, 255, 255, 0.28);
        color: #6ec8e8;
    }

    .ipp-btn--active:hover {
        color: #6ec8e8;
    }

    .ipp-tools .ipp-btn[aria-label]::after {
        content: attr(aria-label);
        position: absolute;
        left: 50%;
        bottom: calc(100% + 6px);
        transform: translateX(-50%);
        padding: 3px 8px;
        border-radius: 6px;
        background: var(--ipp-panel-bg);
        color: #fff;
        font-size: 11px;
        line-height: 16px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        z-index: 5;
    }

    .ipp-tools .ipp-btn[aria-label]:hover::after,
    .ipp-tools .ipp-btn[aria-label]:focus-visible::after {
        opacity: 1;
    }

    .ipp-icon {
        display: block !important;
        width: 16px !important;
        height: 16px !important;
        min-width: 16px !important;
        min-height: 16px !important;
        fill: currentColor;
        pointer-events: none;
        flex-shrink: 0;
    }

    .ipp-icon--line {
        fill: none;
        stroke: currentColor;
        stroke-width: 1.7;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .ipp-nav {
        position: absolute;
        opacity: 0.78;
        z-index: 4;
    }

    .ipp-nav--on-light {
        background: rgba(0, 0, 0, 0.5);
        color: #fff;
        box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.28), 0 0 10px rgba(0, 0, 0, 0.28);
    }

    .ipp-nav--on-dark {
        background: rgba(255, 255, 255, 0.82);
        color: #1a1a1a;
        box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.16), 0 0 10px rgba(0, 0, 0, 0.28);
    }

    .ipp-nav--prev {
        left: 6px;
        top: 50%;
        margin-top: -16px;
    }

    .ipp-nav--next {
        right: 6px;
        top: 50%;
        margin-top: -16px;
    }

    .ipp-nav--close {
        top: 6px;
        right: 6px;
        z-index: 5;
    }

    .ipp-detail-overlay {
        position: absolute;
        left: 0;
        top: 0;
        z-index: 2;
        width: max-content;
        max-width: min(360px, 100%);
        max-height: 100%;
        box-sizing: border-box;
        overflow: auto;
        padding: 8px 10px;
        color: #fff;
        font-size: 13px;
        line-height: 1.45;
        text-align: left;
        text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.85);
        pointer-events: auto;
        user-select: text;
        -webkit-user-select: text;
        touch-action: pan-y;
        overflow-wrap: anywhere;
    }

    .ipp-float--mobile .ipp-nav {
        opacity: 1;
    }

    .ipp-mobile-nav {
        display: grid;
        grid-template-columns: var(--nav-size) minmax(0, 1fr) var(--nav-size);
        align-items: center;
        height: var(--nav-size);
    }

    .ipp-mobile-pages {
        display: grid;
        grid-template-columns: minmax(var(--nav-size), 1fr) auto minmax(var(--nav-size), 1fr);
        align-items: center;
    }

    .ipp-float--mobile .ipp-foot {
        align-self: center;
        max-width: 100vw;
    }

    .ipp-mobile-index {
        grid-column: 2;
        font-size: 11px;
        text-align: center;
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
    }

    .ipp-mobile-detail { justify-self: start; }
    .ipp-mobile-detail:disabled { opacity: 0.45; }
    .ipp-mobile-expand { justify-self: end; }
    .ipp-mobile-expand svg { transform: rotate(90deg); }
    .ipp-mobile-expand[aria-expanded="true"] svg { transform: rotate(-90deg); }

    .ipp-float--mobile .ipp-info {
        grid-template-columns: minmax(0, 1fr) auto;
        column-gap: 6px;
        --name-gap: 6px;
    }

    .ipp-float--mobile .ipp-info__names { display: flex; }
    .ipp-float--mobile .ipp-info__dim { display: block; grid-column: 2; }

    /* Content-sized tracks let short labels yield space. A long filename gets two shares. */
    .ipp-float--mobile .ipp-info__names--pair {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, max-content));
        gap: 0;
    }
    .ipp-info__names--pair .ipp-copy:first-child { grid-column: span 2; max-width: 100%; }
    .ipp-info__names--pair .ipp-copy:last-child { max-width: 100%; margin-inline-start: var(--name-gap); }

    @container (max-width: 270px) {
        .ipp-float--mobile .ipp-info {
            font-size: 11px;
            padding-inline: 6px;
            column-gap: 4px;
            --name-gap: 4px;
        }
    }
    .ipp-mobile-nav button {
        display: grid;
        place-items: center;
        width: var(--nav-size);
        height: var(--nav-size);
        padding: 0;
        border: 0;
        border-radius: 8px;
        color: inherit;
        background: transparent;
    }

    .ipp-mobile-nav button:active {
        background: rgba(255, 255, 255, 0.2);
    }

    .ipp-mobile-pages button {
        width: 100%;
    }

    @container (max-width: 220px) {
        .ipp-mobile-nav--pages {
            grid-template-columns: minmax(0, 1fr) var(--nav-size);
        }
        .ipp-mobile-nav--pages .ipp-mobile-detail { display: none; }
        .ipp-mobile-pages { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); }
    }

    .ipp-foot--compact .ipp-mobile-nav { order: -1; }
    .ipp-foot--compact .ipp-info { display: none; }
    .ipp-foot--compact .ipp-mobile-nav--pages { grid-template-columns: 1fr; }
    .ipp-foot--compact .ipp-mobile-nav--pages .ipp-mobile-expand,
    .ipp-foot--compact .ipp-mobile-nav:not(.ipp-mobile-nav--pages) .ipp-mobile-pages { display: none; }
    .ipp-foot--compact .ipp-mobile-expand { grid-column: -2; }
    .ipp-foot--compact .ipp-mobile-pages {
        justify-content: center;
        grid-template-columns: var(--nav-size) auto var(--nav-size);
    }

    @container (max-width: 128px) {
        .ipp-foot--compact .ipp-mobile-index { display: none; }
        .ipp-foot--compact .ipp-mobile-pages { grid-template-columns: repeat(2, var(--nav-size)); }
    }

    .ipp-float:not(.ipp-float--mobile):has(.ipp-nav:hover) .ipp-nav,
    .ipp-float:not(.ipp-float--mobile):has(.ipp-nav:focus-visible) .ipp-nav {
        opacity: 1;
    }

    .ipp-float:not(.ipp-float--mobile):has(.ipp-nav:hover) .ipp-nav--on-light,
    .ipp-float:not(.ipp-float--mobile):has(.ipp-nav:focus-visible) .ipp-nav--on-light {
        background: rgba(0, 0, 0, 0.68);
        color: #fff;
    }

    .ipp-float:not(.ipp-float--mobile):has(.ipp-nav:hover) .ipp-nav--on-dark,
    .ipp-float:not(.ipp-float--mobile):has(.ipp-nav:focus-visible) .ipp-nav--on-dark {
        background: rgba(255, 255, 255, 0.94);
        color: #1a1a1a;
    }

    .ipp-info .ipp-copy {
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-start;
        min-width: 0;
        max-width: 50%;
        flex: 0 1 auto;
        pointer-events: auto;
    }

    .ipp-info__names .ipp-copy:only-child {
        max-width: 100%;
    }

    .ipp-copy__text {
        appearance: none;
        display: block;
        max-width: 100%;
        border: 0;
        padding: 0;
        margin: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: inherit;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
        width: auto;
        text-align: left !important;
        justify-content: flex-start !important;
        cursor: pointer;
    }

    .ipp-copy__text:hover {
        text-decoration: underline;
    }

    .ipp-copy__pop {
        position: absolute;
        left: 0;
        bottom: calc(100% + 4px);
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        width: max-content;
        max-width: 240px;
        z-index: 4;
        pointer-events: none;
    }

    .ipp-copy__done,
    .ipp-copy__tip {
        box-sizing: border-box;
        width: max-content;
        max-width: 240px;
        padding: 3px 8px;
        border-radius: 6px;
        background: var(--ipp-panel-bg);
        color: #fff;
        font-size: 11px;
        line-height: 16px;
        white-space: nowrap;
    }

    .ipp-copy__tip--full {
        white-space: normal;
        overflow-wrap: anywhere;
    }

    .ipp-copy__tip {
        opacity: 0;
        transition: opacity 0.12s ease;
    }

    .ipp-copy:hover .ipp-copy__tip {
        opacity: 1;
    }

    .ipp-float:not(:has(.ipp-foot)) .ipp-body {
        border-radius: 8px;
    }

    @media (prefers-reduced-motion: reduce) {
        .ipp-float,
        .ipp-tools {
            transition: none;
        }
    }
</style>
