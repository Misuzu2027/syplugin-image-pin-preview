import { EnvConfig } from "@/config/EnvConfig";
import { svelteDialog } from "@/libs/dialog";
import SettingPageSvelte from "@/components/setting/setting-page.svelte";
import { getSettingDialogSize } from "@/components/setting/setting-dialog";

export function openSettingsDialog() {
    const { width, height } = getSettingDialogSize();
    const { dialog } = svelteDialog({
        title: EnvConfig.ins.i18n?.settingDialogTitle ?? "图片悬浮预览插件设置",
        constructor: (container) => {
            return new SettingPageSvelte({
                target: container,
            });
        },
        width,
        height,
    });
    dialog.element.classList.add("image-pin-preview-setting-dialog");
}
