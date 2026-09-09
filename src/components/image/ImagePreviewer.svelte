<script lang="ts">
    import { writeText } from "@/libs/siyuan/protyle/util/compatibility";
    import { openBy } from "@/libs/siyuan/editor/util";
    import { MenuItem } from "@/libs/siyuan/menus/Menu";
    import { copyPNGByLink, exportAsset } from "@/libs/siyuan/menus/util";
    import { isLocalPath } from "@/libs/siyuan/util/pathName";
    import { getFrontend } from "siyuan";
    import { onMount, onDestroy } from "svelte";
    import {
        getDistance,
        getEventPosition,
        getTouchCenterPosition,
        Vector2,
    } from "@/utils/position-util";
    import {
        clampDisplayScale,
        clampFloatPosition,
        containFloatInViewport,
        getViewportContainScale,
        getViewportFitScale,
        getVisualSize,
        imageFlipCss,
        keepCenter,
        switchDisplayScale,
        zoomKeepPoint,
    } from "@/service/image/ImagePreviewerService";
    import { SettingService } from "@/service/setting/SettingService";
    import { EnvConfig } from "@/config/EnvConfig";
    import { getImageFileName } from "@/utils/image-url";

    export let images: string[] = [];
    export let startIndex: number = 0;
    export let handleCloseClick: () => void = () => {};

    const DOUBLE_TAP_THRESHOLD = 300;
    const LONG_PRESS_MS = 350;
    const MIN_WIDTH = 80;
    const TOOLBAR_MIN_WIDTH = 300;
    const NAV_MIN_WIDTH = 168;
    const NAV_MIN_HEIGHT = 96;
    const CLOSE_MIN_SIZE = 88;

    let showOptionButton = SettingService.ins.SettingConfig?.showOptionButton !== false;
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
    let dragStartPos: Vector2 = { x: 0, y: 0 };
    let dragOrigin: Vector2 = { x: 0, y: 0 };
    let isPinching = false;
    let pinchStartDistance = 0;
    let pinchStartScale = 1;
    let pinchStartRect: DOMRect | null = null;
    let longPressTimeout: ReturnType<typeof setTimeout>;

    let floatEl: HTMLElement;

    $: contentW = Math.max(1, naturalW * displayScale);
    $: contentH = Math.max(1, naturalH * displayScale);
    $: visual = getVisualSize(naturalW, naturalH, displayScale, rotate);
    $: imageCss = imageFlipCss(rotate, flipH, flipV);
    $: fileName = getImageFileName(currentSrc || images[currentIndex] || "");
    $: showOverlayTools = showOptionButton && visual.width >= TOOLBAR_MIN_WIDTH;
    $: showOverlayNav = showOptionButton && images.length > 1 && visual.width >= NAV_MIN_WIDTH && visual.height >= NAV_MIN_HEIGHT;
    $: showOverlayClose = visual.width >= CLOSE_MIN_SIZE && visual.height >= CLOSE_MIN_SIZE;
    $: showOverlayFooter = visual.width >= 120 && visual.height >= 64;

    onMount(() => {
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", handlePointerUp);
        floatEl?.addEventListener("wheel", handleWheel, { passive: false });
        floatEl?.addEventListener("keydown", handleKeydown);
        openCurrent(true);
    });

    onDestroy(() => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        floatEl?.removeEventListener("wheel", handleWheel);
        floatEl?.removeEventListener("keydown", handleKeydown);
        clearTimeout(longPressTimeout);
    });

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

    function handlePointerDown(event: PointerEvent) {
        if (event.button !== 0 && event.button !== 1) {
            return;
        }
        if ((event.target as HTMLElement).closest("button")) {
            return;
        }
        window.siyuan?.menus?.menu?.remove();
        const pos = getEventPosition(event);
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
        dragStartPos = pos;
        dragOrigin = { ...position };
    }

    function handlePointerMove(event: PointerEvent) {
        if (!isDragging || isPinching) {
            return;
        }
        const pos = getEventPosition(event);
        applyPosition({
            x: dragOrigin.x + pos.x - dragStartPos.x,
            y: dragOrigin.y + pos.y - dragStartPos.y,
        });
    }

    function handlePointerUp() {
        isDragging = false;
    }

    function handleTouchStart(event: TouchEvent) {
        window.siyuan?.menus?.menu?.remove();
        if (event.touches.length === 2) {
            event.preventDefault();
            isPinching = true;
            isDragging = false;
            pinchStartDistance = getDistance(event.touches);
            pinchStartScale = displayScale;
            pinchStartRect = floatEl.getBoundingClientRect();
            clearTimeout(longPressTimeout);
            return;
        }
        if (event.touches.length === 1) {
            const pos = getEventPosition(event);
            longPressTimeout = setTimeout(() => {
                isDragging = false;
                openContextMenu(pos);
            }, LONG_PRESS_MS);
        }
    }

    function handleTouchMove(event: TouchEvent) {
        if (isPinching && event.touches.length === 2) {
            event.preventDefault();
            clearTimeout(longPressTimeout);
            const currentDistance = getDistance(event.touches);
            const center = getTouchCenterPosition(event.touches);
            const nextScale = pinchStartScale * (currentDistance / (pinchStartDistance || 1));
            if (center && pinchStartRect) {
                const nextSize = getVisualSize(
                    naturalW,
                    naturalH,
                    clampDisplayScale(nextScale, naturalW, MIN_WIDTH),
                    rotate,
                );
                position = clampFloatPosition(
                    zoomKeepPoint(pinchStartRect, nextSize.width, nextSize.height, center).x,
                    zoomKeepPoint(pinchStartRect, nextSize.width, nextSize.height, center).y,
                    nextSize.width,
                    nextSize.height,
                );
                displayScale = clampDisplayScale(nextScale, naturalW, MIN_WIDTH);
                lastCustomScale = displayScale;
            } else {
                setScale(nextScale);
            }
            return;
        }
        clearTimeout(longPressTimeout);
    }

    function handleTouchEnd(event: TouchEvent) {
        if (event.touches.length < 2) {
            isPinching = false;
            pinchStartRect = null;
        }
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
            copyPNGByLink(currentSrc);
            return;
        }
        if (event.ctrlKey && key === "c") {
            event.preventDefault();
            writeText(`![](${currentSrc})`);
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
            click: () => writeText(`![](${currentSrc})`),
        }).element);
        menu.append(new MenuItem({
            icon: "iconLink",
            label: `${window.siyuan.languages.copy} ${window.siyuan.languages.imageURL}`,
            click: () => writeText(currentSrc),
        }).element);
        menu.append(new MenuItem({
            icon: "iconImage",
            label: window.siyuan.languages.copyAsPNG,
            click: () => copyPNGByLink(currentSrc),
        }).element);
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
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<div
    bind:this={floatEl}
    class="ipp-float"
    class:ipp-float--ready={ready}
    class:ipp-float--dragging={isDragging}
    tabindex="0"
    style="left:{position.x}px;top:{position.y}px;width:{visual.width}px;height:{visual.height}px;"
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
        <div class="ipp-tools">
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
            <button type="button" class="ipp-btn" title={t("rotateLeft", "向左旋转", "rotateCcw")} on:click|stopPropagation={() => rotateBy(-90)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon"><use xlink:href="#ippIconRotateLeft"></use></svg>
            </button>
            <button type="button" class="ipp-btn" title={t("rotateRight", "向右旋转", "rotateCw")} on:click|stopPropagation={() => rotateBy(90)} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon"><use xlink:href="#ippIconRotateRight"></use></svg>
            </button>
            <button type="button" class="ipp-btn" title={t("flipHorizontal", "水平翻转", "imageFlipHorizontal")} on:click|stopPropagation={() => flip("h")} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon"><use xlink:href="#ippIconFlipH"></use></svg>
            </button>
            <button type="button" class="ipp-btn" title={t("flipVertical", "垂直翻转", "imageFlipVertical")} on:click|stopPropagation={() => flip("v")} on:pointerdown|stopPropagation on:dblclick|stopPropagation>
                <svg class="ipp-icon"><use xlink:href="#ippIconFlipV"></use></svg>
            </button>
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

    {#if showOverlayFooter}
        <div class="ipp-footer">
            {#if images.length}
                {currentIndex + 1} / {images.length}
            {/if}
            {#if naturalW && naturalH}
                <span class="ipp-footer__dim">{naturalW} × {naturalH}</span>
            {/if}
        </div>
    {/if}
</div>

<style>
    .ipp-float {
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
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 2px;
        padding: 3px;
        border-radius: 999px;
        background: rgba(0, 0, 0, 0.42);
        opacity: 0;
        z-index: 2;
        pointer-events: none;
    }

    .ipp-float:hover .ipp-tools,
    .ipp-float:focus .ipp-tools,
    .ipp-float:focus-within .ipp-tools {
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
    }

    .ipp-float:hover .ipp-nav,
    .ipp-nav:hover,
    .ipp-nav:focus {
        opacity: 1;
        background: rgba(255, 255, 255, 0.82);
    }

    .ipp-footer {
        position: absolute;
        left: 8px;
        bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
        max-width: calc(100% - 16px);
        padding: 3px 8px;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        font-size: 13px;
        line-height: 16px;
        z-index: 2;
        pointer-events: none;
    }

    .ipp-footer__dim {
        opacity: 0.86;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
</style>
