<script lang="ts">
    import { onDestroy } from "svelte";
    import { copyPlainText, notifyCopyFailed } from "@/utils/clipboard";
    import type { ImageDetailRow } from "@/service/image/ImageDetailService";

    export let rows: ImageDetailRow[] = [];
    export let loading = false;
    export let partial = false;
    export let loadingText = "";
    export let partialText = "";
    export let copiedText = "";

    let copiedKey = "";
    let copiedTimer: ReturnType<typeof setTimeout> | undefined;

    async function copyValue(row: ImageDetailRow) {
        if (!row.value) {
            return;
        }
        const ok = await copyPlainText(row.value);
        if (!ok) {
            notifyCopyFailed("text");
            return;
        }
        copiedKey = row.key;
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => {
            if (copiedKey === row.key) {
                copiedKey = "";
            }
        }, 1500);
    }

    onDestroy(() => clearTimeout(copiedTimer));
</script>

<div class="ipp-detail-list">
    {#if loading && !rows.length}
        <p class="ipp-detail-list__status">{loadingText}</p>
    {/if}
    {#if partial}
        <p class="ipp-detail-list__status">{partialText}</p>
    {/if}
    {#each rows as row (row.key)}
        <div class="ipp-detail-row">
            <span class="ipp-detail-row__label">{row.label}</span>
            <button
                type="button"
                class="ipp-detail-row__value"
                title={copiedKey === row.key ? copiedText : row.value}
                on:click|stopPropagation={() => copyValue(row)}
            >{row.value}</button>
            {#if copiedKey === row.key}
                <span class="ipp-detail-row__copied">{copiedText}</span>
            {/if}
        </div>
    {/each}
</div>

<style>
    .ipp-detail-list {
        flex: 1;
        min-height: 0;
        overflow: auto;
        padding: 6px 0 10px;
        user-select: text;
        -webkit-user-select: text;
    }

    .ipp-detail-list__status {
        margin: 0;
        padding: 8px 14px 4px;
        font-size: 13px;
        line-height: 1.45;
        opacity: 0.8;
    }

    .ipp-detail-row {
        display: grid;
        grid-template-columns: 7.5em minmax(0, 1fr);
        gap: 4px 10px;
        align-items: start;
        padding: 5px 14px;
        font-size: 13px;
        line-height: 1.45;
    }

    .ipp-detail-row__label {
        opacity: 0.72;
    }

    .ipp-detail-row__value {
        margin: 0;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        line-height: inherit;
        text-align: left;
        overflow-wrap: anywhere;
        cursor: pointer;
        user-select: text;
        -webkit-user-select: text;
    }

    .ipp-detail-row__value:hover {
        text-decoration: underline;
    }

    .ipp-detail-row__copied {
        grid-column: 2;
        font-size: 12px;
        opacity: 0.8;
    }
</style>
