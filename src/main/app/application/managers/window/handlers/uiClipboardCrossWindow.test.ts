import { AsyncLocalStorage } from "node:async_hooks";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Namespace } from "@shared/types/ipc";
import { STUDIO_CLIPBOARD_FORMATS } from "@shared/types/studioClipboard";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import { WindowAppType } from "@shared/types/window";

const host = vi.hoisted(() => ({
    handlers: new Map<string, (event: unknown, data: unknown) => Promise<unknown>>(),
    clipboard: new Map<string, Buffer>(),
    writes: [] as string[],
    currentWindow: (): number => 0,
    failWrite: false,
}));

vi.mock("electron", () => ({
    ipcMain: {
        handle: (channel: string, handler: (event: unknown, data: unknown) => Promise<unknown>) => host.handlers.set(channel, handler),
        on: vi.fn(),
    },
    clipboard: {
        availableFormats: () => [...host.clipboard.keys()],
        readBuffer: (format: string) => host.clipboard.get(format) ?? Buffer.alloc(0),
        readText: () => host.clipboard.get("text/plain")?.toString("utf8") ?? "",
        readHTML: () => host.clipboard.get("text/html")?.toString("utf8") ?? "",
        readRTF: () => host.clipboard.get("text/rtf")?.toString("utf8") ?? "",
        readImage: () => ({ isEmpty: () => !host.clipboard.has("image/png"), toPNG: () => host.clipboard.get("image/png") ?? Buffer.alloc(0) }),
        writeBuffer: (format: string, buffer: Buffer) => {
            if (host.failWrite) throw new Error("clipboard is busy");
            host.clipboard.clear();
            host.clipboard.set(format, Buffer.from(buffer));
            host.writes.push(JSON.parse(buffer.toString("utf8")).copyId);
        },
        writeText: (text: string) => {
            host.clipboard.clear();
            host.clipboard.set("text/plain", Buffer.from(text));
        },
    },
}));

vi.mock("../permissions", () => ({ getDeniedApiCapability: () => null }));
vi.mock("../../../utils/windowProjectRefusal", () => ({ reportWindowProjectRefusal: vi.fn() }));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => {
        const sender = host.currentWindow();
        const invoke = (channel: string, data: unknown) => {
            const handler = host.handlers.get(`narraleaf-studio:${channel}`);
            if (!handler) throw new Error(`Missing IPC handler: ${channel}`);
            return handler({ sender: { id: sender } }, data);
        };
        return { clipboard: {
            beginUiPublication: (kind: string) => invoke("clipboard.editorSelection.write", { kind, payload: "", operation: "begin" }),
            writeEditorSelection: (kind: string, payload: string, publicationId?: number) =>
                invoke("clipboard.editorSelection.write", { kind, payload, publicationId }),
            readEditorSelection: (kind: string) => invoke("clipboard.editorSelection.read", { kind }),
        } };
    },
}));

import { IPCRegistry } from "../ipcRegistry";
import {
    ClipboardReadEditorSelectionHandler,
    ClipboardWriteEditorSelectionHandler,
    ClipboardWritePlainTextHandler,
} from "./clipboardAction";
import type { AppWindow } from "../appWindow";

const windowContext = new AsyncLocalStorage<number>();
type RendererBridge = { publishUiClipboard: (environment: unknown, item: ReturnType<typeof payload>) => void };
type RendererClipboard = {
    setUiEditorClipboard: (item: ReturnType<typeof payload> | null) => void;
    getUiEditorClipboard: () => { copyId?: string } | null;
};
type RendererSurface = { copyUiSurface: (service: unknown, graphs: null, surfaceId: string) => boolean };
type RendererSurfaceClipboard = { setUiSurfaceClipboard: (item: null) => void };
let a: RendererBridge;
let b: RendererBridge;
let aClipboard: RendererClipboard;
let bClipboard: RendererClipboard;
let aSurface: RendererSurface;
let bSurface: RendererSurface;
let aSurfaceClipboard: RendererSurfaceClipboard;
let bSurfaceClipboard: RendererSurfaceClipboard;
let services: { Localization: string; Uuid: string };
const closedWindows = new Set<number>();

