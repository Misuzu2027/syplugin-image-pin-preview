import { isInAndroid, isInHarmony, isInIOS } from "@/libs/siyuan/protyle/util/compatibility";
import { EnvConfig } from "@/config/EnvConfig";

function i18n(key: string, fallback: string): string {
    return window.siyuan?.languages?.[key] || EnvConfig.ins.i18n?.[key] || fallback;
}

export function notifyCopySuccess() {
    window.showMessage?.(i18n("copied", i18n("copiedSuccess", "已复制")), 2000, "info");
}

export function notifyCopyFailed(kind: "text" | "image" | "file" | "permission" = "text") {
    const message = kind === "permission"
        ? i18n("clipboardPermissionDenied", i18n("clipboardUnavailable", "当前页面无法使用剪贴板，请使用 HTTPS 或桌面端"))
        : kind === "image"
            ? i18n("imageCopyFailed", i18n("copyFailed", "复制失败"))
            : kind === "file"
                ? i18n("copyFileFailed", i18n("copyFailed", "复制失败"))
                : i18n("copyFailed", "复制失败");
    window.showMessage?.(message, 6000, "error");
}

export function canCopyImageToClipboard(): boolean {
    if (isInAndroid() && window.JSAndroid?.writeImageClipboard) {
        return true;
    }
    return !!(window.isSecureContext && navigator.clipboard?.write && typeof ClipboardItem !== "undefined");
}

export async function copyPlainText(text: string): Promise<boolean> {
    if (!text) {
        return false;
    }
    try {
        if (isInAndroid()) {
            window.JSAndroid.writeClipboard(text);
            return true;
        }
        if (isInHarmony()) {
            window.JSHarmony.writeClipboard(text);
            return true;
        }
        if (isInIOS()) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
            return true;
        }
        if (window.isSecureContext && navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fallback below
    }
    try {
        const textElement = document.createElement("textarea");
        textElement.value = text;
        textElement.style.position = "fixed";
        document.body.appendChild(textElement);
        textElement.focus();
        textElement.select();
        const copied = document.execCommand("copy");
        document.body.removeChild(textElement);
        return copied;
    } catch {
        return false;
    }
}

export async function writePNGBlob(blob: Blob): Promise<boolean> {
    try {
        if (!canCopyImageToClipboard() || !navigator.clipboard?.write) {
            notifyCopyFailed("permission");
            return false;
        }
        await navigator.clipboard.write([
            new ClipboardItem({
                // @ts-ignore
                ["image/png"]: blob,
            }),
        ]);
        return true;
    } catch {
        notifyCopyFailed("permission");
        return false;
    }
}
