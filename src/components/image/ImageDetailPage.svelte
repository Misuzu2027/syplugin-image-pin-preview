<script lang="ts">
    import { onMount } from "svelte";
    import ImageDetailList from "./ImageDetailList.svelte";
    import type { ImageDetailRow } from "@/service/image/ImageDetailService";
    import { captureMobileDetailBack } from "@/service/image/mobile-detail-back";

    export let title = "";
    export let rows: ImageDetailRow[] = [];
    export let loading = false;
    export let partial = false;
    export let loadingText = "";
    export let partialText = "";
    export let copiedText = "";
    export let backLabel = "";
    export let resizeLabel: string;
    export let onClose: () => void = () => {};

    let root: HTMLElement;
    let full = false;
    let drag: { id: number; y: number; height: number } | undefined;
    let dragHeight: number | undefined;
    let suppressClick = false;

    // Render sheets in opening order above every pinned image, matching the back stack.
    function mountSheet(node: HTMLElement) {
        document.body.appendChild(node);
        return { destroy: () => node.remove() };
    }

    function startDrag(event: PointerEvent) {
        if (event.button !== 0 || drag) return;
        suppressClick = false;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, y: event.clientY, height: root.getBoundingClientRect().height };
    }

    function moveDrag(event: PointerEvent) {
        if (drag?.id !== event.pointerId) return;
        const delta = event.clientY - drag.y;
        if (Math.abs(delta) > 6) suppressClick = true;
        dragHeight = Math.max(0, drag.height - delta);
    }

    function endDrag(event: PointerEvent) {
        if (!drag || drag.id !== event.pointerId) return;
        const delta = event.clientY - drag.y;
        drag = undefined;
        dragHeight = undefined;
        if (event.type !== "pointerup") return;
        if (Math.abs(delta) <= 6) return;
        suppressClick = true;
        if (delta < -40) full = true;
        if (delta > 40) {
            if (full) full = false;
            else onClose();
        }
    }

    onMount(() => {
        const releaseBack = captureMobileDetailBack(() => onClose());
        root?.focus();
        return releaseBack;
    });
</script>

<div
    bind:this={root}
    use:mountSheet
    class="ipp-detail-page"
    class:ipp-detail-page--full={full}
    class:ipp-detail-page--dragging={!!drag}
    style:height={dragHeight === undefined ? undefined : dragHeight + "px"}
    role="dialog"
    aria-label={title}
    tabindex="-1"
    on:keydown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}
    on:contextmenu|stopPropagation
    on:wheel|stopPropagation
>
    <button type="button" class="ipp-detail-page__handle" aria-label={resizeLabel} aria-expanded={full}
        on:pointerdown={startDrag} on:pointermove={moveDrag} on:pointerup={endDrag}
        on:pointercancel={endDrag} on:lostpointercapture={endDrag}
        on:click={(event) => { if (!suppressClick || event.detail === 0) full = !full; }}>
        <span></span>
    </button>
    <div class="ipp-detail-page__bar">
        <button
            type="button"
            class="ipp-detail-page__back"
            aria-label={backLabel}
            on:click|stopPropagation={onClose}
            on:pointerdown|stopPropagation
        >
            <svg class="ipp-icon"><use xlink:href="#ippIconPrev"></use></svg>
        </button>
        <span class="ipp-detail-page__title">{title}</span>
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
    .ipp-detail-page {
        position: fixed;
        inset: auto 0 0;
        box-sizing: border-box;
        height: 50%;
        max-height: 100%;
        padding-bottom: env(safe-area-inset-bottom);
        overflow: hidden;
        border-radius: 14px 14px 0 0;
        box-shadow: 0 -3px 18px rgba(0, 0, 0, 0.2);
        transition: height 160ms ease;
        z-index: var(--ipp-detail-z, 100001);
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        background: var(--b3-theme-background, #fff);
        color: var(--b3-theme-on-background, #222);
        outline: none;
    }

    .ipp-detail-page--full {
        height: 100%;
        padding-top: env(safe-area-inset-top);
        border-radius: 0;
    }

    .ipp-detail-page--dragging {
        transition: none;
    }

    .ipp-detail-page__handle {
        display: grid;
        place-items: center;
        flex: none;
        width: 100%;
        height: 28px;
        border: 0;
        background: transparent;
        color: inherit;
        touch-action: none;
        cursor: ns-resize;
    }

    .ipp-detail-page__handle span {
        width: 36px;
        height: 4px;
        border-radius: 2px;
        background: currentColor;
        opacity: 0.4;
    }

    .ipp-detail-page__bar {
        display: flex;
        align-items: center;
        gap: 4px;
        height: 48px;
        padding: 0 8px;
        flex: none;
        border-bottom: 1px solid var(--b3-border-color, rgba(0, 0, 0, 0.08));
    }

    .ipp-detail-page__back {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .ipp-detail-page__title {
        font-size: 16px;
        line-height: 24px;
    }

    .ipp-icon {
        width: 20px;
        height: 20px;
        fill: currentColor;
    }
</style>