beforeAll(async () => {
    host.currentWindow = () => windowContext.getStore() ?? 0;
    vi.resetModules();
    services = (await vi.importActual<{ Services: typeof services }>("@/lib/workspace/services/services")).Services;
    aClipboard = await vi.importActual("@/lib/ui-editor/commands/uiEditorClipboard");
    a = await vi.importActual("@/lib/ui-editor/commands/uiEditorClipboardBridge");
    aSurface = await vi.importActual("@/lib/ui-editor/commands/uiSurfaceCommands");
    aSurfaceClipboard = await vi.importActual("@/lib/ui-editor/commands/uiSurfaceClipboard");
    vi.resetModules();
    bClipboard = await vi.importActual("@/lib/ui-editor/commands/uiEditorClipboard");
    b = await vi.importActual("@/lib/ui-editor/commands/uiEditorClipboardBridge");
    bSurface = await vi.importActual("@/lib/ui-editor/commands/uiSurfaceCommands");
    bSurfaceClipboard = await vi.importActual("@/lib/ui-editor/commands/uiSurfaceClipboard");
});

beforeEach(() => {
    host.handlers.clear();
    host.clipboard.clear();
    host.writes.length = 0;
    host.failWrite = false;
    closedWindows.clear();
    aClipboard.setUiEditorClipboard(null);
    bClipboard.setUiEditorClipboard(null);
    aSurfaceClipboard.setUiSurfaceClipboard(null);
    bSurfaceClipboard.setUiSurfaceClipboard(null);
    const windows = new Map([1, 2].map(id => [id, {
        getWindowType: () => WindowAppType.Workspace,
        isDestroyed: () => closedWindows.has(id),
        app: { logger: { warn: vi.fn() } },
    } as unknown as AppWindow]));
    const registry = new IPCRegistry(Namespace.NarraLeafStudio, sender => windows.get(sender.id));
    registry.initialize([new ClipboardWriteEditorSelectionHandler(), new ClipboardReadEditorSelectionHandler(), new ClipboardWritePlainTextHandler()]);
});

function payload(copyId: string) {
    return {
        v: 1, kind: "narraleaf.ui.elements", copyId, sourceSurfaceId: "page", topLevelElementIds: [copyId],
        elements: { [copyId]: { id: copyId, type: "nl.text", parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 1, height: 1 } } },
        widgetMainBlueprints: {}, widgetValueBlueprints: {},
    };
}

function deferred() {
    let resolve!: (value: undefined) => void;
    const promise = new Promise<undefined>(done => { resolve = done; });
    return { promise, resolve: () => resolve(undefined) };
}

async function flush(): Promise<void> {
    for (let i = 0; i < 30; i++) await Promise.resolve();
}

function copy(windowId: 1 | 2, name: string, wait?: Promise<undefined>): void {
    const renderer = windowId === 1 ? a : b;
    const clipboard = windowId === 1 ? aClipboard : bClipboard;
    const item = payload(name);
    const environment = {
        assetsService: null,
        carryTextKeys: () => wait ?? Promise.resolve(undefined),
        carryTranslations: async () => undefined,
    };
    windowContext.run(windowId, () => {
        clipboard.setUiEditorClipboard(item);
        renderer.publishUiClipboard(environment, item);
    });
}

function copySurface(windowId: 1 | 2, name: string, wait?: Promise<{ units: Record<string, never> }>): void {
    const doc: UIDocument = {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION, id: "doc", name: "Doc",
        surfaces: [{ id: "page", name: "Page", host: "app", kind: "appSurface", designSize: { width: 800, height: 600 }, rootElementId: "root" }],
        elements: {
            root: { id: "root", type: "nl.root", parentId: null, childrenIds: ["title"], layout: { x: 0, y: 0, width: 800, height: 600 } },
            title: { id: "title", type: "nl.text", parentId: "root", childrenIds: [], layout: { x: 0, y: 0, width: 100, height: 20 }, props: { localizationKey: "title" } },
        },
    };
    const localization = {
        getKeysIfLoaded: () => ({ keys: { title: { sourceText: "Title" } } }),
        getConfiguration: () => ({ sourceLocale: "en", locales: [{ code: "en" }, { code: "ja" }] }),
        getDocumentIfLoaded: () => null,
        loadDocument: () => wait ?? Promise.resolve({ units: {} }),
    };
    const service = {
        getDocument: () => doc,
        getContext: () => ({
            project: { getConfig: () => ({ projectPath: `/project-${windowId}` }) },
            services: { get: (id: string) => id === services.Localization ? localization : id === services.Uuid ? { generate: () => name } : null },
        }),
    };
    const renderer = windowId === 1 ? aSurface : bSurface;
    windowContext.run(windowId, () => expect(renderer.copyUiSurface(service, null, "page")).toBe(true));
}

