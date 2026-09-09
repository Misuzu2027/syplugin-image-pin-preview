<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { EnvConfig } from "@/config/EnvConfig";

  export interface SettingTabItem {
    key: string;
    label: string;
    icon?: string;
  }

  export let tabs: SettingTabItem[] = [];
  export let activeTab = "";
  export let sidebarWidth = 240;
  export let minSidebarWidth = 180;
  export let maxSidebarWidth = 420;
  export let storageKey = "plugin-setting-sidebar-width";
  export let compact = false;

  let layoutEl: HTMLDivElement;
  let sidebarWidthPx = sidebarWidth;
  let dragging = false;

  function t(key: string, fallback: string): string {
    return (EnvConfig.ins.i18n as Record<string, string>)?.[key] ?? fallback;
  }

  function clamp(width: number) {
    return Math.min(maxSidebarWidth, Math.max(minSidebarWidth, width));
  }

  function loadWidth() {
    const saved = localStorage.getItem(storageKey);
    if (!saved) {
      return;
    }
    const width = Number(saved);
    if (!Number.isNaN(width)) {
      sidebarWidthPx = clamp(width);
    }
  }

  function saveWidth() {
    localStorage.setItem(storageKey, String(sidebarWidthPx));
  }

  function onResizeStart(event: PointerEvent) {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    event.preventDefault();
    dragging = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  function onResizeMove(event: PointerEvent) {
    if (!dragging || !layoutEl) {
      return;
    }
    const rect = layoutEl.getBoundingClientRect();
    sidebarWidthPx = clamp(event.clientX - rect.left);
  }

  function onResizeEnd() {
    if (!dragging) {
      return;
    }
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    saveWidth();
  }

  onMount(() => {
    loadWidth();
    document.addEventListener("pointermove", onResizeMove);
    document.addEventListener("pointerup", onResizeEnd);
    document.addEventListener("pointercancel", onResizeEnd);
  });

  onDestroy(() => {
    document.removeEventListener("pointermove", onResizeMove);
    document.removeEventListener("pointerup", onResizeEnd);
    document.removeEventListener("pointercancel", onResizeEnd);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  });
</script>

<div
  bind:this={layoutEl}
  class="setting-layout fn__flex-1 fn__flex config__panel"
  class:setting-layout--compact={compact}
>
  <ul
    class="setting-layout__sidebar b3-tab-bar b3-list b3-list--background"
    style="width: {sidebarWidthPx}px; min-width: {minSidebarWidth}px; max-width: {maxSidebarWidth}px;"
    role="tablist"
  >
    {#each tabs as tab}
      <li
        class="b3-list-item"
        class:b3-list-item--focus={activeTab === tab.key}
        role="tab"
        tabindex="0"
        aria-selected={activeTab === tab.key}
        on:click={() => {
          activeTab = tab.key;
        }}
        on:keydown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            activeTab = tab.key;
          }
        }}
      >
        {#if tab.icon}
          <svg class="b3-list-item__graphic">
            <use xlink:href={"#" + tab.icon}></use>
          </svg>
        {/if}
        <span class="b3-list-item__text">{tab.label}</span>
      </li>
    {/each}
  </ul>

  <div
    class="setting-layout__resizer"
    class:setting-layout__resizer--active={dragging}
    role="separator"
    aria-orientation="vertical"
    title={t("settingLayoutResizerTitle", "拖动调整宽度")}
    on:pointerdown={onResizeStart}
  ></div>

  <div class="config__tab-wrap setting-layout__content">
    <slot />
  </div>
</div>

<style>
  .setting-layout {
    height: 100%;
    min-width: 0;
  }

  .setting-layout__sidebar {
    flex: 0 0 auto;
    box-sizing: border-box;
    overflow-x: hidden;
    overflow-y: auto;
  }

  .setting-layout__sidebar :global(.b3-list-item) {
    padding-left: 1rem;
    padding-right: 0.75rem;
    white-space: nowrap;
  }

  .setting-layout__sidebar :global(.b3-list-item__text) {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .setting-layout__resizer {
    flex: 0 0 6px;
    margin: 0 -2px;
    cursor: col-resize;
    position: relative;
    z-index: 1;
    touch-action: none;
    transition: background-color 0.15s ease;
  }

  .setting-layout--compact .setting-layout__resizer {
    flex-basis: 10px;
    margin: 0 -3px;
  }

  .setting-layout__resizer::after {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 2px;
    width: 2px;
    background-color: transparent;
    transition: background-color 0.15s ease;
  }

  .setting-layout--compact .setting-layout__resizer::after {
    left: 4px;
  }

  .setting-layout__resizer:hover::after,
  .setting-layout__resizer--active::after {
    background-color: var(--b3-theme-primary);
  }

  .setting-layout__content {
    flex: 1 1 auto;
    min-width: 0;
    overflow: auto;
  }

  .setting-layout--compact {
    flex-direction: column;
  }

  .setting-layout--compact .setting-layout__sidebar {
    width: 100% !important;
    min-width: 0 !important;
    max-width: none !important;
    flex: 0 0 auto;
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .setting-layout--compact .setting-layout__sidebar :global(.b3-list-item) {
    flex: 0 0 auto;
  }

  .setting-layout--compact .setting-layout__resizer {
    display: none;
  }
</style>
