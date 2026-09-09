import { EnvConfig } from "@/config/EnvConfig";

export function getSettingDialogSize() {
    const isMobile = EnvConfig.ins.isMobile;
    return {
        width: isMobile ? "92vw" : "1040px",
        height: "80vh",
    };
}
