import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Namespace } from "@shared/types/ipc";

const { ipcMainMock } = vi.hoisted(() => {
    const listeners = new Map<string, Array<(...args: any[]) => void>>();
    const ipcMainMock = {
        listeners,
        handle: vi.fn(),
        removeHandler: vi.fn(),
        on: vi.fn((channel: string, listener: (...args: any[]) => void) => {
            const existing = listeners.get(channel) ?? [];
            existing.push(listener);
            listeners.set(channel, existing);
        }),
        once: vi.fn((channel: string, listener: (...args: any[]) => void) => {
            const wrapped = Object.assign((...args: any[]) => {
                ipcMainMock.removeListener(channel, wrapped);
                listener(...args);
            }, { listener });
            const existing = listeners.get(channel) ?? [];
            existing.push(wrapped);
            listeners.set(channel, existing);
        }),
        removeListener: vi.fn((channel: string, listener: (...args: any[]) => void) => {
            const existing = listeners.get(channel) ?? [];
            // Match either the listener itself or a once-wrapper carrying it,
            // mirroring Node's EventEmitter semantics.
            const index = existing.findIndex(l => l === listener || (l as any).listener === listener);
            if (index !== -1) {
                existing.splice(index, 1);
            }
        }),
        removeAllListeners: vi.fn((channel: string) => {
            listeners.delete(channel);
        }),
        emit(channel: string, ...args: any[]) {
            for (const listener of [...(listeners.get(channel) ?? [])]) {
                listener(...args);
            }
        },
        reset() {
            listeners.clear();
            ipcMainMock.handle.mockClear();
            ipcMainMock.removeHandler.mockClear();
            ipcMainMock.on.mockClear();
            ipcMainMock.once.mockClear();
            ipcMainMock.removeListener.mockClear();
            ipcMainMock.removeAllListeners.mockClear();
        },
    };
    return { ipcMainMock };
});

vi.mock("electron", () => ({
    ipcMain: ipcMainMock,
}));

import { IPCHost, IPCWindow } from "./ipcHost";

type FakeWebContents = {
    send: ReturnType<typeof vi.fn>;
    once: (event: string, listener: () => void) => void;
    removeListener: (event: string, listener: () => void) => void;
    emitDestroyed: () => void;
};

function createFakeWindow(): { win: IPCWindow; webContents: FakeWebContents; destroy: () => void } {
    let destroyed = false;
    const destroyedListeners: Array<() => void> = [];
    const webContents: FakeWebContents = {
        send: vi.fn(),
        once: (event, listener) => {
            if (event === "destroyed") {
                destroyedListeners.push(listener);
            }
        },
        removeListener: (event, listener) => {
            if (event === "destroyed") {
                const index = destroyedListeners.indexOf(listener);
                if (index !== -1) {
                    destroyedListeners.splice(index, 1);
                }
            }
        },
        emitDestroyed: () => {
            for (const listener of [...destroyedListeners]) {
                listener();
            }
        },
    };
    return {
        win: {
            getWebContents: () => webContents as unknown as Electron.WebContents,
            isDestroyed: () => destroyed,
        },
        webContents,
        destroy: () => {
            destroyed = true;
        },
    };
}

function getReplyChannel(webContents: FakeWebContents): string {
    const [channel, , requestId] = webContents.send.mock.calls[0] as [string, unknown, string];
    const [namespace, key] = channel.split(":");
    return `${namespace}.reply:${key}.${requestId}`;
}

describe("IPCHost.invoke", () => {
    beforeEach(() => {
        ipcMainMock.reset();
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("resolves on reply and removes the reply listener", async () => {
        const host = new IPCHost(Namespace.NarraLeafStudio);
        const { win, webContents } = createFakeWindow();

        const promise = host.invoke(win, "test-event" as never, { value: 1 } as never);
        const replyChannel = getReplyChannel(webContents);
        expect(ipcMainMock.listeners.get(replyChannel)).toHaveLength(1);

        ipcMainMock.emit(replyChannel, {}, { echoed: true });
        await expect(promise).resolves.toEqual({ echoed: true });
        expect(ipcMainMock.listeners.get(replyChannel)).toHaveLength(0);
    });

    it("rejects after the timeout and cleans up the reply listener", async () => {
        const host = new IPCHost(Namespace.NarraLeafStudio);
        const { win, webContents } = createFakeWindow();

        const promise = host.invoke(win, "test-event" as never, {} as never, { timeoutMs: 500 });
        const replyChannel = getReplyChannel(webContents);
        const assertion = expect(promise).rejects.toThrow("IPC invoke timed out after 500ms");

        vi.advanceTimersByTime(500);
        await assertion;
        expect(ipcMainMock.listeners.get(replyChannel)).toHaveLength(0);
    });

    it("rejects when the target webContents is destroyed before replying", async () => {
        const host = new IPCHost(Namespace.NarraLeafStudio);
        const { win, webContents } = createFakeWindow();

        const promise = host.invoke(win, "test-event" as never, {} as never);
        const replyChannel = getReplyChannel(webContents);
        const assertion = expect(promise).rejects.toThrow("Window closed before replying");

        webContents.emitDestroyed();
        await assertion;
        expect(ipcMainMock.listeners.get(replyChannel)).toHaveLength(0);
    });

    it("throws when invoked on a destroyed window", () => {
        const host = new IPCHost(Namespace.NarraLeafStudio);
        const { win, destroy } = createFakeWindow();
        destroy();

        expect(() => host.invoke(win, "test-event" as never, {} as never)).toThrow("Window is destroyed");
    });
});

describe("IPCHost global registration", () => {
    beforeEach(() => {
        ipcMainMock.reset();
    });

    it("registers a single ipcMain.handle per event and routes by sender", async () => {
        const host = new IPCHost(Namespace.NarraLeafStudio);
        const handler = vi.fn(async (_sender: Electron.WebContents, data: unknown) => ({ success: true, data }));
        host.handleGlobal("test-event" as never, handler as never);

        expect(ipcMainMock.handle).toHaveBeenCalledTimes(1);
        const [channel, registered] = ipcMainMock.handle.mock.calls[0] as [string, (event: any, data: any) => Promise<any>];
        expect(channel).toBe("narraleaf-studio:test-event");

        const sender = { id: 42 };
        const result = await registered({ sender }, { payload: 1 });
        expect(handler).toHaveBeenCalledWith(sender, { payload: 1 });
        expect(result).toEqual({ success: true, data: { payload: 1 } });
    });

    it("registers a single ipcMain.on per message event", () => {
        const host = new IPCHost(Namespace.NarraLeafStudio);
        const handler = vi.fn();
        host.onMessageGlobal("test-message" as never, handler as never);

        expect(ipcMainMock.on).toHaveBeenCalledTimes(1);
        const sender = { id: 7 };
        ipcMainMock.emit("narraleaf-studio:test-message", { sender }, { note: "hi" });
        expect(handler).toHaveBeenCalledWith(sender, { note: "hi" });
    });
});
