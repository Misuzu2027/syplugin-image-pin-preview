import { Constants, fetchPost, getFrontend } from "siyuan";
import { getAssetName, pathPosix } from "../util/pathName";
import { isBrowser, isMobileClient as isMobile } from "@/utils/electron-util";
import { exportByMobile, isInAndroid } from "../protyle/util/compatibility";
import { canCopyImageToClipboard, notifyCopyFailed, notifyCopySuccess, writePNGBlob } from "@/utils/clipboard";


export const exportAsset = async (src: string) => {
    let electron = null;
    if (window && window.require) {
        electron = window.require('electron');
    }


    if (isBrowser() || isMobile() || !src.startsWith("assets/")) {
        exportByMobile(src);
    } else if (electron && electron.ipcRenderer) {
        const result = await electron.ipcRenderer.invoke(Constants.SIYUAN_GET, {
            cmd: "showSaveDialog",
            defaultPath: getAssetName(src) + pathPosix().extname(src),
            properties: ["showOverwriteConfirmation"],
        });
        if (!result.canceled) {
            fetchPost("/api/file/copyFile", { src, dest: result.filePath });
        }
    }


};



function canWriteAssetFile(): boolean {
    const frontend = getFrontend();
    const os = window.siyuan?.config?.system?.os;
    return (frontend === "desktop" || frontend === "desktop-window")
        && ["windows", "darwin"].includes(os || "")
        && !!window.require;
}

function isEncryptedBox(boxId: string): boolean {
    if (!boxId) {
        return false;
    }
    return !!window.siyuan?.notebooks?.find((item) => item.id === boxId && item.encrypted);
}

/** 与思源 Viewer 一致：仅同源 assets 可复制为文件。 */
export const getCopyFilePath = (src: string): string | undefined => {
    if (!src || !canWriteAssetFile()) {
        return;
    }
    try {
        const url = new URL(src, `${window.location.origin}/`);
        const path = decodeURIComponent(url.pathname);
        const box = url.searchParams.get("box");
        if (url.origin !== window.location.origin || !["http:", "https:"].includes(url.protocol)
            || !path.startsWith("/assets/") || path.includes("\\") || path.split("/").includes("..")
            || isEncryptedBox(box)) {
            return;
        }
        return path.substring(1) + (box ? `?box=${encodeURIComponent(box)}` : "");
    } catch {
        return;
    }
};

export const copyAssetFile = (src: string) => {
    const path = getCopyFilePath(src);
    if (!path) {
        notifyCopyFailed("file");
        return;
    }
    fetchPost("/api/clipboard/writeFilePath", { path }, (response) => {
        if (response?.code === 0) {
            notifyCopySuccess();
            return;
        }
        if (response?.msg) {
            window.showMessage?.(response.msg, 6000, "error");
            return;
        }
        notifyCopyFailed("file");
    });
};

export const copyPNGByLink = (link: string) => {
    if (!link) {
        notifyCopyFailed("image");
        return;
    }
    if (isInAndroid()) {
        try {
            window.JSAndroid.writeImageClipboard(link);
            notifyCopySuccess();
        } catch {
            notifyCopyFailed("image");
        }
        return;
    }
    if (!canCopyImageToClipboard()) {
        notifyCopyFailed("permission");
        return;
    }
    const copyBlob = async (blob: Blob) => {
        if (await writePNGBlob(blob)) {
            notifyCopySuccess();
        }
    };
    const imageToPNGClipboard = (image: HTMLImageElement) => {
        try {
            const canvas = document.createElement("canvas");
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            canvas.getContext("2d")?.drawImage(image, 0, 0);
            canvas.toBlob((blob) => {
                if (blob) {
                    copyBlob(blob);
                } else {
                    notifyCopyFailed("image");
                }
            }, "image/png", 1);
        } catch {
            notifyCopyFailed("image");
        }
    };
    const blobToPNGClipboard = (blob: Blob) => {
        if (blob.type === "image/png") {
            copyBlob(blob);
            return;
        }
        const objectURL = URL.createObjectURL(blob);
        const tempElement = document.createElement("img");
        tempElement.onload = () => {
            imageToPNGClipboard(tempElement);
            URL.revokeObjectURL(objectURL);
        };
        tempElement.onerror = () => {
            URL.revokeObjectURL(objectURL);
            notifyCopyFailed("image");
        };
        tempElement.src = objectURL;
    };
    fetch(link).then(async (response) => {
        if (!response.ok) {
            throw new Error(response.statusText);
        }
        blobToPNGClipboard(await response.blob());
    }).catch(() => {
        const tempElement = document.createElement("img");
        tempElement.crossOrigin = "anonymous";
        tempElement.onload = () => imageToPNGClipboard(tempElement);
        tempElement.onerror = () => notifyCopyFailed("image");
        tempElement.src = link;
    });
};