function copiedId(format: keyof typeof STUDIO_CLIPBOARD_FORMATS): string | undefined {
    const value = host.clipboard.get(STUDIO_CLIPBOARD_FORMATS[format]);
    return value ? JSON.parse(value.toString("utf8")).copyId : undefined;
}

describe("UI clipboard publications across project windows", () => {
    it("publishes a normal copy and a subsequent copy from another window", async () => {
        copy(1, "first");
        await flush();
        expect(copiedId("ui-elements")).toBe("first");
        copySurface(2, "surface");
        await flush();
        expect(copiedId("ui-surfaces")).toBe("surface");
        expect(host.writes).toEqual(["first", "surface"]);
    });

    it("keeps a later copy when the earlier window finishes preparing last", async () => {
        const first = deferred();
        copy(1, "first", first.promise);
        await flush();
        copy(2, "second");
        await flush();
        first.resolve();
        await flush();
        expect(host.writes).toEqual(["second"]);
    });

    it("supersedes an earlier element copy as soon as a later surface copy starts", async () => {
        let releaseSurface!: (value: { units: Record<string, never> }) => void;
        const pendingSurface = new Promise<{ units: Record<string, never> }>(resolve => { releaseSurface = resolve; });
        const first = deferred();
        copy(1, "element", first.promise);
        await flush();
        copySurface(2, "surface", pendingSurface);
        await flush();
        first.resolve();
        await flush();
        expect(host.writes).toEqual([]);
        releaseSurface({ units: {} });
        await flush();
        expect(host.writes).toEqual(["surface"]);
    });

    it("retains the latest local copy when its preparation fails and does not publish the older one", async () => {
        const first = deferred();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        copy(1, "first", first.promise);
        await flush();
        copy(2, "failed", Promise.reject(new Error("translation unavailable")));
        await flush();
        first.resolve();
        await flush();
        expect(host.writes).toEqual([]);
        expect(bClipboard.getUiEditorClipboard()?.copyId).toBe("failed");
        warn.mockRestore();
    });

    it("drops a closing window's pending publication and lets the other window copy", async () => {
        const first = deferred();
        copy(1, "closing", first.promise);
        await flush();
        closedWindows.add(1);
        first.resolve();
        await flush();
        expect(host.writes).toEqual([]);
        copy(2, "survivor");
        await flush();
        expect(host.writes).toEqual(["survivor"]);
    });

    it.each([
        ["text/plain", "external text before", "external text after"],
        ["image/png", "image before", "image after"],
    ])("preserves changed external clipboard data in %s", async (format, before, after) => {
        host.clipboard.set(format, Buffer.from(before));
        const first = deferred();
        copy(1, "slow", first.promise);
        await flush();
        host.clipboard.set(format, Buffer.from(after));
        first.resolve();
        await flush();
        expect(host.clipboard.get(format)?.toString()).toBe(after);
        expect(host.writes).toEqual([]);
    });

    it("keeps a later Studio plain-text copy when a UI copy is still preparing", async () => {
        const first = deferred();
        copy(1, "slow", first.promise);
        await flush();
        const write = host.handlers.get("narraleaf-studio:clipboard.plainText.write");
        expect(write).toBeDefined();
        await write!({ sender: { id: 2 } }, { text: "new text" });
        first.resolve();
        await flush();
        expect(host.clipboard.get("text/plain")?.toString()).toBe("new text");
        expect(host.writes).toEqual([]);
    });

    it("leaves the clipboard alone after a platform write failure and accepts the next copy", async () => {
        host.clipboard.set("text/plain", Buffer.from("before"));
        host.failWrite = true;
        copy(1, "failed");
        await flush();
        expect(host.clipboard.get("text/plain")?.toString()).toBe("before");
        host.failWrite = false;
        copy(2, "after");
        await flush();
        expect(copiedId("ui-elements")).toBe("after");
    });
});
