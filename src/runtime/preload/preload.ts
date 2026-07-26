import { contextBridge, ipcRenderer } from "electron";
import {
    GAME_RUNTIME_BRIDGE_KEY,
    GAME_RUNTIME_CLOSE_DECISION_CHANNEL,
    GAME_RUNTIME_CLOSE_REQUESTED_CHANNEL,
    GAME_RUNTIME_FULLSCREEN_CHANGED_CHANNEL,
    GAME_RUNTIME_PROTOCOL,
    GAME_RUNTIME_SIDECAR_MESSAGE_CHANNEL,
    type GameRuntimePackV1,
    type GameRuntimePreloadBridge,
    type GameRuntimeSidecarBridge,
    type GameRuntimeSidecarMessage,
} from "@shared/types/gameRuntime";
import { readGameRuntimeAssetVersionArg } from "@shared/utils/gameRuntimeAssetUrl";

// Version tag for asset URLs, injected by the main process at window creation
// so immutable HTTP cache entries are keyed per pack. The fallback is
// session-unique: a missing marker can only under-cache, never serve bytes
// from an older pack.
const assetVersion = readGameRuntimeAssetVersionArg(process.argv) ?? String(Date.now());

// The main process asks before honouring a user-initiated window close so blueprints can intercept
// it. Registered once here; until the game installs a handler (still loading), the close is allowed
// immediately so the window never lags behind the click.
//
// A set rather than a single slot: the blueprint decider is no longer the only interested party
// (runtime plugins observe the same request), and a second registration must not silently unseat
// the first. Every handler is consulted and the close proceeds only if all of them agree, which
// leaves the single-decider behaviour exactly as it was — observers just answer `true`.
const closeRequestedListeners = new Set<() => boolean | Promise<boolean>>();
ipcRenderer.on(GAME_RUNTIME_CLOSE_REQUESTED_CHANNEL, (_event, payload: { requestId: number }) => {
    const respond = (allow: boolean) =>
        ipcRenderer.send(GAME_RUNTIME_CLOSE_DECISION_CHANNEL, { requestId: payload?.requestId, allow });
    const listeners = Array.from(closeRequestedListeners);
    if (listeners.length === 0) {
        respond(true);
        return;
    }
    Promise.all(listeners.map(listener =>
        // One failing handler must not trap the window open, and must not stop the others from
        // being asked, so each is isolated and a throw reads as "no objection".
        Promise.resolve().then(() => listener()).catch(() => true),
    ))
        .then(results => respond(results.every(allow => allow !== false)))
        .catch(() => respond(true));
});

/**
 * Sidecar pushes arrive on one channel and fan out to per-sidecar listener sets
 * here, so the renderer never sees another sidecar's traffic and one plugin's
 * throwing listener cannot stop the next one from being called.
 *
 * The `pluginId` a caller passes is NOT authenticated - runtime plugins share a
 * single renderer realm and cannot be told apart from this side. What bounds the
 * damage is that the main process only spawns sidecars the pack declared; see
 * the note on the handlers in main.ts.
 */
type SidecarEventListener = (method: string, params: unknown) => void;
type SidecarExitListener = (info: { code: number | null; signal: string | null }) => void;
type SidecarUnavailableListener = (info: { pluginId: string; sidecarId: string; reason: string }) => void;

const sidecarEventListeners = new Map<string, Set<SidecarEventListener>>();
const sidecarExitListeners = new Map<string, Set<SidecarExitListener>>();
const sidecarUnavailableListeners = new Set<SidecarUnavailableListener>();

function sidecarKey(pluginId: string, sidecarId: string): string {
    return `${pluginId} ${sidecarId}`;
}

function subscribeSidecar<T>(
    registry: Map<string, Set<T>>,
    key: string,
    listener: T,
): () => void {
    let set = registry.get(key);
    if (!set) {
        set = new Set<T>();
        registry.set(key, set);
    }
    set.add(listener);
    return () => {
        set.delete(listener);
    };
}

function dispatchSidecar<T>(listeners: Set<T> | undefined, call: (listener: T) => void): void {
    if (!listeners) {
        return;
    }
    for (const listener of Array.from(listeners)) {
        try {
            call(listener);
        } catch (error) {
            console.error("[GameRuntime] sidecar listener failed", error);
        }
    }
}

