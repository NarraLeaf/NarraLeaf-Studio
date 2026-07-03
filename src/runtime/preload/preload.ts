import { contextBridge, ipcRenderer } from "electron";
import {
    GAME_RUNTIME_BRIDGE_KEY,
    GAME_RUNTIME_PROTOCOL,
    type GameRuntimePackV1,
    type GameRuntimePreloadBridge,
} from "@shared/types/gameRuntime";

const bridge: GameRuntimePreloadBridge = {
    readPack: () => ipcRenderer.invoke("runtime:read-pack") as Promise<GameRuntimePackV1>,
    assetUrl: (assetId: string) =>
        `${GAME_RUNTIME_PROTOCOL}://asset/${encodeURIComponent(String(assetId ?? ""))}`,
    log: (level, message) => {
        ipcRenderer.send("runtime:log", { level, message });
    },
    close: () => ipcRenderer.invoke("runtime:close") as Promise<void>,
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
