// 手机系统返回会调用思源 window.goBack，再退下层文档。
// 详情页打开期间先关掉自己；浏览器返回走 history，同样先关详情。
const HISTORY_KEY = "ippDetailBack";

interface DetailHistoryState {
    [HISTORY_KEY]?: number;
}

const stack: Array<() => void> = [];
let tokenSeq = 0;
let historyToken: number | undefined;
let releasingHistory = false;
let wrappedGoBack: (() => void) | undefined;
let siyuanGoBack: (() => void) | undefined;

function readToken(state: unknown): number | undefined {
    if (!state || typeof state !== "object") {
        return undefined;
    }
    const token = (state as DetailHistoryState)[HISTORY_KEY];
    return typeof token === "number" ? token : undefined;
}

function siyuanOverlayOwnsBack(): boolean {
    const menu = window.siyuan?.menus?.menu?.element;
    if (menu?.classList.contains("b3-menu--fullscreen") && !menu.classList.contains("fn__none")) {
        return true;
    }
    const viewer = (window.siyuan as { viewer?: { destroyed?: boolean } } | undefined)?.viewer;
    if (viewer && !viewer.destroyed) {
        return true;
    }
    return (window.siyuan?.dialogs?.length ?? 0) > 0;
}

function onPopState(event: PopStateEvent) {
    if (historyToken === undefined || readToken(event.state) === historyToken) {
        return;
    }
    event.stopImmediatePropagation();
    historyToken = undefined;
    const top = stack[stack.length - 1];
    if (releasingHistory) {
        releasingHistory = false;
        if (top) pushHistory();
        else restoreBackCapture();
    } else if (top) {
        if (stack.length > 1) pushHistory();
        top();
    }
}

function onGoBack() {
    const top = stack[stack.length - 1];
    if (!top || siyuanOverlayOwnsBack()) {
        siyuanGoBack?.();
        return;
    }
    top();
}

function installBackCapture() {
    window.addEventListener("popstate", onPopState, true);
    if (wrappedGoBack) {
        return;
    }
    siyuanGoBack = window.goBack;
    wrappedGoBack = onGoBack;
    window.goBack = wrappedGoBack;
}

function restoreBackCapture() {
    window.removeEventListener("popstate", onPopState, true);
    if (wrappedGoBack && window.goBack === wrappedGoBack) {
        window.goBack = siyuanGoBack;
    }
    wrappedGoBack = undefined;
}

function pushHistory() {
    try {
        const token = ++tokenSeq;
        const previous = history.state;
        const base = previous && typeof previous === "object" ? { ...previous } : {};
        history.pushState({ ...base, [HISTORY_KEY]: token }, "");
        historyToken = token;
    } catch (error) {
        console.error("image detail back history failed:", error);
    }
}

function release(close: () => void) {
    const index = stack.indexOf(close);
    if (index < 0) {
        return;
    }
    stack.splice(index, 1);
    if (stack.length || releasingHistory) return;
    if (historyToken !== undefined && readToken(history.state) === historyToken) {
        releasingHistory = true;
        history.back();
    } else {
        historyToken = undefined;
        restoreBackCapture();
    }
}

export function captureMobileDetailBack(close: () => void): () => void {
    // 所有面板共用一条浏览历史，关闭底层预览时不会留下空的返回步骤。
    if (!stack.length && !releasingHistory) pushHistory();
    stack.push(close);
    installBackCapture();
    return () => release(close);
}
