import { contextBridge, ipcRenderer } from "electron";
import {
    GAME_RUNTIME_BRIDGE_KEY,
    GAME_RUNTIME_FULLSCREEN_CHANGED_CHANNEL,
    GAME_RUNTIME_PROTOCOL,
    type GameRuntimePackV1,
    type GameRuntimePreloadBridge,
} from "@shared/types/gameRuntime";
import { readGameRuntimeAssetVersionArg } from "@shared/utils/gameRuntimeAssetUrl";

// Version tag for asset URLs, injected by the main process at window creation
// so immutable HTTP cache entries are keyed per pack. The fallback is
// session-unique: a missing marker can only under-cache, never serve bytes
// from an older pack.
const assetVersion = readGameRuntimeAssetVersionArg(process.argv) ?? String(Date.now());

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
};

contextBridge.exposeInMainWorld(GAME_RUNTIME_BRIDGE_KEY, bridge);

const prevent = (event: DragEvent) => {
    event.preventDefault();
};
window.addEventListener("dragover", prevent);
window.addEventListener("drop", prevent);
