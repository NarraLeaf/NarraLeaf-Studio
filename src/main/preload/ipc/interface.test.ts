import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, send, on } = vi.hoisted(() => ({
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
}));

vi.mock("electron", () => ({
    ipcRenderer: {
        invoke,
        send,
        on,
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

/**
 * The workspace's agent bridge: the listener for agent calls, the plugin-tool report and the
 * mid-call folder request. Plugin code shares the page, and a second `onAgentCall` listener heard
 * every call and could answer it first - so the three are handed out once, to Studio's bootstrap,
 * and nothing on the global bridge reaches them.
 */
describe("preload agent bridge", () => {
    beforeEach(() => {
        vi.resetModules();
        invoke.mockReset();
        invoke.mockResolvedValue({ success: true, data: { granted: [], denied: [], pending: [], refused: [] } });
        send.mockReset();
        on.mockReset();
    });

    it("is not on the global bridge", async () => {
        const { IPCInterface } = await import("./interface");
        expect("onAgentCall" in IPCInterface.workspace).toBe(false);
        expect("reportPluginTools" in IPCInterface.agent).toBe(false);
        expect("requestFolderAccess" in IPCInterface.agent).toBe(false);
    });

    it("is handed out once, and the copy handed out keeps working after hardening", async () => {
        const { IPCInterface } = await import("./interface");
        const bridge = IPCInterface.agentBridge.acquire();

        expect(() => IPCInterface.agentBridge.acquire()).toThrow("already been acquired");
        IPCInterface.agentBridge.harden();
        expect(IPCInterface.agentBridge.isHardened()).toBe(true);
        expect(() => IPCInterface.agentBridge.acquire()).toThrow("already been hardened");

        bridge.onAgentCall(async () => ({ success: true, data: { ok: true, content: [] } }));
        expect(on).toHaveBeenCalledWith(expect.stringContaining("workspace.agentCall"), expect.any(Function));
        bridge.reportPluginTools([]);
        expect(send).toHaveBeenCalledTimes(1);
        await expect(bridge.requestFolderAccess({ callId: "c", paths: ["/a"] })).resolves.toMatchObject({ success: true });
    });

    it("cannot be acquired at all once hardened, even if nothing acquired it first", async () => {
        const { IPCInterface } = await import("./interface");
        IPCInterface.agentBridge.harden();
        expect(() => IPCInterface.agentBridge.acquire()).toThrow("already been hardened");
    });
});
