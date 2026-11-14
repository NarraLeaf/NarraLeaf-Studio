// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { sceneHistory as words } from "@shared/i18n/catalog/en/sceneHistory";
import { assets } from "@shared/i18n/catalog/en/assets";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import { SaveStatusService } from "@/lib/workspace/services/autosave/SaveStatusService";
import { SceneHistoryService } from "@/lib/workspace/services/story/sceneHistory/SceneHistoryService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { STORY_SNAPSHOT_PANEL_ID } from "../story-snapshots/storySnapshotPanelId";
import { SceneHistoryPanel } from "./SceneHistoryPanel";
import { StoryRowHistoryModal } from "./StoryRowHistoryModal";

const projectPath = "/project";
const indexPath = `${projectPath}/.nlstudio/scene-history/story/scene/index.json`;
let context: WorkspaceContext;
let scene: StoryScene | undefined;
let focusedScene = "scene";
let files: Map<string, string>;
let failRead = false;
let failWrite: "entry" | "index" | null;
let history: SceneHistoryService;
let saveStatus: SaveStatusService;
let fs: FileSystemService;
let showNotification: ReturnType<typeof vi.fn>;
let showSticky: ReturnType<typeof vi.fn>;
let commit: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;
let revision: number;

vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context, isInitialized: true }),
}));
vi.mock("@/apps/workspace/hooks/useUIService", () => ({
    usePanels: () => [{ id: STORY_SNAPSHOT_PANEL_ID, payload: { storyId: "story", sceneId: focusedScene } }],
}));
vi.mock("@/apps/workspace/components/ui/freezeGuard", () => ({
    useFreezeGuard: () => ({ writes: (busy: boolean, tip: string) => ({ disabled: busy, "data-tip": tip }) }),
}));

function row(value: string): StoryBlock {
    return {
        id: "a", parentId: null, childrenIds: [], kind: "nodeAction",
        payload: { action: "narration", text: { textId: "text-a", role: "narration", value } },
    };
}

function renderRowHistory() {
    return render(<StoryRowHistoryModal
        target={{ storyId: "story", sceneId: "scene", blockId: "a" }}
        onClose={onClose} characters={[]} scene={scene} scenes={scene ? { scene } : {}}
        readLine={() => "Line"}
    />);
}

beforeEach(async () => {
    files = new Map();
    focusedScene = "scene";
    failRead = false;
    failWrite = null;
    revision = 1;
    scene = {
        id: "scene", name: "Scene", runtimeName: "scene", rootBlockIds: ["a"], blocks: { a: row("previous") },
    } as StoryScene;
    showNotification = vi.fn();
    showSticky = vi.fn(() => "toast-1");
    onClose = vi.fn();
    commit = vi.fn((_storyId: string, _sceneId: string, next: StoryScene) => {
        scene = next;
        revision += 1;
        return true;
    });
    fs = new FileSystemService();
    vi.spyOn(fs, "isFileExists").mockImplementation(async path => ({ ok: true, data: files.has(path) }));
    vi.spyOn(fs, "isDirExists").mockResolvedValue({ ok: true, data: true });
    vi.spyOn(fs, "readJSON").mockImplementation(async <T,>(path: string): Promise<FsRequestResult<T>> => {
        const contents = files.get(path);
        if (contents === undefined || (failRead && path.endsWith("index.json"))) {
            return { ok: false, error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "read denied" } };
        }
        return { ok: true, data: JSON.parse(contents) as T };
    });
    vi.spyOn(fs, "deleteFile").mockImplementation(async path => {
        files.delete(path);
        return { ok: true, data: undefined };
    });
    vi.spyOn(appPrivilegedFacade.fs, "writeFileNoFollowOrCreate").mockImplementation(async (path, data) => {
        const kind = path.endsWith("index.json") ? "index" : "entry";
        if (failWrite === kind) {
            return { success: true, data: { ok: false, error: { code: FsRejectErrorCode.PERMISSION_DENIED, message: "write denied" } } };
        }
        files.set(path, data);
        return { success: true, data: { ok: true, data: undefined } };
    });
    const story = {
        getLoadedStoryDocument: () => ({ id: "story", scenes: scene ? { scene } : {} }),
        getSceneContentRevision: () => revision,
        commitSceneReplacement: commit,
        onDocumentChanged: () => () => {},
    };
    let nextId = 0;
    history = new SceneHistoryService();
    saveStatus = new SaveStatusService();
    context = {
        project: { resolve: (...parts: string[]) => [projectPath, ...parts].join("/") },
        services: { get(id: Services) {
            switch (id) {
                case Services.Story: return story;
                case Services.FileSystem: return fs;
                case Services.SceneHistory: return history;
                case Services.SaveStatus: return saveStatus;
                case Services.Uuid: return { generate: () => `entry-${++nextId}` };
                case Services.GlobalSettings: return { getSync: (_key: string, fallback: unknown) => fallback };
                case Services.Character: return { listCharacter: () => [] };
                case Services.UI: return { showNotification, notifications: { showSticky, close: vi.fn() } };
                case Services.Console: return { log: vi.fn() };
                default: throw new Error(`Unexpected service ${id}`);
            }
        } },
    } as unknown as WorkspaceContext;
    saveStatus.setContext(context);
    await saveStatus.initialize(context, async () => {});
    await history.initialize(context, async () => {});
});

