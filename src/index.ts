import {
    Plugin,
} from "siyuan";
import "@/index.scss";


import { EnvConfig } from '@/config/EnvConfig';
import { SettingService } from '@/service/setting/SettingService';
import { CUSTOM_ICON_MAP } from '@/models/icon-constant';
import { openSettingsDialog } from "@/components/setting/setting-util";
import { ImageService } from "./service/image/ImageService";


export default class PluginSample extends Plugin {


    async onload() {
        EnvConfig.ins.init(this);
        await SettingService.ins.init();
        ImageService.ins.init();

        for (const key in CUSTOM_ICON_MAP) {
            if (Object.prototype.hasOwnProperty.call(CUSTOM_ICON_MAP, key)) {
                this.addIcons(CUSTOM_ICON_MAP[key].source);
            }
        }

        // this.eventBus.on('switch-protyle', (e: any) => {
        //     EnvConfig.ins.lastViewedDocId = e.detail.protyle.block.rootID;
        // })
        // this.eventBus.on('loaded-protyle-static', (e: any) => {
        //     // console.log("index loaded-protyle-static ")
        //     if (EnvConfig.ins.isMobile && !EnvConfig.ins.lastViewedDocId) {
        //         EnvConfig.ins.lastViewedDocId = e.detail.protyle.block.rootID;
        //     }
        // })
    }






    onLayoutReady() {

    }

    async onunload() {
        ImageService.ins.destroy();
    }

    uninstall() {
        // console.log("uninstall");
    }


    openSetting(): void {
        openSettingsDialog();
    }


}
