import { get, readonly, writable } from "svelte/store";
import { showMessage, type Plugin } from "siyuan";
import { getImagePrivacyKey } from "@/utils/image-url";

export { getImagePrivacyKey };

const PRIVACY_FILE = "image-privacy.json";
const CHANNEL_NAME = "syplugin-image-pin-preview:privacy";
const REQUEST_TIMEOUT = 10_000;
const imageKeys = writable<ReadonlySet<string>>(new Set());
export const privateImages = readonly(imageKeys);

interface PrivacySession {
    path: string;
    appId: string;
    channel?: BroadcastChannel;
    controller: AbortController;
    pendingRenames: Map<string, string>;
}

let session: PrivacySession | undefined;
let operation: Promise<unknown> = Promise.resolve();

export async function initImagePrivacy(plugin: Plugin) {
    const current: PrivacySession = {
        path: `/data/storage/petal/${plugin.name}/${PRIVACY_FILE}`,
        appId: plugin.app?.appId || "",
        controller: new AbortController(),
        pendingRenames: new Map(),
    };
    session = current;
    if (typeof BroadcastChannel !== "undefined") {
        current.channel = new BroadcastChannel(CHANNEL_NAME);
        current.channel.onmessage = refreshOnFocus;
    }
    window.addEventListener("focus", refreshOnFocus);
    try {
        await refreshImagePrivacy();
    } catch {
        if (session === current) {
            showMessage(String(plugin.i18n.privacyLoadError || "读取图片隐私标记失败"), 5000, "error");
        }
    }
}

export function destroyImagePrivacy() {
    session?.controller.abort();
    session?.channel?.close();
    session = undefined;
    window.removeEventListener("focus", refreshOnFocus);
    imageKeys.set(new Set());
}

function refreshOnFocus() {
    void refreshImagePrivacy().catch(() => {
        // Keep the last known marks if the kernel is temporarily unavailable.
    });
}

export function refreshImagePrivacy(): Promise<void> {
    return session ? syncKeys(session) : Promise.resolve();
}

export function isImagePrivate(src: string): boolean {
    return get(privateImages).has(getImagePrivacyKey(src));
}

export function setImagePrivate(src: string, value: boolean): Promise<void> {
    const key = getImagePrivacyKey(src);
    if (!session || !key) {
        return Promise.reject(new Error("Image privacy storage is unavailable for this image"));
    }
    return syncKeys(session, (keys) => {
        if (keys.has(key) === value) {
            return false;
        }
        if (value) {
            keys.add(key);
        } else {
            keys.delete(key);
        }
        return true;
    });
}

export function replacePrivateAssetPath(oldPath: string, newPath: string): Promise<void> {
    const oldKey = getImagePrivacyKey(oldPath);
    const newKey = getImagePrivacyKey(newPath);
    if (!session || !oldKey || !newKey || oldKey === newKey) {
        return Promise.resolve();
    }
    // The kernel has already renamed the resource. Keep it covered while the new mark is saved.
    session.pendingRenames.set(oldKey, newKey);
    if (get(privateImages).has(oldKey)) {
        publish(new Set([...get(privateImages), newKey]));
    }
    return syncKeys(session);
}

function publish(keys: Set<string>) {
    const existing = get(privateImages);
    if (keys.size !== existing.size || [...keys].some((key) => !existing.has(key))) {
        imageKeys.set(keys);
    }
}

function serial<T>(action: () => Promise<T>): Promise<T> {
    const result = operation.then(action);
    operation = result.catch(() => undefined);
    return result;
}

function syncKeys(current: PrivacySession, update?: (keys: Set<string>) => boolean): Promise<void> {
    return serial(async () => {
        const save = async () => {
            // Re-read inside the lock so unrelated changes made in other windows are preserved.
            const keys = await readKeys(current);
            const renames = [...current.pendingRenames];
            let renamed = false;
            for (const [oldKey, newKey] of renames) {
                if (keys.delete(oldKey)) {
                    keys.add(newKey);
                    renamed = true;
                }
            }
            const changed = update?.(keys) || renamed;
            if (changed) {
                await writeKeys(current, keys);
            }
            if (session === current) {
                for (const [oldKey, newKey] of renames) {
                    if (current.pendingRenames.get(oldKey) === newKey) {
                        current.pendingRenames.delete(oldKey);
                    }
                }
                const visibleKeys = new Set(keys);
                for (const [oldKey, newKey] of current.pendingRenames) {
                    if (visibleKeys.has(oldKey)) {
                        visibleKeys.add(newKey);
                    }
                }
                publish(visibleKeys);
                if (changed) {
                    current.channel?.postMessage("changed");
                }
            }
        };
        if (navigator.locks) {
            await navigator.locks.request(CHANNEL_NAME, { signal: current.controller.signal }, save);
        } else {
            await save();
        }
    });
}

async function readKeys(current: PrivacySession): Promise<Set<string>> {
    const result = await fileRequest(current, "/api/file/getFile", JSON.stringify({ path: current.path }));
    if (result.status === 404 || (result.status === 202 && result.data?.code === 404)) {
        return new Set();
    }
    const stored: unknown = result.data;
    if (!Array.isArray(stored) || stored.some((key) => typeof key !== "string" || !key)) {
        throw new Error("Invalid image privacy data");
    }
    return new Set(stored);
}

async function writeKeys(current: PrivacySession, keys: Set<string>) {
    const data = new FormData();
    data.set("path", current.path);
    data.set("isDir", "false");
    data.set("app", current.appId);
    data.set("file", new Blob([JSON.stringify([...keys].sort())], { type: "application/json" }), PRIVACY_FILE);
    const result = await fileRequest(current, "/api/file/putFile", data);
    if (!result.ok || result.data?.code !== 0) {
        throw new Error("Unable to write image privacy data");
    }
}

async function fileRequest(current: PrivacySession, endpoint: string, body: string | FormData) {
    const controller = new AbortController();
    const stop = () => controller.abort();
    if (current.controller.signal.aborted) {
        stop();
    }
    current.controller.signal.addEventListener("abort", stop, { once: true });
    const timer = window.setTimeout(stop, REQUEST_TIMEOUT);
    try {
        const response = await fetch(endpoint, {
            method: "POST",
            body,
            headers: typeof body === "string" ? { "Content-Type": "application/json" } : undefined,
            signal: controller.signal,
        });
        if (!response.ok && response.status !== 404) {
            throw new Error("Image privacy storage request failed");
        }
        return {
            status: response.status,
            ok: response.ok,
            data: response.status === 404 ? undefined : await response.json(),
        };
    } finally {
        window.clearTimeout(timer);
        current.controller.signal.removeEventListener("abort", stop);
    }
}
