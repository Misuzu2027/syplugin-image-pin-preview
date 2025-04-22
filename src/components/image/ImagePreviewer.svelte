<script lang="ts">
    import { isStrBlank, isStrNotBlank } from "@/utils/string-util";
    import { onMount, onDestroy } from "svelte";

    export let images: string[] = [];
    export let startIndex: number = 0;
    export let onClose: () => void = () => {};

    let currentIndex = startIndex;
    let containerScale = 1;
    let maxScale = 4;
    let minWidth = 80;
    let lastUpdateWidth: number;

    let position = { x: 0, y: 0 };
    let positionLimit = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

    let isDragging = false;
    let dragStartPos = { x: 0, y: 0 };
    let containerStart = { x: 0, y: 0 };

    let containerElementRef: HTMLElement;
    let imageElementRef: HTMLImageElement;

    onMount(() => {
        imageElementRef.src = images[currentIndex];
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
        window.addEventListener("touchstart", onTouchStart);
        window.addEventListener("touchmove", onTouchMove, { passive: false });
        window.addEventListener("touchend", onTouchEnd);
        containerElementRef.addEventListener("keydown", handleKeydown);
        let maxWidth = window.innerWidth * 0.8;
        if (imageElementRef.naturalWidth > maxWidth) {
            containerElementRef.style.width = maxWidth + "px";
        }
    
        containerElementRef.focus();

        centerImage();
    });

    onDestroy(() => {
        window.removeEventListener("mouseup", onMouseUp);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("touchstart", onTouchStart);
        window.removeEventListener("touchmove", onTouchMove);
        window.removeEventListener("touchend", onTouchEnd);
        containerElementRef.removeEventListener("keydown", handleKeydown);
    });

    function onWheel(event: WheelEvent) {
        // event.preventDefault();

        // 计算滚动的缩放量
        const delta = event.deltaY;

        if (event.ctrlKey) {
            position.y = position.y - delta * 0.3;
        }
        if (event.shiftKey) {
            position.x = position.x + delta * 0.3;
        }
        if (event.ctrlKey || event.shiftKey) {
            updatePositionLimit();
            checkPositionLimit();
            return;
        }
        zoomImage(-delta);
    }

    function zoomImage(scaleFactor: number) {
        let oldContainerRect = containerElementRef.getBoundingClientRect();
        let imageNaturalWidth = imageElementRef.naturalWidth;

        // 获取图片的当前宽度
        let containerWidth = containerElementRef.style.width;
        let containerWidthNum = 0;
        if (isStrNotBlank(containerWidth) && containerWidth.indexOf("px")) {
            containerWidthNum = Number(containerWidth.replace("px", ""));
        } else {
            containerWidthNum = oldContainerRect.width;
        }

        // 如果当前容器宽度大于图片宽度，说明用了 scale
        if (
            containerScale > 1 ||
            (containerWidthNum == imageNaturalWidth && scaleFactor > 0)
        ) {
            const scaleAmount = scaleFactor * 0.0005;
            // 计算新的缩放比例，并限制缩放的最小值
            const newScale = Math.min(
                maxScale,
                Math.max(1, containerScale + scaleAmount),
            );
            if (newScale !== containerScale) {
                containerScale = newScale;
            }
            if (containerScale > 1) {
                lastUpdateWidth =
                    containerElementRef.getBoundingClientRect().width;
            }
        } else {
            // 设置缩放步长，根据滚动的速度调整步长
            const widthAmount = scaleFactor * 0.3; // 控制缩放速度，你可以调整这个值来改变滚动的敏感度

            const newWidth = Math.min(
                imageElementRef.naturalWidth,
                Math.max(containerWidthNum + widthAmount, minWidth),
            );
            // 设置容器的新宽度
            containerElementRef.style.width = `${newWidth}px`;
            lastUpdateWidth = newWidth;
        }

        keepCenterPosition(oldContainerRect, 1);

        // 可以根据新的宽度，更新位置限制等其他逻辑
        setTimeout(() => {
            updatePositionLimit();
            checkPositionLimit();
        }, 60);
    }

    function getEventPosition(event: MouseEvent | TouchEvent): {
        x: number;
        y: number;
    } {
        if (event instanceof TouchEvent) {
            const touch = event.touches[0] || event.changedTouches[0];
            return { x: touch.clientX, y: touch.clientY };
        } else {
            return { x: event.clientX, y: event.clientY };
        }
    }

    function onMouseDown(event: MouseEvent) {
        const pos = getEventPosition(event);
        startImageDrag(pos);
    }
    let isZoomIn = false;

    function onTouchStart(event: TouchEvent) {
        // 双指是照片缩放
        if (event instanceof TouchEvent && event.touches.length === 2) {
            event.preventDefault(); // 防止页面缩放
            event.stopPropagation();
            isZoomIn = true;

            touchStartDistance = getDistance(event.touches);
            return;
        }
        // 单指开始移动
        if (event.currentTarget == containerElementRef) {
            event.preventDefault();
            event.stopPropagation();
            const pos = getEventPosition(event);
            startImageDrag(pos);
        }
    }

    function startImageDrag(pos: { x: number; y: number }) {
        isDragging = true;
        updatePositionLimit();
        dragStartPos = pos;
        containerStart = { ...position };
    }

    function moveImageDrag(pos: { x: number; y: number }) {
        if (!isDragging) return;

        const dx = pos.x - dragStartPos.x;
        const dy = pos.y - dragStartPos.y;
        let newX = containerStart.x + dx;
        let newY = containerStart.y + dy;

        position = {
            x: newX,
            y: newY,
        };
        checkPositionLimit();
    }

    function onMouseMove(event: MouseEvent) {
        const pos = getEventPosition(event);
        moveImageDrag(pos);
    }

    function onMouseUp() {
        isDragging = false;
        // console.log("onMouseUp position ", position);
    }

    function onTouchEnd(event: TouchEvent) {
        if (event.touches.length < 2) {
            // 双指操作结束
            touchStartDistance = 0;

            isZoomIn = false;
        }
        isDragging = false;
    }

    let lastTapTime = 0;
    const DOUBLE_TAP_THRESHOLD = 300; // 毫秒，双击间隔上限

    function onClick() {
        const currentTime = new Date().getTime();
        const timeDiff = currentTime - lastTapTime;

        if (timeDiff < DOUBLE_TAP_THRESHOLD && timeDiff > 0 && !isZoomIn) {
            let oldContainerRect = containerElementRef.getBoundingClientRect();
            containerScale = 1;
            let minWidth = Math.min(
                imageElementRef.naturalWidth,
                window.innerWidth * 0.8,
            );
            containerElementRef.style.width = minWidth + "px";
            keepCenterPosition(oldContainerRect, 1);
        }

        lastTapTime = currentTime;
    }

    function onContextmenu(event) {
        event.stopPropagation();
        event.preventDefault();
        alert("onContextmenu");
    }

    function updatePositionLimit() {
        // 限制拖拽范围，确保图片不会拖到父容器外面
        const containerRect = containerElementRef.getBoundingClientRect();

        let minDef = 90;
        let widthScaleOffset = 0;
        let heightScaleOffset = 0;
        if (containerScale > 1) {
            widthScaleOffset =
                (containerRect.width - containerRect.width / containerScale) /
                2;
            heightScaleOffset =
                (containerRect.height - containerRect.height / containerScale) /
                2;
        }

        let minX = -containerRect.width + minDef + widthScaleOffset;
        let maxX = window.innerWidth - minDef + widthScaleOffset;
        let minY = -containerRect.height + minDef + heightScaleOffset;
        let maxY = window.innerHeight - minDef + heightScaleOffset;
        positionLimit = { minX, maxX, minY, maxY };

        // console.log(
        //     "scale ",
        //     scale,
        //     ", containerRect ",
        //     containerRect,
        //     " , positionLimit ",
        //     positionLimit,
        // );
    }
    function checkPositionLimit() {
        let minX = positionLimit.minX;
        let maxX = positionLimit.maxX;
        let minY = positionLimit.minY;
        let maxY = positionLimit.maxY;

        let newX = Math.min(maxX, Math.max(position.x, minX));
        let newY = Math.min(maxY, Math.max(position.y, minY));

        if (position.x != newX || position.y != newY) {
            position = {
                x: newX,
                y: newY,
            };
        }
    }

    /**
     * 手机端放大缩小
     */
    let touchStartDistance = 0;

    function getDistance(touches: TouchList) {
        const dx = touches[0].clientX - touches[1].clientX;
        const dy = touches[0].clientY - touches[1].clientY;
        // console.log(`getDistance dx ${dx} , dy ${dy}`);
        return Math.sqrt(dx * dx + dy * dy);
    }

    function onTouchMove(event: TouchEvent) {
        if (event.touches.length === 2) {
            event.preventDefault();
            event.stopPropagation();
            lastTapTime = 0;
            const currentDistance = getDistance(event.touches);
            let scaleChange = (currentDistance / touchStartDistance) * 4.5;
            if (currentDistance < touchStartDistance) {
                scaleChange = -scaleChange * 5;
            }
            zoomImage(scaleChange);
            return;
        }
        if (isDragging) {
            event.preventDefault();
            event.stopPropagation();
            const pos = getEventPosition(event);
            moveImageDrag(pos);
        }
    }

    function nextImage() {
        currentIndex++;
        if (currentIndex > images.length - 1) {
            currentIndex = currentIndex % images.length;
        }
        updateImageSrcAndPosition();
    }

    function prevImage() {
        currentIndex--;
        if (currentIndex < 0) {
            currentIndex = images.length + currentIndex;
        }
        updateImageSrcAndPosition();
    }

    function updateImageSrcAndPosition() {
        const oldContainerRect = containerElementRef.getBoundingClientRect();
        imageElementRef.src = images[currentIndex];
        let scaleTemp = containerScale;
        containerScale = 1;
        // 使用 once: true 确保事件处理器只执行一次
        imageElementRef.addEventListener(
            "load",
            () => {
                let imgNaturalWidth = imageElementRef.naturalWidth;
                if (isStrBlank(containerElementRef.style.width)) {
                    let maxWidth = window.innerWidth * 0.8;
                    if (imgNaturalWidth > maxWidth) {
                        containerElementRef.style.width = maxWidth + "px";
                    }
                }
                if (oldContainerRect.width > imgNaturalWidth) {
                    containerElementRef.style.width = "";
                }
                if (lastUpdateWidth && imgNaturalWidth > lastUpdateWidth) {
                    containerElementRef.style.width = lastUpdateWidth + "px";
                }
                keepCenterPosition(oldContainerRect, scaleTemp);
                updatePositionLimit();
                checkPositionLimit();
            },
            { once: true },
        );
    }
    function keepCenterPosition(oldContainerRect: DOMRect, oldScale: number) {
        const newContainerRect = containerElementRef.getBoundingClientRect();
        // console.log(
        //     "oldContainerRect ",
        //     oldContainerRect,
        //     " ,newContainerRect ",
        //     newContainerRect,
        // );

        const prevCenterX = position.x + oldContainerRect.width / oldScale / 2;
        const prevCenterY = position.y + oldContainerRect.height / oldScale / 2;
        const newCenterX = newContainerRect.width / 2;
        const newCenterY = newContainerRect.height / 2;
        // 计算新图片的 translate 值，使其中心对齐前一张图片的中心
        const translateX = prevCenterX - newCenterX;
        const translateY = prevCenterY - newCenterY;
        // console.log("oldPosition ", position);
        position = { x: translateX, y: translateY };
        // console.log("newPosition ", position);
    }
    function centerImage() {
        // 获取图片的自然尺寸和当前尺寸
        const imgWidth = containerElementRef.offsetWidth;
        const imgHeight = containerElementRef.offsetHeight;

        // 获取窗口的尺寸
        const windowWidth = window.innerWidth;
        const windowHeight = window.innerHeight;

        // 计算居中偏移量
        const positionX = (windowWidth - imgWidth) / 2;
        const positionY = (windowHeight - imgHeight) / 2;
        position = { x: positionX, y: positionY };

        // 设置图片的 transform 样式，使其居中
        // containerRef.style.transform = `translate(${positionX}px, ${positionY}px)`;
    }

    function handleKeydown(e: KeyboardEvent) {
        e.stopPropagation();
        if (e.key === "Escape") {
            onClose();
        } else if (e.key === "ArrowRight") {
            nextImage();
        } else if (e.key === "ArrowLeft") {
            prevImage();
        }
    }
