import { RendererInterfaceKey } from "@shared/types/constants";
import type { RendererPrivilegedInterface } from "@shared/types/renderer";

let rendererInterface: Window[typeof RendererInterfaceKey] | null = null;
let privilegedInterface: RendererPrivilegedInterface | null = null;
let hardened = false;

function readGlobalInterface(): Window[typeof RendererInterfaceKey] | undefined {
    return window[RendererInterfaceKey];
}

export function initializeRendererBridge(): Window[typeof RendererInterfaceKey] {
    if (rendererInterface) {
        return rendererInterface;
    }

    const api = readGlobalInterface();
    if (!api) {
        throw new Error("Invalid environment: Renderer interface not found");
    }

    rendererInterface = api;
    privilegedInterface = api.privileged.acquire();
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

export function hardenRendererBridge(): void {
    const api = initializeRendererBridge();
    if (hardened) {
        return;
    }

    api.privileged.harden();
    hardened = true;

    try {
        Reflect.deleteProperty(window, RendererInterfaceKey);
    } catch {
        /* Some Electron-exposed properties may be non-configurable. */
    }

    if (readGlobalInterface()) {
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
