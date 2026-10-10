// 手机系统返回会调用思源 window.goBack，再退下层文档。
// 详情页打开期间先关掉自己；浏览器返回走 history，同样先关详情。
const HISTORY_KEY = "ippDetailBack";

interface DetailCapture {
    close: () => void;
    token: number;
    pushed: boolean;
}

interface DetailHistoryState {
    [HISTORY_KEY]?: number;
}

const stack: DetailCapture[] = [];
let tokenSeq = 0;
let ignorePop = false;
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
    if (ignorePop) {
        ignorePop = false;
        return;
    }
    const top = stack[stack.length - 1];
    if (!top?.pushed || readToken(event.state) === top.token) {
        return;
    }
    event.stopImmediatePropagation();
    top.close();
}

function onGoBack() {
    const top = stack[stack.length - 1];
    if (!top || siyuanOverlayOwnsBack()) {
        siyuanGoBack?.();
        return;
    }
    top.close();
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
    ignorePop = false;
    if (wrappedGoBack && window.goBack === wrappedGoBack) {
        window.goBack = siyuanGoBack;
        wrappedGoBack = undefined;
    }
}

function pushHistory(token: number): boolean {
    try {
        const previous = history.state;
        const base = previous && typeof previous === "object" ? { ...previous } : {};
        history.pushState({ ...base, [HISTORY_KEY]: token }, "");
        return true;
    } catch (error) {
        console.error("image detail back history failed:", error);
        return false;
    }
}

function release(token: number) {
    const index = stack.findIndex((item) => item.token === token);
    if (index < 0) {
        return;
    }
    const removed = stack[index];
    stack.splice(index, 1);
    const shouldPop = removed.pushed && readToken(history.state) === removed.token;
    if (stack.length === 0) {
        restoreBackCapture();
    }
    if (!shouldPop) {
        return;
    }
    if (stack.length > 0) {
        ignorePop = true;
    }
    history.back();
}

export function captureMobileDetailBack(close: () => void): () => void {
    const token = ++tokenSeq;
    const capture: DetailCapture = {
        close,
        token,
        pushed: pushHistory(token),
    };
    stack.push(capture);
    installBackCapture();
    return () => release(token);
}
