import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RendererInterfaceKey } from "@shared/types/constants";

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
        vi.stubGlobal("window", { [RendererInterfaceKey]: api });

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
        vi.stubGlobal("window", { [RendererInterfaceKey]: api });

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
});
