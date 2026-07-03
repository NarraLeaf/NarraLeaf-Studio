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
        const api = {
            privileged: {
                acquire: vi.fn(() => privilegedRuntime),
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
});
