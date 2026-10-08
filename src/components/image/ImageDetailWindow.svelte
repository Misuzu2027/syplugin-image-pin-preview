<script lang="ts">
    import { onDestroy } from "svelte";
    import ImageDetailList from "./ImageDetailList.svelte";
    import type { ImageDetailRow } from "@/service/image/ImageDetailService";

    export let x = 24;
    export let y = 24;
    export let title = "";
    export let rows: ImageDetailRow[] = [];
    export let loading = false;
    export let partial = false;
    export let loadingText = "";
    export let partialText = "";
    export let copiedText = "";
    export let closeLabel = "";
    export let onClose: () => void = () => {};

    let root: HTMLElement;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let originX = 0;
    let originY = 0;

    function clamp(nextX: number, nextY: number) {
        const width = root?.offsetWidth || 420;
        const margin = 48;
        return {
            x: Math.min(Math.max(nextX, -width + margin), window.innerWidth - margin),
            y: Math.min(Math.max(nextY, 0), window.innerHeight - margin),
        };
    }

    function onPointerMove(event: PointerEvent) {
        if (!dragging) {
            return;
        }
        const next = clamp(originX + event.clientX - startX, originY + event.clientY - startY);
        x = next.x;
        y = next.y;
    }

    function stopDrag() {
        dragging = false;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", stopDrag);
    }

    function onPointerDown(event: PointerEvent) {
        if (event.button !== 0) {
            return;
        }
        const target = event.target;
        if (target instanceof Element && target.closest("button")) {
            return;
        }
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        originX = x;
        originY = y;
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", stopDrag);
    }

    function onKeydown(event: KeyboardEvent) {
        if (event.key !== "Escape" || !root?.contains(document.activeElement)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        onClose();
    }

    onDestroy(stopDrag);
</script>

<svelte:window on:keydown={onKeydown} />

<div
    bind:this={root}
    class="ipp-detail-window"
    class:ipp-detail-window--dragging={dragging}
    style="left:{x}px;top:{y}px;"
    on:contextmenu|capture|preventDefault|stopPropagation
    on:wheel|stopPropagation
>
    <div class="ipp-detail-window__bar" on:pointerdown={onPointerDown}>
        <span class="ipp-detail-window__title">{title}</span>
        <button
            type="button"
            class="ipp-detail-window__close"
            aria-label={closeLabel}
            on:click|stopPropagation={onClose}
            on:pointerdown|stopPropagation
        >
            <svg class="ipp-icon"><use xlink:href="#ippIconClose"></use></svg>
        </button>
    </div>
    <ImageDetailList
        {rows}
        {loading}
        {partial}
        {loadingText}
        {partialText}
        {copiedText}
    />
</div>

<style>
    .ipp-detail-window {
        position: fixed;
        z-index: 6;
        display: flex;
        flex-direction: column;
        width: min(440px, calc(100vw - 24px));
        max-height: min(72vh, 640px);
        overflow: hidden;
        pointer-events: auto;
        color: #fff;
        background: rgba(28, 28, 28, 0.94);
        border-radius: 10px;
        box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
    }

    .ipp-detail-window__bar {
        display: flex;
        align-items: center;
        gap: 8px;
        height: 40px;
        padding: 0 8px 0 14px;
        flex: none;
        cursor: grab;
        user-select: none;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }

    .ipp-detail-window--dragging .ipp-detail-window__bar {
        cursor: grabbing;
    }

    .ipp-detail-window__title {
        flex: 1;
        min-width: 0;
        font-size: 14px;
        line-height: 20px;
    }

    .ipp-detail-window__close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .ipp-detail-window__close:hover {
        background: rgba(255, 255, 255, 0.12);
    }

    .ipp-icon {
        width: 16px;
        height: 16px;
        fill: currentColor;
    }
</style>
