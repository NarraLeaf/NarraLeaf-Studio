import { beforeEach, describe, expect, it, vi } from "vitest";
import { IPCMessageType, Namespace } from "@shared/types/ipc";
import { IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import { ApiCapability } from "@shared/types/pluginPermissions";
import { WINDOW_PROJECT_MISMATCH_CODE, WindowAppType } from "@shared/types/window";

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

const { reportWindowProjectRefusal } = vi.hoisted(() => ({ reportWindowProjectRefusal: vi.fn() }));

vi.mock("../../utils/windowProjectRefusal", () => ({ reportWindowProjectRefusal }));

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

/** A handler refusing the way `requireWindowProject` makes one refuse. */
class RefusingRequestHandler extends IPCHandler<IPCEventType> {
    readonly name = "refusing-request" as IPCEventType;
    readonly type = IPCMessageType.request as never;

    public async handle(): Promise<RequestStatus<any>> {
        return this.failed(Object.assign(new Error("no such project"), {
            code: WINDOW_PROJECT_MISMATCH_CODE,
        }));
    }
}

/** The same, on a channel that answers nobody: the two forwarding channels are messages. */
class RefusingMessageHandler extends IPCHandler<IPCEventType> {
    readonly name = "refusing-message" as IPCEventType;
    readonly type = IPCMessageType.message as never;

    public handle(): RequestStatus<any> {
        return this.failed(Object.assign(new Error("no such project"), {
            code: WINDOW_PROJECT_MISMATCH_CODE,
        }));
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

function sendMessage(channel: string, senderId: number, data: unknown): void {
    const listener = ipcMainMock.listeners.get(channel);
    expect(listener).toBeDefined();
    listener!({ sender: { id: senderId } }, data);
}

describe("IPCRegistry", () => {
    beforeEach(() => {
        ipcMainMock.reset();
        reportWindowProjectRefusal.mockClear();
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

    /**
     * A refusal for naming another project is reported from here rather than from each guarded
     * handler, and that is the point of putting it here: the guard is spreading across the handler
     * files a few at a time, and a rule that every one of them must also remember to log is a rule
     * that will be half-applied. Recognised by the code, because prose gets reworded.
     */
    it("reports a refusal that named another project, however the handler raised it", async () => {
        const workspace = createFakeWindow(WindowAppType.Workspace, 1);
        createRegistry([workspace]).initialize([
            new RefusingRequestHandler(),
            new RefusingMessageHandler(),
            new ThrowingRequestHandler(),
        ]);

        await invokeChannel("narraleaf-studio:refusing-request", 1, {});
        expect(reportWindowProjectRefusal).toHaveBeenCalledWith(workspace, "refusing-request");

        // A message answers nobody, so its refusal would otherwise be dropped along with its return
        // value - which is exactly the failure the console line exists to prevent.
        reportWindowProjectRefusal.mockClear();
        sendMessage("narraleaf-studio:refusing-message", 1, {});
        await Promise.resolve();
        expect(reportWindowProjectRefusal).toHaveBeenCalledWith(workspace, "refusing-message");

        // An ordinary failure is not one of these and must not be announced as one.
        reportWindowProjectRefusal.mockClear();
        await invokeChannel("narraleaf-studio:throwing-request", 1, {});
        expect(reportWindowProjectRefusal).not.toHaveBeenCalled();
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
