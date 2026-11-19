// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "@/lib/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import type { StoryNodeActionBlock } from "@shared/types/story";
import type { LocalizationConfiguration } from "@shared/types/localization";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { VoiceService } from "@/lib/workspace/services/voice/VoiceService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { VoiceEditorTab } from "./VoiceEditorTab";
import { VoicePanel } from "./VoicePanel";

const mocks = vi.hoisted(() => ({
    context: null as unknown,
    duration: vi.fn(),
    frozen: false,
    selectFile: vi.fn(),
    selectSaveFile: vi.fn(),
}));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: mocks.context, isInitialized: true }) }));
vi.mock("../../registry", () => ({ useRegistry: () => ({ openEditorTab: vi.fn() }) }));
vi.mock("@/apps/workspace/hooks", () => ({ useKeybinding: () => {}, whenEditorFocused: () => () => true }));
vi.mock("@/apps/workspace/hooks/useCharacterListGrouping", () => ({ useCharacterListGrouping: () => "flat" }));
vi.mock("@/apps/workspace/components/ui/freezeGuard", async importOriginal => {
    const actual = await importOriginal<typeof import("@/apps/workspace/components/ui/freezeGuard")>();
    return { ...actual, useFreezeGuard: () => actual.makeFreezeGuard(mocks.frozen, "Frozen") };
});
vi.mock("@/lib/workspace/services/voice/audioDuration", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    readAudioDuration: mocks.duration,
}));
vi.mock("@/lib/app/privilegedFacade", () => ({ appPrivilegedFacade: { fs: { selectFile: mocks.selectFile, selectSaveFile: mocks.selectSaveFile } } }));
vi.mock("@tanstack/react-virtual", () => ({
    useVirtualizer: ({ count }: { count: number }) => ({
        getTotalSize: () => count * 40,
        getVirtualItems: () => Array.from({ length: count }, (_, index) => ({ index, key: index, start: index * 40 })),
        measureElement: () => {}, scrollToIndex: () => {},
    }),
}));
vi.mock("@/apps/workspace/modules/assets/components/AssetSelector", () => ({
    AssetSelector: ({ visible, onConfirm }: { visible: boolean; onConfirm: (assets: { id: string }[]) => void }) => visible ? (
        <div><button onClick={() => onConfirm([{ id: "clip-b" }])}>Choose clip B</button></div>
    ) : null,
}));

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

type Harness = Awaited<ReturnType<typeof createHarness>>;
let harness: Harness | undefined;

