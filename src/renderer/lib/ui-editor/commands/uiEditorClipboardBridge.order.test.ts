import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { Services } from "@/lib/workspace/services/services";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument } from "@shared/types/ui-editor/document";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { getUiEditorClipboard, setUiEditorClipboard, type UIEditorClipboardPayload } from "./uiEditorClipboard";
import { publishUiClipboard, refreshUiClipboardFromSystem, resolveUiPasteSource, type UiClipboardEnvironment } from "./uiEditorClipboardBridge";
import { uiEditorPasteAfterSelection } from "./uiEditorCommands";
import { copyUiSurface, pasteUiSurface, refreshUiSurfaceClipboardFromSystem } from "./uiSurfaceCommands";
import { buildUiSurfaceClipboardPayload, getUiSurfaceClipboard, setUiSurfaceClipboard } from "./uiSurfaceClipboard";

const clipboard = vi.hoisted(() => ({ begin: vi.fn(), write: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ clipboard: { beginUiPublication: clipboard.begin, writeEditorSelection: clipboard.write, readEditorSelection: clipboard.read } }),
}));

function payload(copyId: string): UIEditorClipboardPayload {
    return {
        v: 1, kind: "narraleaf.ui.elements", copyId,
        source: { path: "/project", identifier: "project", name: "Project" },
        sourceSurfaceId: "page", topLevelElementIds: [copyId],
        elements: { [copyId]: { id: copyId, type: "nl.text", parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 20, height: 20 } } },
        widgetMainBlueprints: {}, widgetValueBlueprints: {},
    };
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; });
    return { promise, resolve };
}

async function flushPromises(): Promise<void> {
    for (let i = 0; i < 12; i++) await Promise.resolve();
}

const documentService = {
    getContext: () => ({
        project: { getConfig: () => ({ projectPath: "/project" }) },
        services: { get: () => null },
    }),
} as unknown as UIDocumentService;

beforeEach(() => {
    setUiEditorClipboard(null);
    setUiSurfaceClipboard(null);
    clipboard.begin.mockReset().mockResolvedValue({ success: true, data: { stored: false, publicationId: 1 } });
    clipboard.write.mockReset().mockResolvedValue({ success: true, data: { stored: true } });
    clipboard.read.mockReset().mockResolvedValue({ success: true, data: { payload: null } });
});

function surfaceHarness(loadDocument: ReturnType<typeof vi.fn>) {
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
        loadDocument,
    };
    let nextCopy = 0;
    const importTemplateBundle = vi.fn((_bundle: { document: UIDocument }) => ({ importedSurfaces: [], skippedSlots: [] }));
    const service = {
        getDocument: () => doc,
        getContext: () => ({
            project: { getConfig: () => ({ projectPath: "/project" }) },
            services: { get: (id: Services) => {
                if (id === Services.Localization) return localization;
                if (id === Services.Uuid) return { generate: () => `surface-${++nextCopy}` };
                return null;
            } },
        }),
        importTemplateBundle,
    } as unknown as UIDocumentService;
    return { doc, service, importTemplateBundle };
}

describe("publishing UI selections", () => {
    it("keeps a slower previous copy from replacing the newer copy on the platform clipboard", async () => {
        const first = payload("first");
        const second = payload("second");
        const firstKeys = deferred<undefined>();
        const environment = {
            assetsService: null,
            carryTextKeys: vi.fn().mockReturnValueOnce(firstKeys.promise).mockResolvedValue(undefined),
            carryTranslations: vi.fn().mockResolvedValue(undefined),
        } as unknown as UiClipboardEnvironment;
        setUiEditorClipboard(first);
        publishUiClipboard(environment, first);
        await flushPromises();
        setUiEditorClipboard(second);
        publishUiClipboard(environment, second);
        await flushPromises();
        firstKeys.resolve(undefined);
        await flushPromises();
        expect(clipboard.write.mock.calls.map(([, json]) => JSON.parse(json).copyId)).toEqual(["second"]);
    });

    it("pastes the local copy while its platform publication is still preparing", async () => {
        const previous = payload("previous");
        const current = payload("current");
        const keys = deferred<undefined>();
        const environment = {
            assetsService: null,
            carryTextKeys: () => keys.promise,
            carryTranslations: vi.fn().mockResolvedValue(undefined),
        } as unknown as UiClipboardEnvironment;
        clipboard.read.mockResolvedValue({ success: true, data: { payload: JSON.stringify(previous) } });
        setUiEditorClipboard(current);
        publishUiClipboard(environment, current);
        const source = await resolveUiPasteSource(documentService);
        expect(source?.payload.copyId).toBe("current");
        keys.resolve(undefined);
        await flushPromises();
    });

    it("does not let a focus refresh overwrite a copy made while the read was pending", async () => {
        const previous = payload("previous");
        const current = payload("current");
        const read = deferred<{ success: true; data: { payload: string } }>();
        clipboard.read.mockReturnValueOnce(read.promise);
        const refresh = refreshUiClipboardFromSystem();
        setUiEditorClipboard(current);
        read.resolve({ success: true, data: { payload: JSON.stringify(previous) } });
        await refresh;
        expect(getUiEditorClipboard()?.copyId).toBe("current");
    });

    it("abandons a same-project paste if the workspace freezes while the clipboard is being read", async () => {
        const item = payload("current");
        const read = deferred<{ success: true; data: { payload: string } }>();
        clipboard.read.mockReturnValueOnce(read.promise);
        let frozen = false;
        const pasteClipboardPayload = vi.fn(() => ({ ok: true, newRootIds: ["pasted"] }));
        const { doc } = surfaceHarness(vi.fn());
        const service = {
            getDocument: () => doc,
            getContext: () => ({
                project: { getConfig: () => ({ projectPath: "/project" }) },
                services: { get: (id: Services) => id === Services.WorkspaceFreeze ? { isFrozen: () => frozen } : null },
            }),
            pasteClipboardPayload,
        } as unknown as UIDocumentService;
        const state = { setUIElementSelection: vi.fn() } as unknown as UIEditorStateService;
        setUiEditorClipboard(item);
        const paste = uiEditorPasteAfterSelection(service, {} as LocalBlueprintService, state, "page", null);
        frozen = true;
        read.resolve({ success: true, data: { payload: JSON.stringify(item) } });
        expect(await paste).toBe(false);
        expect(pasteClipboardPayload).not.toHaveBeenCalled();
    });
});

