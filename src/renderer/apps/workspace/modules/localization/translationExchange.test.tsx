// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { Services } from "@/lib/workspace/services/services";
import { collectTranslatableUnits, useTranslationExchange, type TranslatableUnitSources } from "./translationExchange";
import { translationDocumentFreezeScope } from "./localizationFreezeScopes";

const mocks = vi.hoisted(() => ({
    context: null as unknown,
    selectFile: vi.fn(),
}));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: mocks.context, isInitialized: true }) }));
vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key }),
}));
vi.mock("@/lib/app/privilegedFacade", () => ({ appPrivilegedFacade: { fs: { selectFile: mocks.selectFile } } }));
vi.mock("@/lib/workspace/services/localization/pluginWords", () => ({
    listPluginWordsRows: () => [{ unitId: "plugin:demo/hello", sourceText: "Hello", context: "Demo" }],
}));
vi.mock("@shared/utils/localizationExchange", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    detectTranslationExchangeFormat: () => "json",
    parseTranslationExchange: () => ({
        rows: [{ unitId: "plugin:demo/hello", source: "Hello", target: "こんにちは" }],
        problems: [],
    }),
}));

afterEach(() => { cleanup(); thawProjectWrites(); mocks.selectFile.mockReset(); });

function setupImport() {
    let finishPicker!: (value: unknown) => void;
    mocks.selectFile.mockReturnValue(new Promise(resolve => { finishPicker = resolve; }));
    const localization = {
        loadDocument: vi.fn().mockResolvedValue({}),
        getKeysIfLoaded: () => ({ schemaVersion: 1, keys: {} }),
        extractRows: () => [],
        applyImportedRows: vi.fn(() => ({ applied: 1, unchanged: 0, unknown: 0, skippedEmpty: 0 })),
    };
    const ui = { showNotification: vi.fn(), showError: vi.fn() };
    const story = { listStories: vi.fn((): Array<{ id: string; name: string }> => []), loadStory: vi.fn() };
    const services: Record<string, unknown> = {
        [Services.Story]: story,
        [Services.Localization]: localization,
        [Services.Character]: { listCharacter: () => [] },
        [Services.UIDocument]: { getDocument: () => null },
        [Services.UI]: ui,
        [Services.Project]: { getProjectConfig: () => ({ name: "Demo" }) },
        [Services.FileSystem]: { read: vi.fn().mockResolvedValue({ ok: true, data: "{}" }) },
    };
    mocks.context = { services: { get: (id: string) => services[id] } };
    return { localization, story, ui, finishPicker: () => finishPicker({ success: true, data: { ok: true, data: ["/translation.json"] } }) };
}

describe("translation exchange", () => {
    it("rechecks the document's write policy after the file picker returns", async () => {
        const test = setupImport();
        const { result } = renderHook(() => useTranslationExchange());
        let pending!: Promise<void>;
        act(() => { pending = result.current.importLanguage("ja", "Japanese", false); });
        freezeProjectWrites({ projectPath: "/project", reason: { kind: "manual" } });
        await act(async () => { test.finishPicker(); await pending; });
        expect(test.localization.applyImportedRows).not.toHaveBeenCalled();
        expect(test.ui.showNotification).not.toHaveBeenCalledWith(expect.anything(), "success");
    });

    it("allows an import into a document carried by a live session", async () => {
        const test = setupImport();
        const { result } = renderHook(() => useTranslationExchange());
        let pending!: Promise<void>;
        act(() => { pending = result.current.importLanguage("ja", "Japanese", false); });
        freezeProjectWrites({ projectPath: "/project", reason: {
            kind: "live-session", session: "room", writable: [translationDocumentFreezeScope("ja")],
        } });
        await act(async () => { test.finishPicker(); await pending; });
        expect(test.localization.applyImportedRows).toHaveBeenCalledOnce();
    });

    it("rechecks the write policy after the source stories finish loading", async () => {
        const test = setupImport();
        let finishStory!: (document: unknown) => void;
        test.story.listStories.mockReturnValue([{ id: "story", name: "Story" }]);
        test.story.loadStory.mockImplementation(() => new Promise(resolve => { finishStory = resolve; }));
        const { result } = renderHook(() => useTranslationExchange());
        let pending!: Promise<void>;
        act(() => { pending = result.current.importLanguage("ja", "Japanese", false); });
        await act(async () => { test.finishPicker(); });
        await waitFor(() => expect(test.story.loadStory).toHaveBeenCalled());
        freezeProjectWrites({ projectPath: "/project", reason: { kind: "manual" } });
        await act(async () => {
            finishStory({ id: "story", name: "Story", scenes: {}, chapters: [], unassignedSceneIds: [] });
            await pending;
        });
        expect(test.localization.applyImportedRows).not.toHaveBeenCalled();
        expect(test.ui.showNotification).not.toHaveBeenCalledWith(expect.anything(), "success");
    });

    it("refuses an exchange when a story cannot be read", async () => {
        const failure = new Error("Story could not be read");
        const sources = {
            storyService: { listStories: () => [{ id: "broken", name: "Broken" }], loadStory: () => Promise.reject(failure) },
            localizationService: { getKeysIfLoaded: () => ({ schemaVersion: 1, keys: {} }) },
            characterService: null,
            uiDocumentService: null,
        } as unknown as TranslatableUnitSources;
        await expect(collectTranslatableUnits(sources)).rejects.toBe(failure);
    });

    it("refuses an exchange when the named-key registry cannot be read", async () => {
        const failure = new Error("Keys could not be read");
        const sources = {
            storyService: { listStories: () => [] },
            localizationService: { getKeysIfLoaded: () => undefined, loadKeys: () => Promise.reject(failure) },
            characterService: null,
            uiDocumentService: null,
        } as unknown as TranslatableUnitSources;
        await expect(collectTranslatableUnits(sources)).rejects.toBe(failure);
    });

    it.each(["import", "export"])("reports an unreadable story before an %s can use a partial unit list", async operation => {
        const test = setupImport();
        const failure = new Error("Story could not be read");
        test.story.listStories.mockReturnValue([{ id: "broken", name: "Broken" }]);
        test.story.loadStory.mockRejectedValue(failure);
        const { result } = renderHook(() => useTranslationExchange());
        if (operation === "import") {
            let pending!: Promise<void>;
            act(() => { pending = result.current.importLanguage("ja", "Japanese", false); });
            await act(async () => { test.finishPicker(); await pending; });
        } else {
            await act(async () => { await result.current.exportLanguage("ja", "Japanese"); });
        }
        expect(test.ui.showError).toHaveBeenCalledWith(failure);
        expect(test.localization.applyImportedRows).not.toHaveBeenCalled();
        expect(test.ui.showNotification).not.toHaveBeenCalledWith(expect.anything(), "success");
    });
});
