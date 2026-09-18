<script lang="ts">
    import { openBy } from "@/libs/siyuan/editor/util";
    import { MenuItem } from "@/libs/siyuan/menus/Menu";
    import { copyAssetFile, copyPNGByLink, exportAsset, getCopyFilePath } from "@/libs/siyuan/menus/util";
    import { canCopyImageToClipboard, copyPlainText, notifyCopyFailed, notifyCopySuccess } from "@/utils/clipboard";
    import { isLocalPath } from "@/libs/siyuan/util/pathName";
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
        getViewportContainScale,
        getViewportFitScale,
        getDockedCornerShape,
        getDockedShape,
        getMetaScale,
        getVisualSize,
        imageFlipCss,
        keepCenter,
        pickPinchFocalPoints,
        pinchZoomKeepFocal,
        switchDisplayScale,
        zoomKeepPoint,
    } from "@/service/image/ImagePreviewerService";
    import { SettingService } from "@/service/setting/SettingService";
    import { EnvConfig } from "@/config/EnvConfig";
    import { getDisplayImageName } from "@/utils/image-url";

    export let images: string[] = [];
    export let imageTitles: string[] = [];
    export let startIndex: number = 0;
    export let handleCloseClick: () => void = () => {};

    const DOUBLE_TAP_THRESHOLD = 300;
    const LONG_PRESS_MS = 350;
    const MIN_WIDTH = 80;
    const TOOLBAR_MIN_WIDTH = 300;
    const TOOLBAR_WITH_COPY_MIN_WIDTH = 332;
    const NAV_MIN_WIDTH = 168;
    const NAV_MIN_HEIGHT = 96;
    const CLOSE_MIN_SIZE = 88;
    const INDEX_MIN_WIDTH = 72;
    const INDEX_MIN_HEIGHT = 48;
    const META_MIN_WIDTH = 160;
    const META_MIN_HEIGHT = 80;
    const NAME_MIN_WIDTH = 240;
    const TOOLBAR_LARGE_MIN_WIDTH = 520;
    const TOOLBAR_LARGE_MIN_HEIGHT = 240;
    const META_COMPACT_SCALE = 0.75;
    const META_COMPACT_HEIGHT = 140;
    const BAR_FILLET = 12;
    const TAB_FILLET = 8;
    const CORNER_FILLET = 8;
    const CORNER_FILLET_MIN = 4;

    let showOptionButton = SettingService.ins.SettingConfig?.showOptionButton !== false;
    let dockToolbar = SettingService.ins.SettingConfig?.dockToolbar !== false;
    let toolsExpanded = false;
    let dockHold = false;
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
    let tabBoxWidth = 0;
    let tabBoxHeight = 0;
    let barBoxWidth = 0;
    let barBoxHeight = 0;
    let metaBoxWidth = 0;
    let metaBoxHeight = 0;
    let indexBoxWidth = 0;
    let indexBoxHeight = 0;
    let flashing = false;
    let flashTimer: ReturnType<typeof setTimeout> | undefined;

    $: contentW = Math.max(1, naturalW * displayScale);
    $: contentH = Math.max(1, naturalH * displayScale);
    $: visual = getVisualSize(naturalW, naturalH, displayScale, rotate);
    $: imageCss = imageFlipCss(rotate, flipH, flipV);
    $: fileName = getDisplayImageName(currentSrc || images[currentIndex] || "");
    $: imageTitle = (imageTitles[currentIndex] || "").trim();
    $: showTitle = !!imageTitle && imageTitle !== fileName;
    $: showCopyFile = !!getCopyFilePath(currentSrc || images[currentIndex] || "");
    $: showCopyPNG = canCopyImageToClipboard();
    $: showToolbarCopy = showCopyFile || showCopyPNG;
    $: toolbarFullMinWidth = showToolbarCopy ? TOOLBAR_WITH_COPY_MIN_WIDTH : TOOLBAR_MIN_WIDTH;
    $: showOverlayTools = showOptionButton && visual.width >= toolbarFullMinWidth;
    $: toolbarLarge = visual.width >= TOOLBAR_LARGE_MIN_WIDTH && visual.height >= TOOLBAR_LARGE_MIN_HEIGHT;
    $: toolbarDocked = showOverlayTools && (dockToolbar || !toolbarLarge);
    $: showOverlayNav = showOptionButton && images.length > 1 && visual.width >= NAV_MIN_WIDTH && visual.height >= NAV_MIN_HEIGHT;
    $: showOverlayClose = visual.width >= CLOSE_MIN_SIZE && visual.height >= CLOSE_MIN_SIZE;
    $: showOverlayIndex = showOptionButton && visual.width >= INDEX_MIN_WIDTH && visual.height >= INDEX_MIN_HEIGHT;
    $: canShowMeta = showOptionButton && visual.width >= META_MIN_WIDTH && visual.height >= META_MIN_HEIGHT;
    $: showOverlayName = canShowMeta && visual.width >= NAME_MIN_WIDTH;
    $: showOverlayMeta = canShowMeta && ((showOverlayName && (!!fileName || showTitle)) || !!(naturalW && naturalH));
    $: metaScale = getMetaScale(visual.width, visual.height);
    $: metaCompact = canShowMeta && (metaScale < META_COMPACT_SCALE || visual.height < META_COMPACT_HEIGHT);
    $: compactName = showTitle ? imageTitle : fileName;
    $: compactNameKey = showTitle ? "title" : "name";
    $: tabWidth = Math.round(Math.min(380, Math.max(240, visual.width * 0.42)));
    $: tabHeight = Math.round(Math.min(14, Math.max(10, visual.width * 0.018)));
    $: tabShape = getDockedShape(tabBoxWidth || tabWidth, tabBoxHeight || tabHeight, TAB_FILLET);
    $: barShape = getDockedShape(barBoxWidth, barBoxHeight, BAR_FILLET);
    $: cornerFillet = Math.min(CORNER_FILLET, Math.max(CORNER_FILLET_MIN, CORNER_FILLET * metaScale));
    $: metaShape = getDockedCornerShape(metaBoxWidth, metaBoxHeight, cornerFillet, cornerFillet, "left");
    $: indexShape = getDockedCornerShape(indexBoxWidth, indexBoxHeight, cornerFillet, cornerFillet, "right");

    let copiedTipKey = "";

    onMount(() => {
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        window.addEventListener("touchstart", handleWindowTouchStart, { capture: true, passive: false });
        window.addEventListener("touchmove", handleWindowTouchMove, { capture: true, passive: false });
        window.addEventListener("touchend", handleWindowTouchEnd, { capture: true, passive: false });
        window.addEventListener("touchcancel", handleWindowTouchEnd, { capture: true, passive: false });
        floatEl?.addEventListener("wheel", handleWheel, { passive: false });
        floatEl?.addEventListener("keydown", handleKeydown);
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
        floatEl?.removeEventListener("wheel", handleWheel);
        floatEl?.removeEventListener("keydown", handleKeydown);
        clearTimeout(longPressTimeout);
        clearTimeout(flashTimer);
    });

    export function getCurrentSrc(): string {
        return currentSrc || images[currentIndex] || "";
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

    function applyPosition(next: Vector2) {
        position = clampFloatPosition(next.x, next.y, visual.width, visual.height);
    }

    function placeAtCenter(nextScale = displayScale, nextRotate = rotate) {
        const size = getVisualSize(naturalW, naturalH, nextScale, nextRotate);
        const x = (window.innerWidth - size.width) / 2;
        const y = (window.innerHeight - size.height) / 2;
        position = containFloatInViewport(x, y, size.width, size.height);
    }

    function keepCurrentCenter(nextScale: number, nextRotate = rotate, stayOnScreen = false) {
        const nextSize = getVisualSize(naturalW, naturalH, nextScale, nextRotate);
        const next = keepCenter(position.x, position.y, visual.width, visual.height, nextSize.width, nextSize.height);
        position = stayOnScreen
            ? containFloatInViewport(next.x, next.y, nextSize.width, nextSize.height)
            : clampFloatPosition(next.x, next.y, nextSize.width, nextSize.height);
    }

    function setScale(nextScale: number, zoomPosition?: Vector2) {
        const scale = clampDisplayScale(nextScale, naturalW, MIN_WIDTH);
        const nextSize = getVisualSize(naturalW, naturalH, scale, rotate);
        if (zoomPosition && floatEl) {
            const next = zoomKeepPoint(floatEl.getBoundingClientRect(), nextSize.width, nextSize.height, zoomPosition);
            position = clampFloatPosition(next.x, next.y, nextSize.width, nextSize.height);
        } else {
            keepCurrentCenter(scale, rotate);
        }
        displayScale = scale;
        lastCustomScale = scale;
    }

    function fitToViewport() {
        const scale = getViewportFitScale(naturalW, naturalH, rotate);
        displayScale = scale;
        lastCustomScale = 0;
        keepCurrentCenter(scale, rotate, true);
    }

    function setActualSize(zoomPosition?: Vector2) {
        setScale(1, zoomPosition);
    }

    function toggleFitOrActual(pos: Vector2) {
        const fitScale = getViewportFitScale(naturalW, naturalH, rotate);
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
        const nextScale = Math.min(displayScale, getViewportContainScale(naturalW, naturalH, nextRotate));
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
        const oldPos = { ...position };
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
                displayScale = getViewportFitScale(naturalW, naturalH, 0);
                lastCustomScale = 0;
                placeAtCenter(displayScale, 0);
                ready = true;
                requestAnimationFrame(() => floatEl?.focus());
            } else {
                displayScale = switchDisplayScale(naturalW, naturalH, keepWidth, 0);
                const nextSize = getVisualSize(naturalW, naturalH, displayScale, 0);
                const next = keepCenter(
                    oldPos.x,
                    oldPos.y,
                    oldVisual.width,
                    oldVisual.height,
                    nextSize.width,
                    nextSize.height,
                );
                position = containFloatInViewport(next.x, next.y, nextSize.width, nextSize.height);
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
        return {
            left: position.x,
            top: position.y,
            width: visual.width,
            height: visual.height,
        };
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
        position = clampFloatPosition(next.x, next.y, nextSize.width, nextSize.height);
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
        if (toolbarDocked && toolsExpanded && isCoarsePointer() && !target.closest(".ipp-tools")) {
            toolsExpanded = false;
            return;
        }
        if (target.closest("button")) {
            return;
        }
        if (isPinching || (dragPointerId !== null && event.pointerId !== dragPointerId)) {
            return;
        }
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

    function handleKeydown(event: KeyboardEvent) {
        event.stopPropagation();
        const key = event.key.toLowerCase();
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
        if (event.ctrlKey && event.shiftKey && key === "c") {
            event.preventDefault();
            if (!showCopyPNG) {
                notifyCopyFailed("permission");
                return;
            }
            copyPNGByLink(currentSrc);
            return;
        }
        if (event.ctrlKey && key === "c") {
            event.preventDefault();
            copyPlainText(`![](${currentSrc})`).then((ok) => ok ? notifyCopySuccess() : notifyCopyFailed("text"));
        }
    }

    function initSizeAndPosition() {
        displayScale = getViewportFitScale(naturalW, naturalH, 0);
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
            x = (window.innerWidth - visual.width) / 2;
            y = (window.innerHeight - visual.height) / 2;
        } else if (direction === "top") {
            y = 0;
        } else if (direction === "bottom") {
            y = window.innerHeight - visual.height;
        } else if (direction === "left") {
            x = 0;
        } else if (direction === "right") {
            x = window.innerWidth - visual.width;
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
        menu.append(new MenuItem({ icon: "ippIconFit", label: t("fitWindow", "适应窗口", "reset"), click: fitToViewport }).element);
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
                showOptionButton = !showOptionButton;
            },
        }).element);

        menu.popup({ x: pos.x, y: pos.y });
        menu.element.style.zIndex = "999999";
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
                return;
            }
            copiedTipKey = "";
            notifyCopyFailed("text");
        });
    }

    function hideCopyTip() {
        copiedTipKey = "";
    }

    function isCoarsePointer() {
        return EnvConfig.ins.isMobile || !!window.matchMedia?.("(hover: none), (pointer: coarse)").matches;
    }

    function toggleDockToolbar(event: MouseEvent) {
        dockToolbar = !dockToolbar;
        SettingService.ins.updateSettingCofnigValue("dockToolbar", dockToolbar);
        if (dockToolbar) {
            toolsExpanded = false;
            dockHold = true;
            (event.currentTarget as HTMLButtonElement | null)?.blur();
        }
    }

    function handleToolsPointerEnter() {
        if (dockHold || !toolbarDocked) {
            return;
        }
        toolsExpanded = true;
    }

    function handleToolsPointerLeave() {
        dockHold = false;
        if (toolbarDocked && !isCoarsePointer()) {
            toolsExpanded = false;
        }
    }

    function handleTabActivate(event: Event) {
        event.stopPropagation();
        if (!toolbarDocked) {
            return;
        }
        toolsExpanded = true;
        dockHold = false;
    }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<div
    bind:this={floatEl}
    class="ipp-float"
    class:ipp-float--ready={ready}
    class:ipp-float--dragging={isDragging}
    class:ipp-float--flash={flashing}
    tabindex="0"
    style="left:{position.x}px;top:{position.y}px;width:{visual.width}px;height:{visual.height}px;--ipp-meta-scale:{metaScale};--ipp-tab-w:{tabWidth}px;--ipp-tab-h:{tabHeight}px"
    on:pointerdown={handlePointerDown}
    on:contextmenu|stopPropagation={handleContextmenu}
    on:touchstart={handleTouchStart}
    on:touchmove|stopPropagation={handleTouchMove}
    on:touchend|stopPropagation={handleTouchEnd}
