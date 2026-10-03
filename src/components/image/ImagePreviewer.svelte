<script lang="ts">
    import { openBy } from "@/libs/siyuan/editor/util";
    import { inputDialogSync } from "@/libs/dialog";
    import { MenuItem } from "@/libs/siyuan/menus/Menu";
    import { isInAndroid, isInHarmony, openByMobile } from "@/libs/siyuan/protyle/util/compatibility";
    import { copyAssetFile, copyPNGByLink, exportAsset, getCopyFilePath } from "@/libs/siyuan/menus/util";
    import { getAssetName, isLocalPath } from "@/libs/siyuan/util/pathName";
    import { canCopyImageToClipboard, copyPlainText, notifyCopyFailed, notifyCopySuccess } from "@/utils/clipboard";
    import { getImageOCRText, ocrAsset, renameAsset, setImageOCRText } from "@/utils/api";
    import { getFrontend } from "siyuan";
    import { onMount, onDestroy } from "svelte";
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
        pickPinchFocalPoints,
        pinchZoomKeepFocal,
        PREVIEW_CHROME_FOOT,
        PREVIEW_CHROME_INFO,
        PREVIEW_CHROME_TOOLS,
        previewToolMinWidth,
        switchDisplayScale,
        zoomKeepPoint,
    } from "@/service/image/ImagePreviewerService";
    import { SettingService } from "@/service/setting/SettingService";
    import { EnvConfig } from "@/config/EnvConfig";
    import { getDisplayImageName, getPreviewAssetPath, replaceAssetInSrc } from "@/utils/image-url";

    export let images: string[] = [];
    export let imageTitles: string[] = [];
    export let startIndex: number = 0;
    export let handleCloseClick: () => void = () => {};
    export let onAssetPathReplaced: (oldPath: string, newPath: string) => void = () => {};

    const DOUBLE_TAP_THRESHOLD = 300;
    const LONG_PRESS_MS = 350;
    const MIN_WIDTH = 80;
    const NAV_MIN_WIDTH = 168;
    const NAV_MIN_HEIGHT = 96;
    const CLOSE_MIN_SIZE = 88;
    const INFO_MIN_WIDTH = 160;
    const BASE_TOOL_COUNT = 10;
    const NAME_LIMIT = 18;

    let showOptionButton = SettingService.ins.SettingConfig?.showOptionButton !== false;
    let showImageNav = SettingService.ins.SettingConfig?.showImageNav !== false;
    let collapseToolbar = SettingService.ins.SettingConfig?.collapseToolbar !== false;
    let toolsOpen = false;
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
    let lastTapTime = 0;

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
    let longPressTimeout: ReturnType<typeof setTimeout>;

    let floatEl: HTMLElement;
    let flashing = false;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    $: contentW = Math.max(1, naturalW * displayScale);
    $: contentH = Math.max(1, naturalH * displayScale);
    $: visual = getVisualSize(naturalW, naturalH, displayScale, rotate);
    $: imageCss = imageFlipCss(rotate, flipH, flipV);
    $: fileName = getDisplayImageName(currentSrc || images[currentIndex] || "");
    $: imageTitle = (imageTitles[currentIndex] || "").trim();
    $: distinctTitle = imageTitle && imageTitle !== fileName ? imageTitle : "";
    $: fileLabel = clipLabel(fileName);
    $: titleLabel = clipLabel(distinctTitle);
    $: showCopyFile = !!getCopyFilePath(currentSrc || images[currentIndex] || "");
    $: showCopyPNG = !showCopyFile && canCopyImageToClipboard();
    $: showExport = !showCopyFile && !showCopyPNG;
    $: showZoomButtons = !["desktop", "desktop-window"].includes(getFrontend());
    $: toolButtonCount = (showZoomButtons ? BASE_TOOL_COUNT : BASE_TOOL_COUNT - 2) + 1;
    $: toolMinWidth = previewToolMinWidth(toolButtonCount);
    $: showInfo = showOptionButton && visual.width >= INFO_MIN_WIDTH;
    $: showToolsRow = showOptionButton && visual.width >= toolMinWidth;
    $: toolsExpanded = showToolsRow && (!collapseToolbar || toolsOpen || toolsPinned);
    $: chromeHeight = !showInfo ? 0 : ((showToolsRow && (!collapseToolbar || toolsPinned)) ? PREVIEW_CHROME_FOOT : PREVIEW_CHROME_INFO);
    $: frame = getPreviewFrame(visual.width, visual.height, {
        head: 0,
        foot: !showInfo ? 0 : (toolsExpanded ? PREVIEW_CHROME_FOOT : PREVIEW_CHROME_INFO),
        minWidth: 0,
    });
    $: showOverlayNav = showOptionButton && showImageNav && images.length > 1 && visual.width >= NAV_MIN_WIDTH && visual.height >= NAV_MIN_HEIGHT;
    $: showOverlayClose = showOptionButton && showImageNav && visual.width >= CLOSE_MIN_SIZE && visual.height >= CLOSE_MIN_SIZE;

    let copiedTipKey = "";
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;
    let fileNameCut = false;
    let titleCut = false;

    onMount(() => {
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        window.addEventListener("touchstart", handleWindowTouchStart, { capture: true, passive: false });
        window.addEventListener("touchmove", handleWindowTouchMove, { capture: true, passive: false });
        window.addEventListener("touchend", handleWindowTouchEnd, { capture: true, passive: false });
        window.addEventListener("touchcancel", handleWindowTouchEnd, { capture: true, passive: false });
        floatEl?.addEventListener("wheel", handleWheel, { passive: false });
        floatEl?.addEventListener("copy", handleCopyEvent);
        window.addEventListener("keydown", handleKeydown, true);
        openCurrent(true);
    });

    onDestroy(() => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        window.removeEventListener("touchstart", handleWindowTouchStart, true);
        window.removeEventListener("touchmove", handleWindowTouchMove, true);
        window.removeEventListener("touchend", handleWindowTouchEnd, true);
        window.removeEventListener("touchcancel", handleWindowTouchEnd, true);
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
        images = images.map((src) => replaceAssetInSrc(src, oldPath, newPath));
        const nextCurrent = replaceAssetInSrc(currentSrc || images[currentIndex] || "", oldPath, newPath);
        if (nextCurrent && nextCurrent !== currentSrc) {
            currentSrc = nextCurrent;
        }
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

    function chromeSpec(imageWidth: number) {
        const toolMin = previewToolMinWidth(toolButtonCount);
        const info = showOptionButton && imageWidth >= INFO_MIN_WIDTH;
        const toolsFit = showOptionButton && imageWidth >= toolMin;
        const expanded = toolsFit && (!collapseToolbar || toolsOpen || toolsPinned);
        return {
            head: 0,
            foot: !info ? 0 : (expanded ? PREVIEW_CHROME_FOOT : PREVIEW_CHROME_INFO),
            minWidth: 0,
        };
    }

    function frameFor(imageWidth: number, imageHeight: number) {
        return getPreviewFrame(imageWidth, imageHeight, chromeSpec(imageWidth));
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
        const nextFrame = frameFor(imageWidth, imageHeight);
        const card = {
            x: imageX - nextFrame.offsetX,
            y: imageY - nextFrame.offsetY,
        };
        position = stayOnScreen
            ? containFloatInViewport(card.x, card.y, nextFrame.width, nextFrame.height)
            : clampFloatPosition(card.x, card.y, nextFrame.width, nextFrame.height);
    }

    function applyPosition(next: Vector2) {
        position = clampFloatPosition(next.x, next.y, frame.width, frame.height);
    }

    function placeAtCenter(nextScale = displayScale, nextRotate = rotate) {
        const size = getVisualSize(naturalW, naturalH, nextScale, nextRotate);
        const nextFrame = frameFor(size.width, size.height);
        const x = (window.innerWidth - nextFrame.width) / 2;
        const y = (window.innerHeight - nextFrame.height) / 2;
        position = containFloatInViewport(x, y, nextFrame.width, nextFrame.height);
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
        if (collapseToolbar) {
            toolsOpen = true;
        }
    }

    function closeTools() {
        if (!toolsPinned) {
            toolsOpen = false;
        }
    }

    function toggleToolsPin() {
        toolsPinned = !toolsPinned;
        toolsOpen = true;
    }

    function setScale(nextScale: number, zoomPosition?: Vector2) {
        markSizing();
        const scale = clampDisplayScale(nextScale, naturalW, MIN_WIDTH);
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
        const scale = getViewportFitScale(naturalW, naturalH, rotate, chromeHeight);
        displayScale = scale;
        lastCustomScale = 0;
        keepCurrentCenter(scale, rotate, true);
    }

    function setActualSize(zoomPosition?: Vector2) {
        setScale(1, zoomPosition);
    }

    function toggleFitOrActual(pos: Vector2) {
        const fitScale = getViewportFitScale(naturalW, naturalH, rotate, chromeHeight);
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
        const nextScale = Math.min(displayScale, getViewportContainScale(naturalW, naturalH, nextRotate, chromeHeight));
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

    function openCurrent(isFirst: boolean) {
        const src = images[currentIndex];
        if (!src) {
            return;
        }
        loading = true;
        loadError = false;
        copiedTipKey = "";
        const keepWidth = visual.width;
        const oldStage = stageRect();
        const oldVisual = { ...visual };
        const loader = new Image();
        loader.onload = () => {
            naturalW = loader.naturalWidth;
            naturalH = loader.naturalHeight;
            currentSrc = src;
            rotate = 0;
            flipH = false;
            flipV = false;
            if (isFirst || !ready) {
                displayScale = getViewportFitScale(naturalW, naturalH, 0, chromeHeight);
                lastCustomScale = 0;
                placeAtCenter(displayScale, 0);
                ready = true;
                requestAnimationFrame(() => floatEl?.focus());
            } else {
                displayScale = switchDisplayScale(naturalW, naturalH, keepWidth, 0, chromeHeight);
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
            loading = false;
            preloadNeighbors();
        };
        loader.onerror = () => {
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
        currentIndex = (index + images.length) % images.length;
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
        if (event.button !== 0 && event.button !== 1) {
            return;
        }
        const target = event.target as HTMLElement;
        if (target.closest("button")) {
            return;
        }
        if (isPinching || (dragPointerId !== null && event.pointerId !== dragPointerId)) {
            return;
        }
        floatEl?.focus();
        window.siyuan?.menus?.menu?.remove();
        const pos = pointerPos(event);
        const now = Date.now();
        if (now - lastTapTime < DOUBLE_TAP_THRESHOLD && event.button === 0) {
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

    function handleWindowTouchStart(event: TouchEvent) {
        if (isOnFloat(event.target)) {
            for (let i = 0; i < event.changedTouches.length; i++) {
                imageTouchIds.add(event.changedTouches[i].identifier);
            }
            window.siyuan?.menus?.menu?.remove();
            if (event.touches.length === 1) {
                const pos = getEventPosition(event);
                longPressTimeout = setTimeout(() => {
                    isDragging = false;
                    dragPointerId = null;
                    openContextMenu(pos);
                }, LONG_PRESS_MS);
            } else {
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
        if (ownsTouchGesture()) {
            clearTimeout(longPressTimeout);
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
        for (let i = 0; i < event.changedTouches.length; i++) {
            imageTouchIds.delete(event.changedTouches[i].identifier);
        }
        clearTimeout(longPressTimeout);
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
            imageTouchIds.clear();
            isDragging = false;
            dragPointerId = null;
        }
    }

    function handleTouchStart(event: TouchEvent) {
        window.siyuan?.menus?.menu?.remove();
        if (event.touches.length >= 2) {
            clearTimeout(longPressTimeout);
        }
    }

    function handleTouchMove() {
        clearTimeout(longPressTimeout);
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

    function copyCurrentFile() {
        const src = currentSrc || images[currentIndex] || "";
        if (showCopyFile) {
            copyAssetFile(src);
            return;
        }
        if (showCopyPNG) {
            copyPNGByLink(src);
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

    function handleKeydown(event: KeyboardEvent) {
        if (!isPreviewSelected()) {
            return;
        }
        event.stopPropagation();
        const key = event.key.toLowerCase();
        const mod = event.ctrlKey || event.metaKey;
        if (event.key === "Escape") {
            event.preventDefault();
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
        displayScale = getViewportFitScale(naturalW, naturalH, 0, chromeHeight);
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

    function openContextMenu(pos: Vector2) {
        window.siyuan.menus.menu.remove();
        const menu = window.siyuan.menus.menu;
        menu.append(new MenuItem({ icon: "ippIconPrev", label: t("prevImage", "上一张", "previous"), click: handlePrev }).element);
        menu.append(new MenuItem({ icon: "ippIconNext", label: t("nextImage", "下一张", "next"), click: handleNext }).element);
        menu.append(new MenuItem({ icon: "iconClose", label: t("closeImage", "关闭图片", "close"), click: handleCloseClick }).element);
        menu.append(new MenuItem({ type: "separator" }).element);
        menu.append(new MenuItem({ icon: "ippIconRotateRight", label: t("rotateRight", "向右旋转", "rotateCw"), click: () => rotateBy(90) }).element);
        menu.append(new MenuItem({ icon: "ippIconRotateLeft", label: t("rotateLeft", "向左旋转", "rotateCcw"), click: () => rotateBy(-90) }).element);
        menu.append(new MenuItem({ icon: "ippIconFlipH", label: t("flipHorizontal", "水平翻转", "imageFlipHorizontal"), click: () => flip("h") }).element);
        menu.append(new MenuItem({ icon: "ippIconFlipV", label: t("flipVertical", "垂直翻转", "imageFlipVertical"), click: () => flip("v") }).element);
        menu.append(new MenuItem({ icon: "ippIconActual", label: t("actualSize", "实际大小", "pageScaleActual"), click: () => setActualSize() }).element);
        menu.append(new MenuItem({ icon: "iconRefresh", label: t("fitWindow", "适应窗口", "reset"), click: fitToViewport }).element);
        menu.append(new MenuItem({ type: "separator" }).element);
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
        menu.append(new MenuItem({ type: "separator" }).element);
        menu.append(new MenuItem({
            icon: "iconCopy",
            label: t("copyMarkdown", "复制"),
            click: () => copyPlainText(`![](${currentSrc})`).then((ok) => ok ? notifyCopySuccess() : notifyCopyFailed("text")),
        }).element);
        menu.append(new MenuItem({
            icon: "iconLink",
            label: `${window.siyuan.languages.copy} ${window.siyuan.languages.imageURL}`,
            click: () => copyPlainText(currentSrc).then((ok) => ok ? notifyCopySuccess() : notifyCopyFailed("text")),
        }).element);
        if (showCopyPNG) {
            menu.append(new MenuItem({
                icon: "iconImage",
                label: window.siyuan.languages.copyAsPNG,
                click: () => copyPNGByLink(currentSrc),
            }).element);
        }
        if (showCopyFile) {
            menu.append(new MenuItem({
                icon: "iconFile",
                label: window.siyuan.languages.copyFile || t("copyFile", "复制文件"),
                click: () => copyAssetFile(currentSrc),
            }).element);
        }
        const assetPath = getPreviewAssetPath(currentSrc || images[currentIndex] || "");
        const ocrState = { skip: false, original: "" };
        if (assetPath) {
            menu.append(new MenuItem({ type: "separator" }).element);
            menu.append(new MenuItem({
                id: "rename",
                icon: "iconEdit",
                label: window.siyuan.languages.rename,
                click: () => renameCurrentAsset(assetPath),
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
                            if (!textarea.value) {
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
                    click() {
                        ocrState.skip = true;
                        ocrAsset(assetPath);
                    },
                }],
            }).element);
        }
        menu.append(new MenuItem({ type: "separator" }).element);

        const frontend = getFrontend();
        if (isLocalPath(currentSrc) && (frontend === "desktop" || frontend === "desktop-window")) {
            menu.append(new MenuItem({
                icon: "iconFolder",
                label: t("openFileLocation", "打开文件位置"),
                click: () => openBy(currentSrc, "folder"),
            }).element);
            menu.append(new MenuItem({
                icon: "iconOpen",
                label: window.siyuan.languages.useDefault,
                click: () => openBy(currentSrc, "app"),
            }).element);
        }
        if ((frontend === "mobile" || frontend === "browser-mobile") && currentSrc) {
            const useSystemApp = isInAndroid() || isInHarmony();
            menu.append(new MenuItem({
                id: useSystemApp ? "useDefault" : "useBrowserView",
                icon: "iconOpen",
                label: useSystemApp ? window.siyuan.languages.useDefault : window.siyuan.languages.useBrowserView,
                click: () => openByMobile(currentSrc),
            }).element);
        }
        menu.append(new MenuItem({
            label: window.siyuan.languages.export,
            icon: "iconUpload",
            click: () => exportAsset(currentSrc),
        }).element);
        menu.append(new MenuItem({ type: "separator" }).element);
        menu.append(new MenuItem({
            icon: "iconEyeoff",
            label: t("toggleButtons", "显示/隐藏按钮"),
            click: () => {
                const stage = stageRect();
                showOptionButton = !showOptionButton;
                const nextFrame = frameFor(visual.width, visual.height);
                position = clampFloatPosition(
                    stage.left - nextFrame.offsetX,
                    stage.top - nextFrame.offsetY,
                    nextFrame.width,
                    nextFrame.height,
                );
            },
        }).element);

        menu.popup({ x: pos.x, y: pos.y });
        menu.element.style.zIndex = "999999";
        if (assetPath) {
            menu.removeCB = () => {
                if (ocrState.skip) {
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
        if (!text) {
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
        const cut = Array.from(full).length > NAME_LIMIT || target.scrollWidth > target.clientWidth + 1;
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

    function toggleImageNav() {
        showImageNav = !showImageNav;
        SettingService.ins.updateSettingCofnigValue("showImageNav", showImageNav);
    }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<div
    bind:this={floatEl}
    class="ipp-float"
    class:ipp-float--ready={ready}
    class:ipp-float--dragging={isDragging}
    class:ipp-float--instant={isDragging || isPinching || sizing}
    class:ipp-float--flash={flashing}
    class:ipp-float--chrome={showOptionButton}
    tabindex="0"
    style="left:{position.x}px;top:{position.y}px;width:{frame.width}px;height:{frame.height}px;--ipp-info:{PREVIEW_CHROME_INFO}px;--ipp-tools:{PREVIEW_CHROME_TOOLS}px"
    on:pointerdown={handlePointerDown}
    on:contextmenu|stopPropagation={handleContextmenu}
    on:touchstart={handleTouchStart}
    on:touchmove|stopPropagation={handleTouchMove}
    on:touchend|stopPropagation={handleTouchEnd}
>
    <div class="ipp-body">
        <div class="ipp-stage" style="width:{visual.width}px;height:{visual.height}px">
            {#if currentSrc}
                <img
                    class="ipp-image"
                    class:ipp-image--loading={loading}
                    src={currentSrc}
                    alt={fileName || "image"}
                    draggable="false"
                    style="width:{contentW}px;height:{contentH}px;transform:{imageCss};"
                />
            {/if}
            {#if loadError}
                <div class="ipp-status">{t("imageLoadFailed", "图片加载失败")}</div>
            {/if}
            {#if showOverlayClose}
                <button type="button" class="ipp-btn ipp-nav ipp-nav--close" aria-label={t("closeImage", "关闭图片", "close")} on:click|stopPropagation={handleCloseClick} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconClose"></use></svg>
                </button>
            {/if}
            {#if showOverlayNav}
                <button type="button" class="ipp-btn ipp-nav ipp-nav--prev" title={t("prevImage", "上一张", "previous")} on:click|stopPropagation={handlePrev} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconPrev"></use></svg>
                </button>
                <button type="button" class="ipp-btn ipp-nav ipp-nav--next" title={t("nextImage", "下一张", "next")} on:click|stopPropagation={handleNext} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconNext"></use></svg>
                </button>
            {/if}
        </div>
    </div>

    {#if showInfo}
        <div
            class="ipp-foot"
            class:ipp-foot--tools={toolsExpanded}
            on:pointerenter={openTools}
            on:pointerleave={closeTools}
        >
            <div class="ipp-info">
                <div class="ipp-info__names">
                    {#if fileName}
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
                    {#if distinctTitle}
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
                {#if images.length}
                    <span class="ipp-info__index">{currentIndex + 1} / {images.length}</span>
                {/if}
                {#if naturalW && naturalH}
                    <span class="ipp-info__dim">{naturalW} × {naturalH}</span>
                {/if}
            </div>
            <div class="ipp-tools">
            {#if showZoomButtons}
            <button type="button" class="ipp-btn" aria-label={t("zoomIn", "放大", "zoomIn")} on:click|stopPropagation={() => setScale(displayScale * 1.2)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconAdd"></use></svg>
            </button>
            <button type="button" class="ipp-btn" aria-label={t("zoomOut", "缩小", "zoomOut")} on:click|stopPropagation={() => setScale(displayScale / 1.2)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconLine"></use></svg>
            </button>
            {/if}
            <button type="button" class="ipp-btn" aria-label={t("actualSize", "实际大小", "pageScaleActual")} on:click|stopPropagation={() => setActualSize()} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon ipp-icon--line"><use xlink:href="#ippIconActual"></use></svg>
            </button>
            <button type="button" class="ipp-btn" class:ipp-btn--active={rotate !== 0} aria-label={t("rotateLeft", "向左旋转", "rotateCcw")} on:click|stopPropagation={() => rotateBy(-90)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconUndo"></use></svg>
            </button>
            <button type="button" class="ipp-btn" class:ipp-btn--active={rotate !== 0} aria-label={t("rotateRight", "向右旋转", "rotateCw")} on:click|stopPropagation={() => rotateBy(90)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconRedo"></use></svg>
            </button>
            <button type="button" class="ipp-btn" class:ipp-btn--active={flipH} aria-label={t("flipHorizontal", "水平翻转", "imageFlipHorizontal")} on:click|stopPropagation={() => flip("h")} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconSplitLR"></use></svg>
            </button>
            <button type="button" class="ipp-btn" class:ipp-btn--active={flipV} aria-label={t("flipVertical", "垂直翻转", "imageFlipVertical")} on:click|stopPropagation={() => flip("v")} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconSplitTB"></use></svg>
            </button>
            <button type="button" class="ipp-btn" aria-label={t("fitWindow", "适应窗口", "reset")} on:click|stopPropagation={fitToViewport} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconRefresh"></use></svg>
            </button>
            {#if showCopyFile}
                <button type="button" class="ipp-btn" aria-label={window.siyuan.languages.copyFile || t("copyFile", "复制文件")} on:click|stopPropagation={() => copyAssetFile(currentSrc)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconFile"></use></svg>
                </button>
            {:else if showCopyPNG}
                <button type="button" class="ipp-btn" aria-label={window.siyuan.languages.copyAsPNG || t("copyAsPNG", "复制为 PNG")} on:click|stopPropagation={() => copyPNGByLink(currentSrc)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconImage"></use></svg>
                </button>
            {:else if showExport}
                <button type="button" class="ipp-btn" aria-label={window.siyuan.languages.export} on:click|stopPropagation={() => exportAsset(currentSrc)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon ipp-icon--line"><use xlink:href="#iconUpload"></use></svg>
                </button>
            {/if}
            <button
                type="button"
                class="ipp-btn"
                class:ipp-btn--active={!showImageNav}
                aria-label={showImageNav ? t("hideImageIcons", "隐藏图片内图标") : t("showImageIcons", "显示图片内图标")}
                on:click|stopPropagation={toggleImageNav}
                on:pointerdown|stopPropagation
                on:dblclick|stopPropagation
            >
                <svg class="ipp-icon ipp-icon--line"><use xlink:href={showImageNav ? "#iconEyeoff" : "#iconEye"}></use></svg>
            </button>
            <button
                type="button"
                class="ipp-btn"
                class:ipp-btn--active={toolsPinned}
                aria-label={toolsPinned ? t("unpinToolbar", "取消钉住工具栏") : t("pinToolbar", "钉住工具栏")}
                on:click|stopPropagation={toggleToolsPin}
                on:pointerdown|stopPropagation
                on:dblclick|stopPropagation
            >
                <svg class="ipp-icon ipp-icon--line"><use xlink:href={toolsPinned ? "#iconUnpin" : "#iconPin"}></use></svg>
            </button>
            </div>
        </div>
    {/if}
</div>

<style>
    .ipp-float {
        --ipp-panel-bg: rgba(0, 0, 0, 0.62);
        position: fixed;
        z-index: 1;
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        user-select: none;
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
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        width: 100%;
        flex: none;
        background: var(--ipp-panel-bg);
        color: #fff;
        border-radius: 0 0 8px 8px;
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
    }

    .ipp-body::before,
    .ipp-body::after {
        content: "";
        flex: 1 1 auto;
        background: var(--ipp-panel-bg);
    }

    .ipp-stage {
        position: relative;
        flex: none;
    }

    .ipp-image {
        position: absolute;
        left: 50%;
        top: 50%;
        display: block;
        max-width: none !important;
        max-height: none !important;
        pointer-events: none;
        transform-origin: center center;
        transition: opacity 0.12s ease;
    }

    .ipp-image--loading {
        opacity: 0.75;
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

    .ipp-btn:hover {
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
        background: rgba(255, 255, 255, 0.5);
        color: var(--b3-theme-on-surface-light);
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.3);
        opacity: 0.5;
        z-index: 2;
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
        z-index: 3;
    }

    .ipp-stage:has(.ipp-nav:hover) .ipp-nav,
    .ipp-stage:has(.ipp-nav:focus-visible) .ipp-nav {
        opacity: 1;
        background: rgba(255, 255, 255, 0.82);
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
