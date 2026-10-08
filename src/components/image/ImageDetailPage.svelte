<script lang="ts">
    import { onMount } from "svelte";
    import ImageDetailList from "./ImageDetailList.svelte";
    import type { ImageDetailRow } from "@/service/image/ImageDetailService";

    export let title = "";
    export let rows: ImageDetailRow[] = [];
    export let loading = false;
    export let partial = false;
    export let loadingText = "";
    export let partialText = "";
    export let copiedText = "";
    export let backLabel = "";
    export let onClose: () => void = () => {};

    let root: HTMLElement;

    onMount(() => {
        root?.focus();
    });
</script>

<div
    bind:this={root}
    class="ipp-detail-page"
    tabindex="-1"
    on:contextmenu|capture|preventDefault|stopPropagation
    on:wheel|stopPropagation
>
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
        inset: 0;
        z-index: 8;
        display: flex;
        flex-direction: column;
        pointer-events: auto;
        background: var(--b3-theme-background, #fff);
        color: var(--b3-theme-on-background, #222);
        outline: none;
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
