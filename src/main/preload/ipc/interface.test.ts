import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({
    invoke: vi.fn(),
}));

vi.mock("electron", () => ({
    ipcRenderer: {
        invoke,
        send: vi.fn(),
        on: vi.fn(),
        off: vi.fn(),
    },
    webUtils: {
        getPathForFile: vi.fn(() => ""),
    },
}));

describe("preload privileged bridge hardening", () => {
    beforeEach(() => {
        vi.resetModules();
        invoke.mockReset();
        invoke.mockResolvedValue({ success: true, data: "ok" });
    });

    it("blocks global privileged calls after hardening while keeping acquired runtime access", async () => {
        const { IPCInterface } = await import("./interface");
        const actor = { kind: "facade" as const, id: "default" as const };
        const runtime = IPCInterface.privileged.acquire();

        await expect(IPCInterface.privileged.fs.stat(actor, "/tmp/before")).resolves.toEqual({
            success: true,
            data: "ok",
        });

        IPCInterface.privileged.harden();

        await expect(IPCInterface.privileged.fs.stat(actor, "/tmp/after")).resolves.toMatchObject({
            success: false,
            error: expect.stringContaining("no longer available"),
        });
        expect(() => IPCInterface.privileged.acquire()).toThrow("already been hardened");

        await expect(runtime.fs.stat(actor, "/tmp/runtime")).resolves.toEqual({
            success: true,
            data: "ok",
        });
    });
});
