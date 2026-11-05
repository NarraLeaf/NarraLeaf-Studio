import { RendererInterfaceKey } from "@shared/types/constants";
import type {
    RendererAgentBridgeInterface,
    RendererGlobalBridge,
    RendererPreloadedInterface,
    RendererPrivilegedInterface,
} from "@shared/types/renderer";

let globalBridge: RendererGlobalBridge | null = null;
let rendererInterface: RendererPreloadedInterface | null = null;
let privilegedInterface: RendererPrivilegedInterface | null = null;
let agentBridgeInterface: RendererAgentBridgeInterface | null = null;
let hardened = false;

function readGlobalBridge(): RendererGlobalBridge | undefined {
    return window[RendererInterfaceKey];
}

export function initializeRendererBridge(): RendererPreloadedInterface {
    if (rendererInterface) {
        return rendererInterface;
    }

    const bridge = readGlobalBridge();
    if (!bridge) {
        throw new Error("Invalid environment: Renderer interface not found");
    }

    // The only copy of the bridge on the page lives in this module from here on: the preload hands
    // it out once, and `hardenRendererBridge` closes the global before any plugin module loads.
    const api = bridge.acquire();
    globalBridge = bridge;
    rendererInterface = api;
    privilegedInterface = api.privileged.acquire();
    // Taken here, with the privileged half, for the same reason: this runs before the page has
    // loaded anything but Studio, and `hardenRendererBridge` closes the bridge before the first
    // plugin module is imported. The preload hands it out once, so a plugin that asks gets nothing.
    agentBridgeInterface = api.agentBridge.acquire();
    return rendererInterface;
}

export function getInterface() {
    return initializeRendererBridge();
}

export function getPrivilegedInterface(): RendererPrivilegedInterface {
    initializeRendererBridge();
    if (!privilegedInterface) {
        throw new Error("Invalid environment: Privileged renderer interface not found");
    }
    return privilegedInterface;
}

/**
 * The workspace's agent bridge: answering agent calls, reporting plugin tools, asking for folders.
 * Studio's own modules reach it here; it is not on the global bridge (see `preload/ipc/interface.ts`).
 */
export function getAgentBridgeInterface(): RendererAgentBridgeInterface {
    initializeRendererBridge();
    if (!agentBridgeInterface) {
        throw new Error("Invalid environment: Agent bridge not found");
    }
    return agentBridgeInterface;
}

export function hardenRendererBridge(): void {
    const api = initializeRendererBridge();
    if (hardened) {
        return;
    }

    api.privileged.harden();
    api.agentBridge.harden();
    globalBridge?.harden();
    hardened = true;

    try {
        Reflect.deleteProperty(window, RendererInterfaceKey);
    } catch {
        /* Some Electron-exposed properties may be non-configurable. */
    }

    if (readGlobalBridge()) {
        try {
            Object.defineProperty(window, RendererInterfaceKey, {
                value: undefined,
                configurable: true,
                enumerable: false,
            });
        } catch {
            /*
             * The preload-side hardening above is the security boundary; this
             * best-effort removal only reduces accidental global discovery.
             */
        }
    }
}

export function isRendererBridgeHardened(): boolean {
    return hardened;
}