>
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

    {#if showOverlayTools}
        <div
            class="ipp-tools"
            class:ipp-tools--docked={toolbarDocked}
            class:ipp-tools--open={toolbarDocked && toolsExpanded}
            class:ipp-tools--avoid-close={showOverlayClose}
            on:pointerenter={handleToolsPointerEnter}
            on:pointerleave={handleToolsPointerLeave}
        >
            {#if toolbarDocked}
                <div
                    class="ipp-tools__tab"
                    bind:clientWidth={tabBoxWidth}
                    bind:clientHeight={tabBoxHeight}
                    on:pointerdown|stopPropagation={handleTabActivate}
                    on:click|stopPropagation={handleTabActivate}
                >
                    <svg
                        class="ipp-shape ipp-tools__shape"
                        style="left:{-tabShape.fillet}px"
                        width={tabShape.width}
                        height={tabShape.height}
                        viewBox="0 0 {tabShape.width} {tabShape.height}"
                        aria-hidden="true"
                    ><path d={tabShape.path} /></svg>
                    <span class="ipp-tools__tab-bar"></span>
                </div>
            {/if}
            <div class="ipp-tools__bar" bind:clientWidth={barBoxWidth} bind:clientHeight={barBoxHeight}>
                <svg
                    class="ipp-shape ipp-tools__shape"
                    style="left:{-barShape.fillet}px"
                    width={barShape.width}
                    height={barShape.height}
                    viewBox="0 0 {barShape.width} {barShape.height}"
                    aria-hidden="true"
                ><path d={barShape.path} /></svg>
                <button type="button" class="ipp-btn" title={t("zoomOut", "缩小", "zoomOut")} on:click|stopPropagation={() => setScale(displayScale / 1.2)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconZoomOut"></use></svg>
                </button>
                <button type="button" class="ipp-btn" title={t("zoomIn", "放大", "zoomIn")} on:click|stopPropagation={() => setScale(displayScale * 1.2)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconZoomIn"></use></svg>
                </button>
                <button type="button" class="ipp-btn" title={t("actualSize", "实际大小", "pageScaleActual")} on:click|stopPropagation={() => setActualSize()} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconActual"></use></svg>
                </button>
                <button type="button" class="ipp-btn" title={t("fitWindow", "适应窗口", "reset")} on:click|stopPropagation={fitToViewport} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconFit"></use></svg>
                </button>
                <button type="button" class="ipp-btn" class:ipp-btn--active={rotate !== 0} title={t("rotateLeft", "向左旋转", "rotateCcw")} on:click|stopPropagation={() => rotateBy(-90)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconRotateLeft"></use></svg>
                </button>
                <button type="button" class="ipp-btn" class:ipp-btn--active={rotate !== 0} title={t("rotateRight", "向右旋转", "rotateCw")} on:click|stopPropagation={() => rotateBy(90)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconRotateRight"></use></svg>
                </button>
                <button type="button" class="ipp-btn" class:ipp-btn--active={flipH} title={t("flipHorizontal", "水平翻转", "imageFlipHorizontal")} on:click|stopPropagation={() => flip("h")} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconFlipH"></use></svg>
                </button>
                <button type="button" class="ipp-btn" class:ipp-btn--active={flipV} title={t("flipVertical", "垂直翻转", "imageFlipVertical")} on:click|stopPropagation={() => flip("v")} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                    <svg class="ipp-icon"><use xlink:href="#ippIconFlipV"></use></svg>
                </button>
                {#if showCopyFile}
                    <button type="button" class="ipp-btn" title={window.siyuan.languages.copyFile || t("copyFile", "复制文件")} on:click|stopPropagation={() => copyAssetFile(currentSrc)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                        <svg class="ipp-icon"><use xlink:href="#ippIconCopyFile"></use></svg>
                    </button>
                {:else if showCopyPNG}
                    <button type="button" class="ipp-btn" title={window.siyuan.languages.copyAsPNG || t("copyAsPNG", "复制为 PNG")} on:click|stopPropagation={() => copyPNGByLink(currentSrc)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                        <svg class="ipp-icon"><use xlink:href="#ippIconCopyPNG"></use></svg>
                    </button>
                {/if}
                <button
                    type="button"
                    class="ipp-btn"
                    class:ipp-btn--active={dockToolbar}
                    title={dockToolbar ? t("undockToolbar", "取消吸附") : t("dockToolbar", "吸附顶部")}
                    on:click|stopPropagation={toggleDockToolbar}
                    on:pointerdown|stopPropagation
                    on:dblclick|stopPropagation
                >
                    <svg class="ipp-icon"><use xlink:href="#ippIconDock"></use></svg>
                </button>
            </div>
        </div>
    {/if}

    {#if showOverlayClose}
        <button type="button" class="ipp-btn ipp-nav ipp-nav--close" title={t("closeImage", "关闭图片", "close")} on:click|stopPropagation={handleCloseClick} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
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

    {#if showOverlayIndex && images.length}
        <div class="ipp-index" bind:clientWidth={indexBoxWidth} bind:clientHeight={indexBoxHeight}>
            <svg
                class="ipp-shape ipp-index__shape"
                width={indexShape.width}
                height={indexShape.height}
                viewBox="0 0 {indexShape.width} {indexShape.height}"
                aria-hidden="true"
            ><path d={indexShape.path} /></svg>
            <span class="ipp-index__text">{currentIndex + 1} / {images.length}</span>
        </div>
    {/if}

    {#if showOverlayMeta}
        <div
            class="ipp-meta"
            class:ipp-meta--compact={metaCompact}
            bind:clientWidth={metaBoxWidth}
            bind:clientHeight={metaBoxHeight}
        >
            <svg
                class="ipp-shape ipp-meta__shape"
                width={metaShape.width}
                height={metaShape.height}
                viewBox="0 0 {metaShape.width} {metaShape.height}"
                aria-hidden="true"
            ><path d={metaShape.path} /></svg>
            {#if metaCompact}
                {#if showOverlayName && compactName}
                    <span class="ipp-copy" on:pointerleave={hideCopyTip}>
                        <button
                            type="button"
                            class="ipp-copy__text"
                            on:click|stopPropagation={(event) => copyOverlayText(event, compactNameKey, compactName)}
                            on:pointerdown|stopPropagation
                            on:dblclick|stopPropagation
                        >{compactName}</button>
                        <span class="ipp-copy__tip">{copiedTipKey === compactNameKey ? t("copiedSuccess", "复制成功") : t("clickToCopy", "点击复制")}</span>
                    </span>
                    {#if naturalW && naturalH}
                        <span class="ipp-meta__sep">·</span>
                    {/if}
                {/if}
                {#if naturalW && naturalH}
                    <span class="ipp-meta__dim">{naturalW} × {naturalH}</span>
                {/if}
            {:else}
                {#if showOverlayName && showTitle}
                    <span class="ipp-copy" on:pointerleave={hideCopyTip}>
                        <button
                            type="button"
                            class="ipp-copy__text"
                            on:click|stopPropagation={(event) => copyOverlayText(event, "title", imageTitle)}
                            on:pointerdown|stopPropagation
                            on:dblclick|stopPropagation
                        >{imageTitle}</button>
                        <span class="ipp-copy__tip">{copiedTipKey === "title" ? t("copiedSuccess", "复制成功") : t("clickToCopy", "点击复制")}</span>
                    </span>
                {/if}
                {#if showOverlayName && fileName}
                    <span class="ipp-copy" on:pointerleave={hideCopyTip}>
                        <button
                            type="button"
                            class="ipp-copy__text"
                            on:click|stopPropagation={(event) => copyOverlayText(event, "name", fileName)}
                            on:pointerdown|stopPropagation
                            on:dblclick|stopPropagation
                        >{fileName}</button>
                        <span class="ipp-copy__tip">{copiedTipKey === "name" ? t("copiedSuccess", "复制成功") : t("clickToCopy", "点击复制")}</span>
                    </span>
                {/if}
                {#if naturalW && naturalH}
                    <span class="ipp-meta__dim">{naturalW} × {naturalH}</span>
                {/if}
            {/if}
        </div>
    {/if}
</div>

<style>
    .ipp-float {
        --ipp-meta-font: clamp(9px, calc(12px * var(--ipp-meta-scale, 1)), 12px);
        --ipp-meta-line: clamp(12px, calc(16px * var(--ipp-meta-scale, 1)), 16px);
        --ipp-meta-pad-y: clamp(3px, calc(5px * var(--ipp-meta-scale, 1)), 5px);
        --ipp-meta-pad-x: clamp(4px, calc(8px * var(--ipp-meta-scale, 1)), 8px);
        --ipp-meta-gap: clamp(1px, calc(2px * var(--ipp-meta-scale, 1)), 2px);
        --ipp-meta-radius: clamp(4px, calc(8px * var(--ipp-meta-scale, 1)), 8px);
        --ipp-meta-tip-font: clamp(9px, calc(11px * var(--ipp-meta-scale, 1)), 11px);
        --ipp-meta-tip-pad-y: clamp(2px, calc(3px * var(--ipp-meta-scale, 1)), 3px);
        --ipp-meta-tip-pad-x: clamp(5px, calc(8px * var(--ipp-meta-scale, 1)), 8px);
        --ipp-meta-tip-gap: clamp(3px, calc(6px * var(--ipp-meta-scale, 1)), 6px);
        --ipp-index-reserve: clamp(48px, calc(72px * var(--ipp-meta-scale, 1)), 72px);
        --ipp-panel-bg: rgba(0, 0, 0, 0.55);
        position: fixed;
        z-index: 1;
        pointer-events: auto;
        user-select: none;
        visibility: hidden;
        overflow: visible;
        background: transparent;
        outline: none;
        cursor: grab;
        touch-action: none;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
    }

    .ipp-float--ready {
        visibility: visible;
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
        pointer-events: none;
        text-shadow: 0 1px 4px rgba(0, 0, 0, 0.7);
    }

    .ipp-tools {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        z-index: 2;
        pointer-events: none;
    }

    /* 面板底色整体由一条路径绘制，内凹圆角与直边相切，不会出现拼接痕迹。 */
    .ipp-shape {
        position: absolute;
        display: block;
        fill: var(--ipp-panel-bg);
        pointer-events: none;
    }

    .ipp-tools__shape {
        top: 0;
    }

    .ipp-meta__shape {
        left: 0;
        bottom: 0;
    }

    .ipp-index__shape {
        right: 0;
        bottom: 0;
    }

    .ipp-tools--docked {
        height: var(--ipp-tab-h);
    }

    .ipp-tools__tab {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        justify-content: center;
        width: var(--ipp-tab-w);
        height: var(--ipp-tab-h);
        cursor: pointer;
        pointer-events: auto;
    }

    .ipp-tools--avoid-close .ipp-tools__tab {
        max-width: calc(100% - 72px);
    }

    .ipp-tools__tab-bar {
        position: relative;
        display: block;
        width: calc(var(--ipp-tab-w) * 0.37);
        height: 3px;
        border-radius: 999px;
        background: rgba(255, 255, 255, 0.7);
    }

    .ipp-tools__bar {
        position: absolute;
        top: 0;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 6px 14px 8px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.16s ease;
    }

    .ipp-tools__bar .ipp-btn {
        position: relative;
    }

    .ipp-float:hover .ipp-tools:not(.ipp-tools--docked) .ipp-tools__bar,
    .ipp-float:focus .ipp-tools:not(.ipp-tools--docked) .ipp-tools__bar,
    .ipp-float:focus-within .ipp-tools:not(.ipp-tools--docked) .ipp-tools__bar {
        opacity: 1;
        pointer-events: auto;
    }

    .ipp-tools--docked.ipp-tools--open .ipp-tools__tab {
        opacity: 0;
    }

    .ipp-tools--docked.ipp-tools--open .ipp-tools__bar {
        opacity: 1;
        pointer-events: auto;
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
        overflow: hidden;
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

    .ipp-float:hover .ipp-nav,
    .ipp-nav:hover,
    .ipp-nav:focus {
        opacity: 1;
        background: rgba(255, 255, 255, 0.82);
    }

    /* 贴角摆放，两个角落面板用同一组内边距，单行时高度一致。 */
    .ipp-index {
        position: absolute;
        right: 0;
        bottom: 0;
        padding: var(--ipp-meta-pad-y) var(--ipp-meta-pad-x);
        color: #fff;
        font-size: var(--ipp-meta-font);
        line-height: var(--ipp-meta-line);
        z-index: 2;
        pointer-events: none;
        white-space: nowrap;
    }

    .ipp-index__text {
        position: relative;
    }

    .ipp-meta {
        position: absolute;
        left: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: var(--ipp-meta-gap);
        max-width: calc(100% - var(--ipp-index-reserve));
        padding: var(--ipp-meta-pad-y) var(--ipp-meta-pad-x);
        color: #fff;
        font-size: var(--ipp-meta-font);
        line-height: var(--ipp-meta-line);
        z-index: 2;
        pointer-events: none;
    }

    .ipp-meta--compact {
        flex-direction: row;
        align-items: center;
        flex-wrap: nowrap;
    }

    .ipp-meta--compact .ipp-copy {
        display: inline-block;
        min-width: 0;
        max-width: 60%;
    }

    .ipp-meta__sep {
        position: relative;
        flex: 0 0 auto;
        opacity: 0.7;
    }

    .ipp-copy {
        position: relative;
        display: block;
        max-width: 100%;
        pointer-events: auto;
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
        cursor: pointer;
    }

    .ipp-copy__text:hover {
        text-decoration: underline;
    }

    .ipp-copy__tip {
        position: absolute;
        left: 0;
        bottom: calc(100% + var(--ipp-meta-tip-gap));
        padding: var(--ipp-meta-tip-pad-y) var(--ipp-meta-tip-pad-x);
        border-radius: calc(var(--ipp-meta-radius) * 0.75);
        background: var(--ipp-panel-bg);
        color: #fff;
        font-size: var(--ipp-meta-tip-font);
        line-height: var(--ipp-meta-line);
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease;
    }

    .ipp-copy:hover .ipp-copy__tip {
        opacity: 1;
    }

    .ipp-meta__dim {
        position: relative;
        opacity: 0.86;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 100%;
    }
</style>
