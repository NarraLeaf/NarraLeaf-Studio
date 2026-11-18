// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { freezeProjectWrites, getProjectWriteFreeze, observeProjectWriteFreeze, thawProjectWrites } from "@/lib/app/writeFreeze";
import { translate } from "@/lib/i18n";
import { FsRejectErrorCode } from "@shared/types/os";
import type { StoryNodeActionBlock } from "@shared/types/story";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { LiveHost } from "@/lib/live/liveHost";
import type { LiveLocalizationOp } from "@shared/live/ops";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { DialogContainer } from "../../components/ui/DialogContainer";
import { translationDocumentFreezeScope } from "./localizationLiveSession";
import { LocalizationEditorTab } from "./LocalizationEditorTab";

const mocks = vi.hoisted(() => ({ context: null as unknown }));
vi.mock("../../context", () => ({ useWorkspace: () => ({ context: mocks.context, isInitialized: true }) }));
vi.mock("@/lib/ui-editor/hooks/useUIDocumentRevision", () => ({ useUIDocumentRevision: () => 0 }));

type Harness = Awaited<ReturnType<typeof createHarness>>;
let harness: Harness | undefined;

async function createHarness() {
    const files = new Map<string, string>();
    const ok = <T,>(data: T) => ({ ok: true as const, data });
    let id = 0;
    const fs = {
        read: async (path: string) => files.has(path)
            ? ok(files.get(path)!)
            : { ok: false as const, error: { code: FsRejectErrorCode.NOT_FOUND, message: "missing" } },
        writeFileNoFollowOrCreate: async (path: string, value: string) => { files.set(path, value); return ok(undefined); },
        isDirExists: async () => ok(true),
        createDir: async () => ok(undefined),
        copyFile: async () => ok(undefined),
    };
    const story = new StoryService();
    const localization = new LocalizationService();
    const history = new HistoryService();
    const ui = new UIService();
    const liveView: { session: null; claims: Record<string, string>; self: null; role: "host" | "guest" | null } = {
        session: null, claims: {}, self: null, role: null,
    };
    const liveListeners = new Set<() => void>();
    const live = {
        getView: () => liveView,
        onChanged: (listener: () => void) => { liveListeners.add(listener); return () => liveListeners.delete(listener); },
        setRole: (role: "host" | "guest" | null) => {
            liveView.role = role;
            liveListeners.forEach(listener => listener());
        },
    };
    const project = {
        getLocalizationConfiguration: () => ({ sourceLocale: "en", locales: [
            { code: "en", displayName: "English" }, { code: "ja", displayName: "Japanese" },
        ] }),
        onConfigChanged: () => () => {},
        getProjectConfig: () => ({ name: "Fixture" }),
    };
    const services: Record<string, unknown> = {
        [Services.FileSystem]: fs,
        [Services.Project]: project,
        [Services.Uuid]: { generate: () => `00000000-0000-4000-8000-${(++id).toString(16).padStart(12, "0")}` },
        [Services.History]: history,
        [Services.Story]: story,
        [Services.Localization]: localization,
        [Services.UI]: ui,
        [Services.UIDocument]: null,
        [Services.Character]: { listCharacter: () => [], subscribe: () => () => {} },
        [Services.Live]: live,
        [Services.WorkspaceFreeze]: {
            getReason: () => getProjectWriteFreeze()?.reason ?? null,
            onChanged: (listener: (reason: unknown) => void) => observeProjectWriteFreeze(freeze => listener(freeze?.reason ?? null)),
        },
        [Services.SaveStatus]: { register: () => {}, reportUnreadableDocument: vi.fn() },
    };
    const context = {
        project: {
            getConfig: () => ({ projectPath: "/project" }),
            resolve: (...parts: (string | string[])[]) => parts.flat().join("/").replace(/\/+/g, "/"),
        },
        services: { get: (key: string) => services[key] },
    } as unknown as WorkspaceContext;
    mocks.context = context;
    story.setContext(context);
    history.setContext(context);
    (story as unknown as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
    (story as unknown as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
    await localization.initialize(context, async () => {});
    await localization.loadDocument("ja");
    const entry = story.createStory("Story");
    const scene = story.getStoryDocument(entry.id).chapters[0].sceneIds[0];
    const block: StoryNodeActionBlock = {
        id: "block", parentId: null, childrenIds: [], kind: "nodeAction", disabled: true,
        payload: { action: "narration", text: { textId: "orphan", role: "narration", value: "Hello" } },
    };
    story.insertBlock(entry.id, scene, block, { parentId: null });
    localization.updateUnit("ja", "orphan", "Hello", { target: "訳文" });
    await localization.flushPendingChanges();
    return { files, fs, story, localization, ui, context, live, storyId: entry.id, sceneId: scene };
}

afterEach(async () => {
    cleanup();
    thawProjectWrites();
    if (harness) {
        await harness.localization.teardown(harness.context);
        harness.story.dispose(harness.context);
    }
    harness = undefined;
});

function makeHost(h: Harness): LiveHost {
    return new LiveHost({
        self: "host", stories: [h.storyId], locales: { translations: ["ja"], voice: [] },
        hasVariable: () => false, readScene: () => null, hasSceneRuntimeName: () => false,
        readChapter: () => null, readCharacter: () => null, hasAsset: () => false,
        readAssetFolders: () => null, hasAppTag: () => false, hasDlc: () => false,
        hasBrandColor: () => false, hasUIElement: () => false, hasBlueprint: () => false,
        digestOf: () => null, nextSeq: () => 1,
        applyOp: op => h.localization.applyLiveOp(op as LiveLocalizationOp),
    });
}

describe("orphan translation deletion", () => {
    it("keeps a translation when its story line is restored while the confirmation is open", async () => {
        harness = await createHarness();
        const { story, localization, storyId, sceneId, ui, context } = harness;
        const notify = vi.spyOn(ui, "showNotification");
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        const remove = await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") });
        fireEvent.click(remove);
        const dialog = await screen.findByRole("dialog");

        act(() => story.setBlockDisabled(storyId, sceneId, "block", false));
        await waitFor(() => expect(story.getStoryDocument(storyId).scenes[sceneId].blocks.block.disabled).not.toBe(true));
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });

        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
        expect(notify).toHaveBeenCalledWith(translate("workspace.localization.table.orphans.changed"), "warning");
        await localization.flushPendingChanges();
        const reopened = new LocalizationService();
        await reopened.initialize(context, async () => {});
        expect((await reopened.loadDocument("ja")).units.orphan?.target).toBe("訳文");
        await reopened.teardown(context);
    });

    it("deletes only entries that are still orphaned from a confirmed batch", async () => {
        harness = await createHarness();
        const { story, localization, storyId, sceneId } = harness;
        localization.updateUnit("ja", "other", "Other", { target: "別" });
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.deleteAll") }));
        const dialog = await screen.findByRole("dialog");
        act(() => story.setBlockDisabled(storyId, sceneId, "block", false));
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });
        await waitFor(() => expect(localization.getDocumentIfLoaded("ja")?.units.other).toBeUndefined());
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
    });

    it("removes an unchanged orphan and persists the removal", async () => {
        harness = await createHarness();
        const { localization, context } = harness;
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });
        await waitFor(() => expect(localization.getDocumentIfLoaded("ja")?.units.orphan).toBeUndefined());
        await localization.flushPendingChanges();
        const reopened = new LocalizationService();
        await reopened.initialize(context, async () => {});
        expect((await reopened.loadDocument("ja")).units.orphan).toBeUndefined();
        await reopened.teardown(context);
    });

    it("keeps an orphan changed by another edit while the confirmation is open", async () => {
        harness = await createHarness();
        const { localization, ui } = harness;
        const notify = vi.spyOn(ui, "showNotification");
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        act(() => { localization.updateUnit("ja", "orphan", "Hello", { target: "新しい訳" }); });
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("新しい訳");
        expect(notify).toHaveBeenCalledWith(translate("workspace.localization.table.orphans.changed"), "warning");
    });

    it("deletes the selected orphan when another translation changes", async () => {
        harness = await createHarness();
        const { localization } = harness;
        localization.updateUnit("ja", "other", "Other", { target: "別" });
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        const buttons = await screen.findAllByRole("button", { name: translate("workspace.localization.table.orphans.delete") });
        fireEvent.click(buttons[0]);
        const dialog = await screen.findByRole("dialog");
        act(() => { localization.updateUnit("ja", "other", "Other", { target: "新しい別" }); });
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });
        await waitFor(() => expect(localization.getDocumentIfLoaded("ja")?.units.orphan).toBeUndefined());
        expect(localization.getDocumentIfLoaded("ja")?.units.other.target).toBe("新しい別");
    });

    it("keeps the translation when the confirmation is cancelled", async () => {
        harness = await createHarness();
        const { localization } = harness;
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.cancel") })); });
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
    });

    it("refuses the deletion when a story becomes unreadable after confirmation opens", async () => {
        harness = await createHarness();
        const { story, localization, ui } = harness;
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        const read = vi.spyOn(story, "loadStory").mockRejectedValue(new Error("Story could not be read"));
        const showError = vi.spyOn(ui, "showError");
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });
        await waitFor(() => expect(showError).toHaveBeenCalled());
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
        read.mockRestore();
    });

    it("refuses the deletion when the project freezes during confirmation", async () => {
        harness = await createHarness();
        const { localization } = harness;
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        act(() => freezeProjectWrites({ projectPath: "/project", reason: { kind: "manual" } }));
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
    });

    it("allows deletion when a partial freeze carries this translation document", async () => {
        harness = await createHarness();
        const { localization, live } = harness;
        const authority = makeHost(harness);
        localization.setOperationSink({ handle: op => {
            if (op.op === "set-translations") {
                authority.applyLocal(op, { doc: "localization", locale: "ja" });
            }
            return true;
        } });
        live.setRole("host");
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        act(() => freezeProjectWrites({ projectPath: "/project", reason: {
            kind: "live-session", session: "room", writable: [translationDocumentFreezeScope("ja")],
        } }));
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });
        await waitFor(() => expect(localization.getDocumentIfLoaded("ja")?.units.orphan).toBeUndefined());
        localization.setOperationSink(null);
    });

    it("leaves orphan deletion to the host while this window is a guest", async () => {
        harness = await createHarness();
        const { localization, live } = harness;
        live.setRole("guest");
        const sink = vi.fn(() => true);
        localization.setOperationSink({ handle: sink });
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        const remove = await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") });
        expect(remove.matches(":disabled")).toBe(true);
        expect(remove.getAttribute("data-tip")).toBe(translate("workspace.localization.table.orphans.hostOnly"));
        fireEvent.click(remove);
        expect(sink).not.toHaveBeenCalled();
        expect(screen.queryByRole("dialog")).toBeNull();
        localization.setOperationSink(null);
    });

    it("keeps the host's restored translation when a guest has not received that story change", async () => {
        const guest = await createHarness();
        const host = await createHarness();
        harness = guest;
        mocks.context = guest.context;
        const authority = makeHost(host);
        const received = vi.spyOn(authority, "receive");
        guest.live.setRole("guest");
        guest.localization.setOperationSink({ handle: op => {
            if (op.op === "set-translations") {
                authority.receive({ kind: "intent", clientId: "intent", document: { doc: "localization", locale: "ja" }, op }, "guest");
            }
            return true;
        } });
        try {
            render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
            const remove = await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") });
            act(() => host.story.setBlockDisabled(host.storyId, host.sceneId, "block", false));
            expect(remove.matches(":disabled")).toBe(true);
            fireEvent.click(remove);
            expect(received).not.toHaveBeenCalled();
            expect(host.localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
        } finally {
            guest.localization.setOperationSink(null);
            await host.localization.teardown(host.context);
            host.story.dispose(host.context);
        }
    });

    it("re-enables deletion after leaving a guest session", async () => {
        harness = await createHarness();
        const { live, localization } = harness;
        live.setRole("guest");
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        const remove = await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") });
        expect(remove.matches(":disabled")).toBe(true);
        act(() => live.setRole(null));
        expect(remove.matches(":disabled")).toBe(false);
        fireEvent.click(remove);
        const dialog = await screen.findByRole("dialog");
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });
        await waitFor(() => expect(localization.getDocumentIfLoaded("ja")?.units.orphan).toBeUndefined());
    });

    it("cancels a pending confirmation when this window joins as a guest", async () => {
        harness = await createHarness();
        const { localization, live, ui } = harness;
        const notify = vi.spyOn(ui, "showNotification");
        const sink = vi.fn(() => true);
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        localization.setOperationSink({ handle: sink });
        act(() => live.setRole("guest"));
        await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") })); });
        expect(sink).not.toHaveBeenCalled();
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
        expect(notify).toHaveBeenCalledWith(translate("workspace.localization.table.orphans.hostOnly"), "warning");
        localization.setOperationSink(null);
    });

    it("cancels deletion if this window becomes a guest during the story read", async () => {
        harness = await createHarness();
        const { story, localization, live } = harness;
        const sink = vi.fn(() => true);
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        const original = story.loadStory.bind(story);
        let finish!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        const read = vi.spyOn(story, "loadStory").mockImplementationOnce(async id => { await waiting; return original(id); });
        fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") }));
        await waitFor(() => expect(read).toHaveBeenCalled());
        localization.setOperationSink({ handle: sink });
        act(() => live.setRole("guest"));
        await act(async () => { finish(); });
        expect(sink).not.toHaveBeenCalled();
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
        localization.setOperationSink(null);
        read.mockRestore();
    });

    it("refuses the deletion when the project freezes during the story read", async () => {
        harness = await createHarness();
        const { story, localization } = harness;
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        const original = story.loadStory.bind(story);
        let finish!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        const read = vi.spyOn(story, "loadStory").mockImplementationOnce(async id => { await waiting; return original(id); });
        fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") }));
        await waitFor(() => expect(read).toHaveBeenCalled());
        act(() => freezeProjectWrites({ projectPath: "/project", reason: { kind: "manual" } }));
        await act(async () => { finish(); });
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
        read.mockRestore();
    });

    it("keeps a translation changed while the story index is being read", async () => {
        harness = await createHarness();
        const { story, localization } = harness;
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        const original = story.loadStory.bind(story);
        let finish!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        const read = vi.spyOn(story, "loadStory").mockImplementationOnce(async id => { await waiting; return original(id); });
        fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") }));
        await waitFor(() => expect(read).toHaveBeenCalled());
        act(() => { localization.updateUnit("ja", "orphan", "Hello", { target: "新しい訳" }); });
        await act(async () => { finish(); });
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("新しい訳");
        read.mockRestore();
    });

    it("does not delete after the editor closes during the story read", async () => {
        harness = await createHarness();
        const { story, localization } = harness;
        const view = render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        const original = story.loadStory.bind(story);
        let finish!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        const read = vi.spyOn(story, "loadStory").mockImplementationOnce(async id => { await waiting; return original(id); });
        fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") }));
        await waitFor(() => expect(read).toHaveBeenCalled());
        view.unmount();
        await act(async () => { finish(); });
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
        read.mockRestore();
    });

    it("rechecks a story that changes while its new index is being read", async () => {
        harness = await createHarness();
        const { story, localization, storyId, sceneId } = harness;
        render(<><LocalizationEditorTab payload={{ locale: "ja", orphans: { token: 1 } }} active tabId="translation" /><DialogContainer /></>);
        fireEvent.click(await screen.findByRole("button", { name: translate("workspace.localization.table.orphans.delete") }));
        const dialog = await screen.findByRole("dialog");
        const original = story.loadStory.bind(story);
        const stale = structuredClone(await original(storyId));
        let finish!: () => void;
        const waiting = new Promise<void>(resolve => { finish = resolve; });
        const read = vi.spyOn(story, "loadStory").mockImplementationOnce(async () => { await waiting; return stale; });
        fireEvent.click(within(dialog).getByRole("button", { name: translate("common.ok") }));
        await waitFor(() => expect(read).toHaveBeenCalled());
        act(() => story.setBlockDisabled(storyId, sceneId, "block", false));
        await act(async () => { finish(); });
        await waitFor(() => expect(read.mock.calls.length).toBeGreaterThanOrEqual(3));
        expect(localization.getDocumentIfLoaded("ja")?.units.orphan?.target).toBe("訳文");
        read.mockRestore();
    });
});