describe("publishing whole interfaces", () => {
    it("does not publish a slower earlier surface copy after a later one", async () => {
        const firstLoad = deferred<{ units: Record<string, never> }>();
        const load = vi.fn().mockReturnValueOnce(firstLoad.promise).mockResolvedValue({ units: {} });
        const { service } = surfaceHarness(load);
        copyUiSurface(service, null, "page");
        await flushPromises();
        copyUiSurface(service, null, "page");
        await flushPromises();
        firstLoad.resolve({ units: {} });
        await flushPromises();
        expect(clipboard.write.mock.calls.map(([, json]) => JSON.parse(json).copyId)).toEqual(["surface-2"]);
    });

    it("pastes the just-copied interface while its translations are loading", async () => {
        const pendingLoad = deferred<{ units: Record<string, never> }>();
        const { doc, service, importTemplateBundle } = surfaceHarness(vi.fn().mockReturnValue(pendingLoad.promise));
        const previous = buildUiSurfaceClipboardPayload({ document: doc, surfaceId: "page", blueprintDocument: null, copyId: "older" });
        if (!previous) throw new Error("missing previous surface");
        previous.document.surfaces[0].name = "Old page";
        clipboard.read.mockResolvedValue({ success: true, data: { payload: JSON.stringify(previous) } });
        copyUiSurface(service, null, "page");
        await pasteUiSurface(service);
        expect(importTemplateBundle).toHaveBeenCalledWith(expect.objectContaining({
            document: expect.objectContaining({ surfaces: [expect.objectContaining({ name: "Page" })] }),
        }));
        pendingLoad.resolve({ units: {} });
        await flushPromises();
    });

    it("ignores a focus read that started before the local copy", async () => {
        const { doc } = surfaceHarness(vi.fn());
        const previous = buildUiSurfaceClipboardPayload({ document: doc, surfaceId: "page", blueprintDocument: null, copyId: "older" });
        const current = buildUiSurfaceClipboardPayload({ document: doc, surfaceId: "page", blueprintDocument: null, copyId: "newer" });
        const read = deferred<{ success: true; data: { payload: string } }>();
        clipboard.read.mockReturnValueOnce(read.promise);
        const refresh = refreshUiSurfaceClipboardFromSystem();
        setUiSurfaceClipboard(current);
        read.resolve({ success: true, data: { payload: JSON.stringify(previous) } });
        await refresh;
        expect(getUiSurfaceClipboard()?.copyId).toBe("newer");
    });

    it("keeps an older element copy from overwriting a newer surface copy", async () => {
        const first = payload("element-first");
        const firstKeys = deferred<undefined>();
        const environment = {
            assetsService: null, carryTextKeys: () => firstKeys.promise,
            carryTranslations: vi.fn().mockResolvedValue(undefined),
        } as unknown as UiClipboardEnvironment;
        setUiEditorClipboard(first);
        publishUiClipboard(environment, first);
        await flushPromises();
        const { service } = surfaceHarness(vi.fn().mockResolvedValue({ units: {} }));
        copyUiSurface(service, null, "page");
        await flushPromises();
        firstKeys.resolve(undefined);
        await flushPromises();
        expect(clipboard.write.mock.calls.map(([kind]) => kind)).toEqual(["ui-surfaces"]);
    });
});