</script>

<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- svelte-ignore a11y-img-redundant-alt -->
<!-- svelte-ignore a11y-no-noninteractive-tabindex -->
<!-- svelte-ignore a11y-no-static-element-interactions -->
<!-- <div class="image-preview-container" bind:this={containerRef}> -->
<!-- svelte-ignore missing-declaration -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<div
    tabindex="0"
    bind:this={containerElementRef}
    class="image-wrapper"
    style="transform: translate({position.x}px, {position.y}px) scale({containerScale}); pointer-events: auto;user-select:none;display: inline-block;"
    on:pointerdown={onClick}
    on:wheel|passive={onWheel}
    on:mousemove={onMouseMove}
    on:mousedown={onMouseDown}
    on:touchstart={onTouchStart}
    on:touchmove={onTouchMove}
    on:touchend={onTouchEnd}
    on:contextmenu={onContextmenu}
>
    <img
        style="user-select:none;"
        bind:this={imageElementRef}
        class="image"
        src=""
        alt="Image"
        draggable={false}
        tabindex="0"
    />
    <div
        class="nav-buttons nav-close"
        style="user-select:none;"
        contenteditable="false"
    >
        <button
            style="user-select:none;"
            contenteditable="false"
            on:click|stopPropagation={onClose}
            on:dblclick|stopPropagation
            on:mousedown|stopPropagation
            on:mouseup|stopPropagation
            on:touchend|stopPropagation={onClose}
            ><svg><use xlink:href="#iconClose"></use></svg></button
        >
    </div>

    <div
        class="nav-buttons nav-page"
        style="user-select:none;"
        contenteditable="false"
    >
        <button
            style="user-select:none;"
            contenteditable="false"
            on:click|stopPropagation={prevImage}
            on:dblclick|stopPropagation
            on:mousedown|stopPropagation
            on:mouseup|stopPropagation
            on:touchend|stopPropagation={prevImage}
            ><svg><use xlink:href="#iconBack"></use></svg></button
        >
        <button
            style="user-select:none;"
            contenteditable="false"
            on:click|stopPropagation={nextImage}
            on:dblclick|stopPropagation
            on:mousedown|stopPropagation
            on:mouseup|stopPropagation
            on:touchend|stopPropagation={nextImage}
            ><svg><use xlink:href="#iconForward"></use></svg></button
        >
        <!-- <button id="barForward" class="ariaLabel toolbar__item toolbar__item--disabled" aria-label="前进 Ctrl+]">
            
        </button> -->
    </div>
    <div class="footer" contenteditable="false" style="user-select:none;">
        {currentIndex + 1} / {images.length}
    </div>