ipcRenderer.on(GAME_RUNTIME_SIDECAR_MESSAGE_CHANNEL, (_event, message: GameRuntimeSidecarMessage) => {
    if (!message || typeof message !== "object") {
        return;
    }
    const key = sidecarKey(message.pluginId, message.sidecarId);
    if (message.kind === "event") {
        dispatchSidecar(sidecarEventListeners.get(key), listener => listener(message.method, message.params));
        return;
    }
    if (message.kind === "exit") {
        dispatchSidecar(sidecarExitListeners.get(key), listener =>
            listener({ code: message.code, signal: message.signal }));
        return;
    }
    dispatchSidecar(sidecarUnavailableListeners, listener => listener({
        pluginId: message.pluginId,
        sidecarId: message.sidecarId,
        reason: message.reason,
    }));
});

const sidecar: GameRuntimeSidecarBridge = {
    start: (pluginId, sidecarId) =>
        ipcRenderer.invoke("runtime:sidecar:start", pluginId, sidecarId) as Promise<void>,
    stop: (pluginId, sidecarId) =>
        ipcRenderer.invoke("runtime:sidecar:stop", pluginId, sidecarId) as Promise<void>,
    request: (pluginId, sidecarId, method, params) =>
        ipcRenderer.invoke("runtime:sidecar:request", pluginId, sidecarId, method, params),
    notify: (pluginId, sidecarId, method, params) => {
        ipcRenderer.send("runtime:sidecar:notify", pluginId, sidecarId, method, params);
    },
    onEvent: (pluginId, sidecarId, listener) =>
        subscribeSidecar(sidecarEventListeners, sidecarKey(pluginId, sidecarId), listener),
    onExit: (pluginId, sidecarId, listener) =>
        subscribeSidecar(sidecarExitListeners, sidecarKey(pluginId, sidecarId), listener),
    onUnavailable: listener => {
        sidecarUnavailableListeners.add(listener);
        return () => {
            sidecarUnavailableListeners.delete(listener);
        };
    },
};

const bridge: GameRuntimePreloadBridge = {
    readPack: () => ipcRenderer.invoke("runtime:read-pack") as Promise<GameRuntimePackV1>,
    assetUrl: (assetId: string) =>
        `${GAME_RUNTIME_PROTOCOL}://asset/${encodeURIComponent(String(assetId ?? ""))}?v=${encodeURIComponent(assetVersion)}`,
    pluginEntryUrl: (entryRelativePath: string) =>
        `${GAME_RUNTIME_PROTOCOL}://runtime/${entryRelativePath}`,
    log: (level, message) => {
        ipcRenderer.send("runtime:log", { level, message });
    },
    close: () => ipcRenderer.invoke("runtime:close") as Promise<void>,
    getFullscreen: () => ipcRenderer.invoke("runtime:fullscreen:get") as Promise<boolean>,
    setFullscreen: (fullscreen: boolean) =>
        ipcRenderer.invoke("runtime:fullscreen:set", fullscreen) as Promise<void>,
    onFullscreenChanged: (listener: (isFullscreen: boolean) => void) => {
        const handler = (_event: unknown, isFullscreen: boolean) => {
            listener(isFullscreen === true);
        };
        ipcRenderer.on(GAME_RUNTIME_FULLSCREEN_CHANGED_CHANNEL, handler);
        return () => {
            ipcRenderer.off(GAME_RUNTIME_FULLSCREEN_CHANGED_CHANNEL, handler);
        };
    },
    onCloseRequested: (listener: () => boolean | Promise<boolean>) => {
        closeRequestedListeners.add(listener);
        return () => {
            closeRequestedListeners.delete(listener);
        };
    },
    capabilities: { closeRequested: true },
    save: {
        write: (id, savedGame, capture, metadata) =>
            ipcRenderer.invoke("runtime:save:write", { id, savedGame, capture, metadata }) as Promise<void>,
        read: id => ipcRenderer.invoke("runtime:save:read", id),
        listIds: () => ipcRenderer.invoke("runtime:save:listIds"),
        readPreview: id => ipcRenderer.invoke("runtime:save:readPreview", id),
        delete: id => ipcRenderer.invoke("runtime:save:delete", id),
    },
    persistence: {
        getAll: () => ipcRenderer.invoke("runtime:persistence:getAll"),
        getValue: key => ipcRenderer.invoke("runtime:persistence:getValue", key),
        setValue: (key, value) => ipcRenderer.invoke("runtime:persistence:setValue", key, value),
        removeValue: key => ipcRenderer.invoke("runtime:persistence:removeValue", key),
    },
    sidecar,
};

contextBridge.exposeInMainWorld(GAME_RUNTIME_BRIDGE_KEY, bridge);

const prevent = (event: DragEvent) => {
    event.preventDefault();
};
window.addEventListener("dragover", prevent);
window.addEventListener("drop", prevent);
