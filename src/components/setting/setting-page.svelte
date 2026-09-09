<script lang="ts">
  import { EnvConfig } from "@/config/EnvConfig";
  import { getSettingTabArray } from "@/models/setting-constant";
  import SettingLayout from "@/libs/components/setting-layout.svelte";
  import SettingItem from "./setting-item.svelte";
  import SettingSwitch from "./inputs/setting-switch.svelte";
  import SettingSelect from "./inputs/setting-select.svelte";
  import SettingInput from "./inputs/setting-input.svelte";
  import SettingCheckbox from "./inputs/setting-checkbox.svelte";
  import { SettingService } from "@/service/setting/SettingService";

  let tabArray = getSettingTabArray();
  let activeTab = tabArray[0]?.key ?? "";
  const isMobile = EnvConfig.ins.isMobile;
  const tabs = tabArray.map((tab) => ({
    key: tab.key,
    label: tab.name,
    icon: tab.iconKey,
  }));

  SettingService.ins.init();
</script>

<div
  class="image-pin-preview__setting"
  class:image-pin-preview__setting--mobile={isMobile}
>
  <SettingLayout
    bind:activeTab
    {tabs}
    compact={isMobile}
    sidebarWidth={isMobile ? 168 : 240}
    minSidebarWidth={isMobile ? 140 : 180}
    maxSidebarWidth={isMobile ? 240 : 420}
    storageKey="image-pin-preview-setting-sidebar-width"
  >
    {#each tabArray as tab}
      <div class="config__tab-container" class:fn__none={activeTab !== tab.key}>
        {#each tab.props as itemProperty}
          <SettingItem {itemProperty}>
            {#if itemProperty.type == "switch"}
              <SettingSwitch {itemProperty}></SettingSwitch>
            {:else if itemProperty.type == "select"}
              <SettingSelect {itemProperty}></SettingSelect>
            {:else if itemProperty.type == "number" || itemProperty.type == "text"}
              <SettingInput {itemProperty} />
            {:else if itemProperty.type == "checkbox"}
              <SettingCheckbox {itemProperty} />
            {:else}
              不能载入设置项，请检查设置代码实现。 Key: {itemProperty.key}
              <br />
              can't load settings, check code please. Key:
              {itemProperty.key}
            {/if}
          </SettingItem>
        {/each}
      </div>
    {/each}
  </SettingLayout>
</div>

<style>
  .image-pin-preview__setting {
    width: 100%;
    height: 100%;
    min-height: 0;
    flex: 1 1 auto;
  }

  .image-pin-preview__setting--mobile :global(.setting-item) {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }

  .image-pin-preview__setting--mobile :global(.fn__space) {
    display: none;
  }

  .image-pin-preview__setting--mobile :global(.b3-switch) {
    align-self: flex-end;
  }

  .image-pin-preview__setting--mobile :global(.b3-select),
  .image-pin-preview__setting--mobile :global(.b3-text-field),
  .image-pin-preview__setting--mobile :global(.config-query) {
    width: 100%;
    max-width: none;
  }

  .image-pin-preview__setting--mobile :global(.config-query label) {
    width: 100%;
    margin-right: 0;
  }
</style>