</div>

<!-- </div> -->

<style>
    /* .image-preview-container {
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 9999;
    } */

    .image-wrapper {
        position: relative;
        overflow: hidden;
        cursor: grab;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3); /* 高亮的悬浮阴影 */
        transition: box-shadow 0.1s ease;
    }
    /* 容器悬浮时的阴影效果（焦点时阴影略微加深） */
    .image-wrapper:hover,
    .image-wrapper:focus {
        box-shadow: 0 8px 16px rgba(3, 185, 226, 0.3); /* 高亮的悬浮阴影 */
    }

    .image {
        transition: transform 0.1s ease-out;
        transform-origin: center center;
        will-change: transform;
    }

    .nav-buttons {
        position: absolute;
        display: flex;

        width: 100%;
        pointer-events: none;
        opacity: 0.5;
    }

    .nav-buttons.nav-close {
        justify-content: flex-end;
        top: 1.5%;
        right: 0.2%;
    }

    .nav-buttons.nav-page {
        justify-content: space-between;
        top: 50%;
    }

    .nav-buttons:hover {
        opacity: 1;
    }
    .nav-buttons button,
    .nav-buttons button {
        pointer-events: all;
        background: #ffffff80;
        border-radius: 50%;
        margin: 0 5px;
        box-shadow: 0 0 10px #0000004d;
        cursor: pointer;
        border: 2px solid transparent;
    }

    .nav-buttons button:hover {
        background: rgba(255, 255, 255, 0.8);
        box-shadow: 0 0 15px rgba(0, 0, 0, 0.5);
    }
    svg {
        height: 12px;
        width: 12px;
        color: var(--b3-theme-on-surface-light);
    }

    .footer {
        position: absolute;
        bottom: 8px;
        color: #fff;
        font-size: 13px;
        background: #000000b3;
        padding: 3px 5px;
        border-radius: 10px;
        box-shadow: 0 0 6px #00000080;
    }
</style>