afterEach(() => {
    cleanup();
    saveStatus.dispose();
    history.dispose();
    thawProjectWrites();
    vi.restoreAllMocks();
});

async function savePreviousAndEdit() {
    const result = await history.createManualSnapshot("story", "scene");
    expect(result.status).toBe("ok");
    scene = { ...scene!, blocks: { a: row("current") } };
    revision += 1;
}

describe("scene history feedback", () => {
    it("creates repeated manual snapshots of unchanged content", async () => {
        render(<SceneHistoryPanel />);
        await screen.findByText(words.noEntries);
        const save = screen.getByRole("button", { name: words.saveNow });
        fireEvent.click(save);
        await waitFor(() => expect(screen.getAllByText(words.kindManual)).toHaveLength(1));
        fireEvent.click(save);
        await waitFor(() => expect(screen.getAllByText(words.kindManual)).toHaveLength(2));
        expect(await history.listEntries("story", "scene")).toHaveLength(2);
        expect(showNotification).not.toHaveBeenCalled();
        expect(showSticky).not.toHaveBeenCalled();
    });

    it.each(["entry", "index"] as const)("reports a failed %s write once through save status", async kind => {
        render(<SceneHistoryPanel />);
        await screen.findByText(words.noEntries);
        failWrite = kind;
        const save = screen.getByRole("button", { name: words.saveNow });
        fireEvent.click(save);
        await waitFor(() => expect(showSticky).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(save.matches(":disabled")).toBe(false));
        expect(showSticky.mock.calls[0][0].message).toBe(`Could not save the ${words.panelTitle}`);
        expect(showNotification).not.toHaveBeenCalled();
        expect(await history.listEntries("story", "scene")).toHaveLength(0);
    });

    it("reports a missing scene without claiming that it was unchanged", async () => {
        render(<SceneHistoryPanel />);
        await screen.findByText(words.noEntries);
        scene = undefined;
        fireEvent.click(screen.getByRole("button", { name: words.saveNow }));
        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(assets.textEditor.actionFailed, "error"));
        expect(showSticky).not.toHaveBeenCalled();
    });

    it("reports an unreported write refusal from the panel", async () => {
        render(<SceneHistoryPanel />);
        await screen.findByText(words.noEntries);
        vi.spyOn(fs, "writeFileNoFollowOrCreate").mockResolvedValue({ ok: true, data: undefined, refused: true });
        fireEvent.click(screen.getByRole("button", { name: words.saveNow }));
        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(assets.textEditor.actionFailed, "error"));
        expect(showSticky).not.toHaveBeenCalled();
    });

    it("handles a save request when the history index cannot be read", async () => {
        files.set(indexPath, "{}");
        failRead = true;
        vi.spyOn(console, "warn").mockImplementation(() => {});
        render(<SceneHistoryPanel />);
        await screen.findByText(`Could not read the ${words.panelTitle}`);
        const save = screen.getByRole("button", { name: words.saveNow });
        fireEvent.click(save);
        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(assets.textEditor.actionFailed, "error"));
        expect(save.matches(":disabled")).toBe(false);
        expect(files.get(indexPath)).toBe("{}");
        expect(showSticky).not.toHaveBeenCalled();
    });

    it("does not duplicate a failed safety snapshot notice during scene restore", async () => {
        await savePreviousAndEdit();
        render(<SceneHistoryPanel />);
        const restore = await screen.findByRole("button", { name: words.restore });
        failWrite = "entry";
        fireEvent.click(restore);
        await waitFor(() => expect(showSticky).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(restore.matches(":disabled")).toBe(false));
        expect(showNotification).not.toHaveBeenCalled();
        expect(commit).not.toHaveBeenCalled();
        expect(scene?.blocks.a).toEqual(row("current"));
    });

    it("keeps an entry visible when deleting it cannot update the index", async () => {
        await savePreviousAndEdit();
        render(<SceneHistoryPanel />);
        const remove = await screen.findByRole("button", { name: words.delete });
        failWrite = "index";
        fireEvent.click(remove);
        await waitFor(() => expect(showSticky).toHaveBeenCalledTimes(1));
        expect(screen.getByText(words.kindManual)).toBeTruthy();
        expect(await history.listEntries("story", "scene")).toHaveLength(1);
        expect(showNotification).not.toHaveBeenCalled();
    });

    it("leaves the row intact and lets save status report a failed safety snapshot", async () => {
        await savePreviousAndEdit();
        renderRowHistory();
        const restore = await screen.findByRole("button", { name: words.rowRestore });
        failWrite = "entry";
        fireEvent.click(restore);
        await waitFor(() => expect(showSticky).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(restore.matches(":disabled")).toBe(false));
        expect(scene?.blocks.a).toEqual(row("current"));
        expect(commit).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
        expect(showNotification).not.toHaveBeenCalled();
    });

    it("reports an actually removed row without restoring it", async () => {
        await savePreviousAndEdit();
        renderRowHistory();
        const restore = await screen.findByRole("button", { name: words.rowRestore });
        scene = { ...scene!, rootBlockIds: [], blocks: {} };
        revision += 1;
        fireEvent.click(restore);
        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(words.rowGone, "warning"));
        expect(commit).not.toHaveBeenCalled();
        expect(showSticky).not.toHaveBeenCalled();
    });

    it("restores the row and closes the modal on success", async () => {
        await savePreviousAndEdit();
        renderRowHistory();
        fireEvent.click(await screen.findByRole("button", { name: words.rowRestore }));
        await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
        expect(scene?.blocks.a).toEqual(row("previous"));
        expect(commit).toHaveBeenCalledOnce();
        expect(showNotification).not.toHaveBeenCalled();
        expect(showSticky).not.toHaveBeenCalled();
    });

    it("reports a freeze that arrives before restoration without a false row-deleted notice", async () => {
        await savePreviousAndEdit();
        renderRowHistory();
        const restore = await screen.findByRole("button", { name: words.rowRestore });
        freezeProjectWrites({ projectPath, reason: { kind: "manual" } });
        fireEvent.click(restore);
        await waitFor(() => expect(showNotification).toHaveBeenCalledWith(assets.textEditor.actionFailed, "error"));
        expect(commit).not.toHaveBeenCalled();
        expect(showSticky).not.toHaveBeenCalled();
    });

    it("ends panel loading and displays an unreadable history message", async () => {
        files.set(indexPath, "{}");
        failRead = true;
        vi.spyOn(console, "warn").mockImplementation(() => {});
        render(<SceneHistoryPanel />);
        await screen.findByText(`Could not read the ${words.panelTitle}`);
        expect(screen.queryByText(words.loading)).toBeNull();
        expect(screen.queryByText(words.noEntries)).toBeNull();
        expect(showNotification).not.toHaveBeenCalled();
    });

    it("ends row history loading and displays an unreadable history message", async () => {
        files.set(indexPath, "{}");
        failRead = true;
        vi.spyOn(console, "warn").mockImplementation(() => {});
        renderRowHistory();
        await screen.findByText(`Could not read the ${words.panelTitle}`);
        expect(screen.queryByText(words.loading)).toBeNull();
        expect(screen.queryByText(words.noVersions)).toBeNull();
        expect(showNotification).not.toHaveBeenCalled();
    });

    it("clears the old scene's history while the next scene is loading", async () => {
        await history.createManualSnapshot("story", "scene");
        const view = render(<SceneHistoryPanel />);
        await screen.findByText(words.kindManual);
        let finish: ((value: FsRequestResult<boolean>) => void) | undefined;
        vi.spyOn(fs, "isFileExists").mockImplementation(path => path.includes("/other/")
            ? new Promise(resolve => { finish = resolve; })
            : Promise.resolve({ ok: true, data: files.has(path) }));
        focusedScene = "other";
        view.rerender(<SceneHistoryPanel />);
        await waitFor(() => expect(finish).toBeDefined());
        expect(screen.queryByText(words.kindManual)).toBeNull();
        expect(screen.getByText(words.loading)).toBeTruthy();
        finish!({ ok: true, data: false });
        await screen.findByText(words.noEntries);
    });

    it("keeps a newer history read when an older request settles last", async () => {
        let finish: ((value: Awaited<ReturnType<SceneHistoryService["listEntries"]>>) => void) | undefined;
        const original = history.listEntries.bind(history);
        vi.spyOn(history, "listEntries")
            .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
            .mockImplementation(original);
        render(<SceneHistoryPanel />);
        await waitFor(() => expect(finish).toBeDefined());
        await history.createManualSnapshot("story", "scene");
        await screen.findByText(words.kindManual);
        await act(async () => finish!([]));
        expect(screen.getByText(words.kindManual)).toBeTruthy();
        expect(screen.queryByText(words.noEntries)).toBeNull();
    });
});