async function createHarness() {
    const files = new Map<string, string>();
    const ok = <T,>(data: T) => ({ ok: true as const, data });
    let id = 0;
    const history = new HistoryService();
    const story = new StoryService();
    const localization = new LocalizationService();
    const voice = new VoiceService();
    const ui = new UIService();
    let voiceConfig = { voicedLocales: [{ code: "ja", displayName: "Japanese" }], namingPattern: "{unitId}", cast: {}, voiceChoices: false };
    let localizationConfig: LocalizationConfiguration = { sourceLocale: "en", locales: [
        { code: "en", displayName: "English" }, { code: "ja", displayName: "Japanese" },
    ] };
    const projectListeners = new Set<() => void>();
    const project = {
        getVoiceConfiguration: () => voiceConfig,
        getLocalizationConfiguration: () => localizationConfig,
        updateLocalizationConfiguration: async (updater: (value: LocalizationConfiguration) => LocalizationConfiguration) => {
            localizationConfig = updater(localizationConfig);
            projectListeners.forEach(listener => listener());
            return localizationConfig;
        },
        onConfigChanged: (listener: () => void) => { projectListeners.add(listener); return () => projectListeners.delete(listener); },
        getProjectConfig: () => ({ name: "Fixture" }),
    };
    const assets = {
        "clip-a": { id: "clip-a", name: "A.wav", hash: "a", extras: {} },
        "clip-b": { id: "clip-b", name: "B.wav", hash: "b", extras: {} },
    };
    const assetService = {
        getAssets: () => ({ [AssetType.Audio]: assets }),
        getEvents: () => ({ on: () => () => {} }),
        fetch: vi.fn(async () => ({ success: true as const, data: { data: new Uint8Array([1]) } })),
        beginLibraryChange: () => null,
        importFromPaths: vi.fn(async () => ({ success: true as const, data: [{ success: true as const, data: assets["clip-b"] }] })),
    };
    const services: Record<string, unknown> = {
        [Services.FileSystem]: {
            read: async (path: string) => files.has(path) ? ok(files.get(path)!)
                : { ok: false as const, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } },
            writeFileNoFollowOrCreate: async (path: string, value: string) => { files.set(path, value); return ok(undefined); },
            isDirExists: async () => ok(true), createDir: async () => ok(undefined), copyFile: async () => ok(undefined),
        },
        [Services.Project]: project,
        [Services.Uuid]: { generate: () => `00000000-0000-4000-8000-${(++id).toString(16).padStart(12, "0")}` },
        [Services.History]: history, [Services.Story]: story, [Services.Localization]: localization,
        [Services.Voice]: voice, [Services.UI]: ui, [Services.Assets]: assetService,
        [Services.Character]: { listCharacter: () => [], listGroups: () => [], getCharacter: () => undefined, subscribe: () => () => {} },
        [Services.SaveStatus]: { register: () => {}, reportUnreadableDocument: vi.fn() },
    };
    const context = {
        project: { getConfig: () => ({ projectPath: "/project" }), resolve: (...parts: (string | string[])[]) => parts.flat().join("/").replace(/\/+/g, "/") },
        services: { get: (key: string) => services[key] },
    } as unknown as WorkspaceContext;
    mocks.context = context;
    history.setContext(context);
    story.setContext(context);
    (story as unknown as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
    (story as unknown as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
    await localization.initialize(context, async () => {});
    await voice.initialize(context, async () => {});
    await localization.loadDocument("ja");
    await voice.loadDocument("ja");
    const entry = story.createStory("Story");
    const scene = story.getStoryDocument(entry.id).chapters[0].sceneIds[0];
    const addLine = (unitId: string, text: string, disabled = false) => {
        const block: StoryNodeActionBlock = {
            id: `block-${unitId}`, parentId: null, childrenIds: [], kind: "nodeAction", ...(disabled ? { disabled: true } : {}),
            payload: { action: "narration", text: { textId: unitId, role: "narration", value: text } },
        };
        story.insertBlock(entry.id, scene, block, { parentId: null });
    };
    const setVoiceConfig = (next: typeof voiceConfig) => { voiceConfig = next; projectListeners.forEach(listener => listener()); };
    return { context, story, localization, voice, ui, assets, assetService, setVoiceConfig, storyId: entry.id, sceneId: scene, addLine };
}

afterEach(async () => {
    cleanup();
    if (harness) {
        await harness.voice.teardown(harness.context);
        await harness.localization.teardown(harness.context);
        harness.story.dispose(harness.context);
    }
    harness = undefined;
    mocks.duration.mockReset();
    mocks.selectFile.mockReset();
    mocks.selectSaveFile.mockReset();
    mocks.frozen = false;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("voice editor and panel", () => {
    it("keeps a take when its story line is restored while removal is being confirmed", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello", true);
        h.voice.updateUnit("ja", "one", "Hello", { assetId: "clip-a" });
        h.voice.updateUnit("ja", "other", "Other", { assetId: "clip-b" });
        const confirmation = deferred<boolean>();
        vi.spyOn(h.ui, "showConfirm").mockReturnValue(confirmation.promise);
        render(<VoiceEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="voice" />);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.voice.table.orphans.removeAll") }));
        act(() => h.story.setBlockDisabled(h.storyId, h.sceneId, "block-one", false));
        await act(async () => { confirmation.resolve(true); await confirmation.promise; });
        await waitFor(() => expect(h.voice.getDocumentIfLoaded("ja")?.units.other).toBeUndefined());
        expect(h.voice.getDocumentIfLoaded("ja")?.units.one).toBeDefined();
    });

    it("updates coverage when the translated recording text changes", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        h.voice.updateUnit("ja", "one", "Hello", { assetId: "clip-a" });
        render(<VoicePanel panelId="voice" />);
        await screen.findByText(translate("workspace.voice.panel.progress", { covered: 1, total: 1 }));
        act(() => h.localization.updateUnit("ja", "one", "Hello", { target: "こんにちは" }));
        await screen.findByText(translate("workspace.voice.panel.progress", { covered: 0, total: 1 }));
    });

    it("returns the voice table and coverage to the source text when a translation language is removed", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        h.localization.updateUnit("ja", "one", "Hello", { target: "こんにちは" });
        h.voice.updateUnit("ja", "one", "こんにちは", { assetId: "clip-a" });
        render(<><VoicePanel panelId="voice" /><VoiceEditorTab payload={{ locale: "ja" }} active tabId="voice" /></>);
        await screen.findByText("こんにちは");
        await screen.findByText(translate("workspace.voice.panel.progress", { covered: 1, total: 1 }));
        await act(async () => { await h.localization.removeLocale("ja"); });
        await screen.findByText("Hello");
        await screen.findByText(translate("workspace.voice.panel.progress", { covered: 0, total: 1 }));
    });

    it("hides coverage when a story cannot be read", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        render(<VoicePanel panelId="voice" />);
        await screen.findByText(translate("workspace.voice.panel.progress", { covered: 0, total: 1 }));
        vi.spyOn(h.story, "loadStory").mockRejectedValueOnce(new Error("story unreadable"));
        act(() => h.addLine("two", "Goodbye"));
        await waitFor(() => expect(screen.queryByText(translate("workspace.voice.panel.progress", { covered: 0, total: 1 }))).toBeNull());
        expect(screen.queryByText(translate("workspace.voice.panel.progress", { covered: 0, total: 0 }))).toBeNull();
        expect(screen.getByText("Japanese")).toBeTruthy();
    });

    it("reports an unreadable story instead of exporting an incomplete script", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        render(<VoicePanel panelId="voice" />);
        await screen.findByText(translate("workspace.voice.panel.progress", { covered: 0, total: 1 }));
        const failure = new Error("The story could not be read.");
        vi.spyOn(h.story, "loadStory").mockRejectedValueOnce(failure);
        const report = vi.spyOn(h.ui, "showError");
        mocks.selectSaveFile.mockResolvedValue({ success: true, data: { ok: true, data: null } });
        fireEvent.click(screen.getByRole("button", { name: translate("workspace.voice.panel.more") }));
        fireEvent.click(await screen.findByText(translate("workspace.voice.panel.exportScript")));
        await waitFor(() => expect(report).toHaveBeenCalledWith(failure));
        expect(mocks.selectSaveFile).not.toHaveBeenCalled();
    });

    it("reports an unreadable voice document instead of claiming there are no pickups", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        render(<VoicePanel panelId="voice" />);
        await screen.findByText(translate("workspace.voice.panel.progress", { covered: 0, total: 1 }));
        const failure = new Error("The voice assignments could not be read.");
        vi.spyOn(h.voice, "loadDocument").mockRejectedValueOnce(failure);
        const report = vi.spyOn(h.ui, "showError");
        fireEvent.click(screen.getByRole("button", { name: translate("workspace.voice.panel.more") }));
        fireEvent.click(await screen.findByText(translate("workspace.voice.panel.exportPickup")));
        await waitFor(() => expect(report).toHaveBeenCalledWith(failure));
        expect(mocks.selectSaveFile).not.toHaveBeenCalled();
    });

    it("does not attach an old clip's measured duration to its replacement", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        const duration = deferred<number | undefined>();
        mocks.duration.mockReturnValue(duration.promise);
        render(<VoiceEditorTab payload={{ locale: "ja" }} active tabId="voice" />);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.voice.table.assign") }));
        fireEvent.click(screen.getByText("Choose clip B"));
        await waitFor(() => expect(mocks.duration).toHaveBeenCalled());
        act(() => h.voice.updateUnit("ja", "one", "Hello", { assetId: "clip-a" }));
        await act(async () => { duration.resolve(42); await duration.promise; });
        expect(h.voice.getDocumentIfLoaded("ja")?.units.one).toMatchObject({ assetId: "clip-a" });
        expect(h.voice.getDocumentIfLoaded("ja")?.units.one.duration).toBeUndefined();
    });

    it("keeps the measured duration when the linked clip is unchanged", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        const duration = deferred<number | undefined>();
        mocks.duration.mockReturnValue(duration.promise);
        render(<VoiceEditorTab payload={{ locale: "ja" }} active tabId="voice" />);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.voice.table.assign") }));
        fireEvent.click(screen.getByText("Choose clip B"));
        await waitFor(() => expect(mocks.duration).toHaveBeenCalled());
        await act(async () => { duration.resolve(42); await duration.promise; });
        expect(h.voice.getDocumentIfLoaded("ja")?.units.one?.duration).toBe(42);
    });

    it("does not assign a clip when the project freezes while the picker is open", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        const view = render(<VoiceEditorTab payload={{ locale: "ja" }} active tabId="voice" />);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.voice.table.assign") }));
        mocks.frozen = true;
        view.rerender(<VoiceEditorTab payload={{ locale: "ja" }} active tabId="voice" />);
        fireEvent.click(screen.getByText("Choose clip B"));
        expect(h.voice.getDocumentIfLoaded("ja")?.units.one).toBeUndefined();
    });

    it("does not start a pending audition after the tab is hidden", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        h.voice.updateUnit("ja", "one", "Hello", { assetId: "clip-a" });
        const fetch = deferred<Awaited<ReturnType<typeof h.assetService.fetch>>>();
        h.assetService.fetch.mockReturnValue(fetch.promise);
        const play = vi.fn(async () => {});
        vi.stubGlobal("Audio", class { src = ""; volume = 1; onended: (() => void) | null = null; pause() {} play = play; });
        Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
        Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
        const view = render(<VoiceEditorTab payload={{ locale: "ja" }} active tabId="voice" />);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.voice.table.play") }));
        view.rerender(<VoiceEditorTab payload={{ locale: "ja" }} active={false} tabId="voice" />);
        await act(async () => { fetch.resolve({ success: true, data: { data: new Uint8Array([1]) } }); await fetch.promise; });
        expect(play).not.toHaveBeenCalled();
    });

    it("keeps the newer story coverage when an older read finishes last", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        render(<VoicePanel panelId="voice" />);
        await screen.findByText(translate("workspace.voice.panel.progress", { covered: 0, total: 1 }));
        const oldRead = deferred<ReturnType<typeof h.story.getStoryDocument>>();
        vi.spyOn(h.story, "loadStory").mockReturnValueOnce(oldRead.promise);
        act(() => h.addLine("two", "Goodbye"));
        const oldDocument = structuredClone(h.story.getStoryDocument(h.storyId));
        act(() => h.addLine("three", "See you"));
        await screen.findByText(translate("workspace.voice.panel.progress", { covered: 0, total: 3 }));
        await act(async () => { oldRead.resolve(oldDocument); await oldRead.promise; });
        expect(screen.getByText(translate("workspace.voice.panel.progress", { covered: 0, total: 3 }))).toBeTruthy();
    });

    it("refreshes the panel and table when the project changes a voice language name", async () => {
        harness = await createHarness();
        const h = harness;
        render(<><VoicePanel panelId="voice" /><VoiceEditorTab payload={{ locale: "ja" }} active tabId="voice" /></>);
        await waitFor(() => expect(screen.getAllByText("Japanese")).toHaveLength(2));
        act(() => h.setVoiceConfig({ voicedLocales: [{ code: "ja", displayName: "日本語" }], namingPattern: "{unitId}", cast: {}, voiceChoices: false }));
        await waitFor(() => expect(screen.getAllByText("日本語")).toHaveLength(2));
    });

    it("keeps an orphan changed while removal is being confirmed", async () => {
        harness = await createHarness();
        const h = harness;
        h.voice.updateUnit("ja", "one", "Hello", { assetId: "clip-a" });
        h.voice.updateUnit("ja", "other", "Other", { assetId: "clip-b" });
        const confirmation = deferred<boolean>();
        vi.spyOn(h.ui, "showConfirm").mockReturnValue(confirmation.promise);
        render(<VoiceEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="voice" />);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.voice.table.orphans.removeAll") }));
        act(() => h.voice.updateUnit("ja", "one", "Hello", { note: "New direction" }));
        await act(async () => { confirmation.resolve(true); await confirmation.promise; });
        await waitFor(() => expect(h.voice.getDocumentIfLoaded("ja")?.units.other).toBeUndefined());
        expect(h.voice.getDocumentIfLoaded("ja")?.units.one?.note).toBe("New direction");
    });

    it("rechecks the story after it changes during the confirmed orphan read", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello", true);
        h.voice.updateUnit("ja", "one", "Hello", { assetId: "clip-a" });
        h.voice.updateUnit("ja", "other", "Other", { assetId: "clip-b" });
        const confirmation = deferred<boolean>();
        vi.spyOn(h.ui, "showConfirm").mockReturnValue(confirmation.promise);
        render(<VoiceEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="voice" />);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.voice.table.orphans.removeAll") }));
        const staleDocument = structuredClone(h.story.getStoryDocument(h.storyId));
        const pendingRead = deferred<typeof staleDocument>();
        const read = vi.spyOn(h.story, "loadStory").mockReturnValueOnce(pendingRead.promise);
        await act(async () => { confirmation.resolve(true); await confirmation.promise; });
        await waitFor(() => expect(read).toHaveBeenCalled());
        act(() => h.story.setBlockDisabled(h.storyId, h.sceneId, "block-one", false));
        await act(async () => { pendingRead.resolve(staleDocument); await pendingRead.promise; });
        await waitFor(() => expect(h.voice.getDocumentIfLoaded("ja")?.units.other).toBeUndefined());
        expect(h.voice.getDocumentIfLoaded("ja")?.units.one).toBeDefined();
    });

    it("does not attach a batch import's measured duration to a replacement", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        mocks.selectFile.mockResolvedValue({ success: true, data: { ok: true, data: ["/recording/one.wav"] } });
        const duration = deferred<number | undefined>();
        mocks.duration.mockReturnValue(duration.promise);
        render(<VoicePanel panelId="voice" />);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.voice.panel.more") }));
        fireEvent.click(await screen.findByText(translate("workspace.voice.panel.importAudio")));
        await waitFor(() => expect(mocks.duration).toHaveBeenCalled());
        expect(h.voice.getDocumentIfLoaded("ja")?.units.one?.assetId).toBe("clip-b");
        act(() => h.voice.updateUnit("ja", "one", "Hello", { assetId: "clip-a" }));
        await act(async () => { duration.resolve(42); await duration.promise; });
        expect(h.voice.getDocumentIfLoaded("ja")?.units.one?.duration).toBeUndefined();
    });

    it("keeps the latest audition when the earlier file arrives last", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        h.addLine("two", "Goodbye");
        h.voice.updateUnit("ja", "one", "Hello", { assetId: "clip-a" });
        h.voice.updateUnit("ja", "two", "Goodbye", { assetId: "clip-b" });
        const earlier = deferred<Awaited<ReturnType<typeof h.assetService.fetch>>>();
        h.assetService.fetch.mockReturnValueOnce(earlier.promise);
        const play = vi.fn(async () => {});
        vi.stubGlobal("Audio", class { src = ""; volume = 1; onended: (() => void) | null = null; pause() {} play = play; });
        const createUrl = vi.fn(() => "blob:test");
        Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
        Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
        render(<VoiceEditorTab payload={{ locale: "ja" }} active tabId="voice" />);
        const first = (await screen.findByText("Hello")).closest(".group")!;
        const second = screen.getByText("Goodbye").closest(".group")!;
        fireEvent.click(within(first as HTMLElement).getByRole("button", { name: translate("workspace.voice.table.play") }));
        fireEvent.click(within(second as HTMLElement).getByRole("button", { name: translate("workspace.voice.table.play") }));
        await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
        await act(async () => { earlier.resolve({ success: true, data: { data: new Uint8Array([1]) } }); await earlier.promise; });
        expect(play).toHaveBeenCalledTimes(1);
        expect(createUrl).toHaveBeenCalledTimes(1);
        expect(within(second as HTMLElement).getByRole("button", { name: translate("workspace.voice.table.stop") })).toBeTruthy();
    });

    it("keeps the newer audition when the previous play request fails late", async () => {
        harness = await createHarness();
        const h = harness;
        h.addLine("one", "Hello");
        h.addLine("two", "Goodbye");
        h.voice.updateUnit("ja", "one", "Hello", { assetId: "clip-a" });
        h.voice.updateUnit("ja", "two", "Goodbye", { assetId: "clip-b" });
        const earlierPlay = deferred<void>();
        const play = vi.fn().mockReturnValueOnce(earlierPlay.promise).mockResolvedValue(undefined);
        vi.stubGlobal("Audio", class { src = ""; volume = 1; onended: (() => void) | null = null; pause() {} play = play; });
        Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:test") });
        Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
        render(<VoiceEditorTab payload={{ locale: "ja" }} active tabId="voice" />);
        const first = (await screen.findByText("Hello")).closest(".group")! as HTMLElement;
        const second = screen.getByText("Goodbye").closest(".group")! as HTMLElement;
        fireEvent.click(within(first).getByRole("button", { name: translate("workspace.voice.table.play") }));
        await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
        fireEvent.click(within(second).getByRole("button", { name: translate("workspace.voice.table.play") }));
        await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
        await act(async () => { earlierPlay.reject(new Error("play cancelled")); await earlierPlay.promise.catch(() => {}); });
        expect(within(second).getByRole("button", { name: translate("workspace.voice.table.stop") })).toBeTruthy();
    });
});
