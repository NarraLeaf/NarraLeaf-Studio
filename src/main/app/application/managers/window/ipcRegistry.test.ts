import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPCMessageType, Namespace } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { ApiCapability } from "@shared/types/pluginPermissions";
import { WindowAppType } from "@shared/types/window";

const { ipcMainMock } = vi.hoisted(() => {
    const handlers = new Map<string, (event: any, data: any) => Promise<any>>();
    const listeners = new Map<string, (event: any, data: any) => void>();
    const ipcMainMock = {
        handlers,
        listeners,
        handle: vi.fn((channel: string, handler: (event: any, data: any) => Promise<any>) => {
            handlers.set(channel, handler);
        }),
        on: vi.fn((channel: string, listener: (event: any, data: any) => void) => {
            listeners.set(channel, listener);
        }),
        once: vi.fn(),
        removeListener: vi.fn(),
        removeHandler: vi.fn(),
        removeAllListeners: vi.fn(),
        reset() {
            handlers.clear();
            listeners.clear();
            ipcMainMock.handle.mockClear();
            ipcMainMock.on.mockClear();
        },
    };
    return { ipcMainMock };
});

vi.mock("electron", () => ({
    ipcMain: ipcMainMock,
}));

import { IPCRegistry } from "./ipcRegistry";
import { IPCHandler } from "./handlers/IPCHandler";
import type { AppWindow } from "./appWindow";
import type { WindowProxy } from "./windowProxy";

function createFakeWindow(windowType: WindowAppType, webContentsId: number, destroyed = false): AppWindow {
    return {
        getWindowType: () => windowType,
        getWebContents: () => ({ id: webContentsId }) as unknown as Electron.WebContents,
        isDestroyed: () => destroyed,
        getProps: () => ({}),
    } as unknown as AppWindow;
}

class FakeRequestHandler extends IPCHandler<IPCEventType> {
    readonly name = "fake-request" as IPCEventType;
    readonly type = IPCMessageType.request as never;
    public readonly handleSpy = vi.fn();

    constructor(public override readonly requiredApiCapabilities?: readonly ApiCapability[]) {
        super();
    }

    public async handle(window: WindowProxy, data: unknown): Promise<RequestStatus<any>> {
        this.handleSpy(window, data);
        return this.success({ handledBy: (window as AppWindow).getWebContents().id });
    }
}

class ThrowingRequestHandler extends IPCHandler<IPCEventType> {
    readonly name = "throwing-request" as IPCEventType;
    readonly type = IPCMessageType.request as never;

    public async handle(): Promise<RequestStatus<any>> {
        throw new Error("handler exploded");
    }
}

function createRegistry(windows: AppWindow[]): IPCRegistry {
    const bySender = new Map(windows.map(w => [w.getWebContents().id, w]));
    return new IPCRegistry(
        Namespace.NarraLeafStudio,
        sender => bySender.get(sender.id),
    );
}

async function invokeChannel(channel: string, senderId: number, data: unknown): Promise<any> {
    const handler = ipcMainMock.handlers.get(channel);
    expect(handler).toBeDefined();
    return handler!({ sender: { id: senderId } }, data);
}

describe("IPCRegistry", () => {
    beforeEach(() => {
        ipcMainMock.reset();
    });

    it("routes a request to the window matching the sender", async () => {
        const workspace = createFakeWindow(WindowAppType.Workspace, 1);
        const settings = createFakeWindow(WindowAppType.Settings, 2);
        const handler = new FakeRequestHandler();
        createRegistry([workspace, settings]).initialize([handler]);

        const result = await invokeChannel("narraleaf-studio:fake-request", 2, { x: 1 });
        expect(result).toEqual({ success: true, data: { handledBy: 2 } });
        expect(handler.handleSpy).toHaveBeenCalledWith(settings, { x: 1 });
    });

    it("fails cleanly for an unknown or destroyed sender", async () => {
        const closing = createFakeWindow(WindowAppType.Workspace, 3, true);
        createRegistry([closing]).initialize([new FakeRequestHandler()]);

        const unknownResult = await invokeChannel("narraleaf-studio:fake-request", 99, {});
        expect(unknownResult).toMatchObject({ success: false, error: expect.stringContaining("No live window") });

        const destroyedResult = await invokeChannel("narraleaf-studio:fake-request", 3, {});
        expect(destroyedResult).toMatchObject({ success: false, error: expect.stringContaining("No live window") });
    });

    it("enforces per-window API capabilities using real declarations", async () => {
        const workspace = createFakeWindow(WindowAppType.Workspace, 1);
        const prompt = createFakeWindow(WindowAppType.PluginPermissionPrompt, 2);
        const gated = new FakeRequestHandler([ApiCapability.PluginPermissionGrant]);
        createRegistry([workspace, prompt]).initialize([gated]);

        // Workspace declares no elevated API capabilities → denied.
        const denied = await invokeChannel("narraleaf-studio:fake-request", 1, {});
        expect(denied).toMatchObject({ success: false, error: expect.stringContaining("API permission denied") });
        expect(gated.handleSpy).not.toHaveBeenCalled();

        // PluginPermissionPrompt declares the grant capabilities → allowed.
        const allowed = await invokeChannel("narraleaf-studio:fake-request", 2, {});
        expect(allowed).toEqual({ success: true, data: { handledBy: 2 } });
    });

    it("wraps handler exceptions in a failed envelope", async () => {
        const workspace = createFakeWindow(WindowAppType.Workspace, 1);
        createRegistry([workspace]).initialize([new ThrowingRequestHandler()]);

        const result = await invokeChannel("narraleaf-studio:throwing-request", 1, {});
        expect(result).toMatchObject({ success: false, error: "handler exploded" });
    });

    it("registers each event exactly once and rejects duplicates", () => {
        const workspace = createFakeWindow(WindowAppType.Workspace, 1);
        expect(() =>
            createRegistry([workspace]).initialize([new FakeRequestHandler(), new FakeRequestHandler()]),
        ).toThrow("Duplicate IPC handler");
        expect(() =>
            createRegistry([workspace]).initialize([new FakeRequestHandler()]),
        ).not.toThrow();
    });
});
