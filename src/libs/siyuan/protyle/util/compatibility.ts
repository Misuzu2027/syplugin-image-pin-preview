import { focusByRange } from "../../util/selection";


export const openByMobile = (uri: string) => {
    if (!uri) {
        return;
    }
    if (isInIOS()) {
        if (uri.startsWith("assets/")) {
            // iOS 16.7 之前的版本，uri 需要 encodeURIComponent
            // 保留 query 参数（如 ?box=<id>），只编码 path 部分
            const pathAndQuery = uri.replace("assets/", "");
            const queryIdx = pathAndQuery.indexOf("?");
            let encodedPath = pathAndQuery;
            let query = "";
            if (queryIdx >= 0) {
                encodedPath = pathAndQuery.substring(0, queryIdx);
                query = pathAndQuery.substring(queryIdx);
            }
            window.webkit.messageHandlers.openLink.postMessage(location.origin + "/assets/" + encodeURIComponent(encodedPath) + query);
        } else if (uri.startsWith("/")) {
            // 导出 zip 返回的是已经 encode 过的，因此不能再 encode
            window.webkit.messageHandlers.openLink.postMessage(location.origin + uri);
        } else {
            try {
                new URL(uri);
                window.webkit.messageHandlers.openLink.postMessage(uri);
            } catch (e) {
                window.webkit.messageHandlers.openLink.postMessage("https://" + uri);
            }
        }
    } else if (isInAndroid()) {
        window.JSAndroid.openExternal(uri);
    } else if (isInHarmony()) {
        window.JSHarmony.openExternal(uri);
    } else {
        window.open(uri);
    }
};


type TSaveExportFileResult = {
    status: "success" | "canceled" | "error";
    name?: string;
    message?: string;
};

const mobileExportFileRequests = new Map<string, (result: TSaveExportFileResult) => void>();
let saveExportHooked = false;

function createExportRequestId() {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureSaveExportHook() {
    if (saveExportHooked) {
        return;
    }
    saveExportHooked = true;
    const previous = window.handleSaveExportFileResult;
    window.handleSaveExportFileResult = (requestID: string, resultJSON: string) => {
        const resolve = mobileExportFileRequests.get(requestID);
        if (!resolve) {
            previous?.(requestID, resultJSON);
            return;
        }
        mobileExportFileRequests.delete(requestID);
        try {
            const result = JSON.parse(resultJSON) as TSaveExportFileResult;
            if (result.status === "success" || result.status === "canceled" || result.status === "error") {
                resolve(result);
                return;
            }
        } catch (e) {
            console.error("parse saveExportFile result failed:", e);
        }
        resolve({ status: "error" });
    };
}

function waitMobileExportFile(callback: (requestID: string) => void) {
    ensureSaveExportHook();
    return new Promise<TSaveExportFileResult>((resolve) => {
        const requestID = createExportRequestId();
        mobileExportFileRequests.set(requestID, resolve);
        try {
            callback(requestID);
        } catch (e) {
            mobileExportFileRequests.delete(requestID);
            console.error("saveExportFile failed:", e);
            resolve({ status: "error", message: String(e) });
        }
    });
}

export const saveExportFile = async (uri: string): Promise<TSaveExportFileResult> => {
    if (!uri) {
        return { status: "error" };
    }
    try {
        let result: TSaveExportFileResult;
        let hasCompletionResult = false;
        if (isInAndroid()) {
            if (window.JSAndroid.saveExportFileV2) {
                result = await waitMobileExportFile((requestID) => {
                    window.JSAndroid.saveExportFileV2(uri, requestID);
                });
                hasCompletionResult = true;
            } else {
                window.JSAndroid.saveExportFile(uri);
                result = { status: "success" };
            }
        } else if (isInIOS()) {
            if (window.webkit.messageHandlers.saveExportFileV2) {
                result = await waitMobileExportFile((requestID) => {
                    window.webkit.messageHandlers.saveExportFileV2.postMessage({ uri, requestID });
                });
                hasCompletionResult = true;
            } else {
                window.webkit.messageHandlers.saveExportFile.postMessage(uri);
                result = { status: "success" };
            }
        } else if (isInHarmony()) {
            if (window.JSHarmony.saveExportFileV2) {
                result = await waitMobileExportFile((requestID) => {
                    window.JSHarmony.saveExportFileV2(uri, requestID);
                });
                hasCompletionResult = true;
            } else {
                window.JSHarmony.saveExportFile(uri);
                result = { status: "success" };
            }
        } else {
            const openUrl = new URL(uri, `${location.origin}/`);
            openUrl.searchParams.set("download", "true");
            window.open(openUrl.href);
            result = { status: "success" };
        }
        if (hasCompletionResult && result.status === "success") {
            window.showMessage?.(window.siyuan.languages.exported, 6000, "info");
        }
        return result;
    } catch (e) {
        window.showMessage?.("saveExportFile failed: " + e, 6000, "error");
        return { status: "error", message: String(e) };
    }
};


export const exportByMobile = (uri: string) => {
    if (!uri) {
        return;
    }
    if (isInIOS()) {
        openByMobile(uri);
    } else if (isInAndroid()) {
        window.JSAndroid.exportByDefault(uri);
    } else if (isInHarmony()) {
        window.JSHarmony.exportByDefault(uri);
    } else {
        window.open(uri);
    }
};


export const writeText = (text: string) => {
    let range: Range;
    if (getSelection().rangeCount > 0) {
        range = getSelection().getRangeAt(0).cloneRange();
    }
    try {
        // navigator.clipboard.writeText 抛出异常不进入 catch，这里需要先处理移动端复制
        if (isInAndroid()) {
            window.JSAndroid.writeClipboard(text);
            return;
        }
        if (isInHarmony()) {
            window.JSHarmony.writeClipboard(text);
            return;
        }
        if (isInIOS()) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
            return;
        }
        navigator.clipboard.writeText(text);
    } catch (e) {
        if (isInIOS()) {
            window.webkit.messageHandlers.setClipboard.postMessage(text);
        } else if (isInAndroid()) {
            window.JSAndroid.writeClipboard(text);
        } else if (isInHarmony()) {
            window.JSHarmony.writeClipboard(text);
        } else {
            const textElement = document.createElement("textarea");
            textElement.value = text;
            textElement.style.position = "fixed";  //avoid scrolling to bottom
            document.body.appendChild(textElement);
            textElement.focus();
            textElement.select();
            document.execCommand("copy");
            document.body.removeChild(textElement);
            if (range) {
                focusByRange(range);
            }
        }
    }
};



export const isWindows = () => {
    return navigator.platform.toUpperCase().indexOf("WIN") > -1;
};

export const isInAndroid = () => {
    return window.siyuan.config.system.container === "android" && window.JSAndroid;
};

export const isInIOS = () => {
    return window.siyuan.config.system.container === "ios" && window.webkit?.messageHandlers;
};

export const isInHarmony = () => {
    return window.siyuan.config.system.container === "harmony" && window.JSHarmony;
};