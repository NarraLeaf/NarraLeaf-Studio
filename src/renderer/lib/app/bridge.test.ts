import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererInterfaceKey } from "@shared/types/constants";

/** The preload's global as the page sees it: the bridge behind a once-only `acquire`. */
function globalBridgeFor(api: object) {
    let hardened = false;
    return {
        acquire: vi.fn(() => {
            if (hardened) {
                throw new Error("The renderer bridge has already been hardened");
            }
            return api;
        }),
        harden: vi.fn(() => {
            hardened = true;
        }),
        isHardened: vi.fn(() => hardened),
    };
}

describe("renderer bridge hardening", () => {
    beforeEach(() => {
        vi.resetModules();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("caches the preload bridge and removes the global reference after hardening", async () => {
        const privilegedRuntime = {};
        const agentRuntime = {};
        const api = {
            privileged: {
                acquire: vi.fn(() => privilegedRuntime),
                harden: vi.fn(),
                isHardened: vi.fn(() => false),
            },
            agentBridge: {
                acquire: vi.fn(() => agentRuntime),
                harden: vi.fn(),
                isHardened: vi.fn(() => false),
            },
        };
        vi.stubGlobal("window", { [RendererInterfaceKey]: globalBridgeFor(api) });

        const bridge = await import("./bridge");

        expect(bridge.initializeRendererBridge()).toBe(api);
        expect(bridge.getPrivilegedInterface()).toBe(privilegedRuntime);

        bridge.hardenRendererBridge();

        expect(api.privileged.harden).toHaveBeenCalledOnce();
        expect((window as any)[RendererInterfaceKey]).toBeUndefined();
        expect(bridge.getInterface()).toBe(api);
        expect(bridge.getPrivilegedInterface()).toBe(privilegedRuntime);
    });

    it("takes the agent bridge once at boot and closes it with the privileged one", async () => {
        const agentRuntime = { onAgentCall: vi.fn() };
        const api = {
            privileged: { acquire: vi.fn(() => ({})), harden: vi.fn(), isHardened: vi.fn(() => false) },
            agentBridge: { acquire: vi.fn(() => agentRuntime), harden: vi.fn(), isHardened: vi.fn(() => false) },
        };
        vi.stubGlobal("window", { [RendererInterfaceKey]: globalBridgeFor(api) });

        const bridge = await import("./bridge");

        bridge.initializeRendererBridge();
        bridge.initializeRendererBridge();
        expect(api.agentBridge.acquire).toHaveBeenCalledOnce();
        expect(bridge.getAgentBridgeInterface()).toBe(agentRuntime);

        bridge.hardenRendererBridge();

        expect(api.agentBridge.harden).toHaveBeenCalledOnce();
        expect(bridge.getAgentBridgeInterface()).toBe(agentRuntime);
        expect(api.agentBridge.acquire).toHaveBeenCalledOnce();
    });

    it("closes the global itself, so code that loads later cannot take the bridge from it", async () => {
        // ⚠ The property Electron defines cannot be deleted, so the global stays reachable: what
        // has to be true is that asking it for the bridge after hardening gets nothing.
        const api = {
            privileged: { acquire: vi.fn(() => ({})), harden: vi.fn(), isHardened: vi.fn(() => false) },
            agentBridge: { acquire: vi.fn(() => ({})), harden: vi.fn(), isHardened: vi.fn(() => false) },
        };
        const global = globalBridgeFor(api);
        const undeletable = {};
        Object.defineProperty(undeletable, RendererInterfaceKey, { value: global, configurable: false });
        vi.stubGlobal("window", undeletable);

        const bridge = await import("./bridge");
        bridge.initializeRendererBridge();
        bridge.hardenRendererBridge();

        expect(global.harden).toHaveBeenCalledOnce();
        expect((window as any)[RendererInterfaceKey]).toBe(global);
        expect(() => (window as any)[RendererInterfaceKey].acquire()).toThrow(/hardened/);
        expect(global.acquire).toHaveBeenCalledTimes(2);
    });
});
