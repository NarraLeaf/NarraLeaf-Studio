import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryScene } from "@shared/types/story";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { freezeProjectWrites, holdProjectWritesForReload, thawProjectWrites } from "@/lib/app/writeFreeze";
import { DebouncedSaver } from "../../autosave/DebouncedSaver";
import { SaveStatusService } from "../../autosave/SaveStatusService";
import { storeWrite } from "../../autosave/writeReport";
import { FileSystemService } from "../../core/FileSystem";
import { Services, type WorkspaceContext } from "../../services";
import { NotificationService } from "../../ui/NotificationService";
import { UIStore } from "../../ui/UIStore";
import { SceneHistoryScheduler, SceneHistoryService } from "./SceneHistoryService";

type Notice = { message: string; detail: string; actions?: unknown[] };
const projectPath = "/project";
const entryPath = (id: string) => `${projectPath}/.nlstudio/scene-history/story/scene/${id}.json`;

async function mount(options: { realNotifications?: boolean } = {}) {
    const files = new Map<string, string>();
    const writes: string[] = [];
    let fail: "entry" | "index" | null = null;
    let failureCode: FsRejectErrorCode = FsRejectErrorCode.IO_ERROR;
    let loaded = true;
    let exists = true;
    let sceneExists = true;
    let enabled = true;
    let interval = 1;
    let scene: StoryScene = {
        id: "scene", name: "Scene", runtimeName: "scene", rootBlockIds: [], blocks: {},
    } as StoryScene;
    let documentChanged: ((event: { storyId: string; document: { scenes: Record<string, StoryScene> } }) => void) | undefined;
    let libraryChanged: ((index: { stories: { id: string }[] }) => void) | undefined;
    const settingsListeners = new Map<string, (value: unknown) => void>();
    let blocked: { kind: "entry" | "index"; started: () => void; wait: Promise<void> } | undefined;
    let nextId = 0;
    const fs = new FileSystemService();
    vi.spyOn(fs, "isFileExists").mockImplementation(async path => ({ ok: true, data: files.has(path) }));
    vi.spyOn(fs, "isDirExists").mockResolvedValue({ ok: true, data: true });
    vi.spyOn(fs, "readJSON").mockImplementation(async <T,>(path: string): Promise<FsRequestResult<T>> => ({
        ok: true, data: JSON.parse(files.get(path)!) as T,
    }));
    vi.spyOn(fs, "deleteFile").mockImplementation(async path => {
        files.delete(path);
        return { ok: true, data: undefined };
    });
    vi.spyOn(appPrivilegedFacade.fs, "writeFileNoFollowOrCreate").mockImplementation(async (path, data) => {
        writes.push(path);
        const kind = path.endsWith("/index.json") ? "index" : "entry";
        if (blocked?.kind === kind) {
            const pending = blocked;
            blocked = undefined;
            pending.started();
            await pending.wait;
        }
        if (fail === kind) {
            return { success: true, data: { ok: false, error: { code: failureCode, message: "I/O error" } } };
        }
        files.set(path, data);
        return { success: true, data: { ok: true, data: undefined } };
    });
    const notifications = options.realNotifications ? new NotificationService(new UIStore()) : null;
    const showSticky = notifications
        ? vi.spyOn(notifications, "showSticky")
        : vi.fn((_notice: Notice) => `toast-${showSticky.mock.calls.length}`);
    const close = notifications ? vi.spyOn(notifications, "close") : vi.fn();
    const log = vi.fn();
    const scenes = (): Record<string, StoryScene> => sceneExists ? { scene } : {};
    const story = {
        getLoadedStoryDocument: () => loaded && exists ? { scenes: scenes() } : undefined,
        getLibraryIndex: () => ({ stories: exists ? [{ id: "story" }] : [] }),
        onDocumentChanged: (listener: typeof documentChanged) => { documentChanged = listener; return () => { documentChanged = undefined; }; },
        onLibraryChanged: (listener: typeof libraryChanged) => { libraryChanged = listener; return () => { libraryChanged = undefined; }; },
    };
    const history = new SceneHistoryService();
    const saveStatus = new SaveStatusService();
    const settings = {
        getSync: (key: string, fallback: unknown) => key === "story.autoSnapshot.intervalMinutes" ? interval
            : key === "story.autoSnapshot.enabled" ? enabled : fallback,
        onChange: (key: string, listener: (value: unknown) => void) => {
            settingsListeners.set(key, listener);
            return () => { settingsListeners.delete(key); };
        },
    };
    const context = (root: string) => ({
        project: { resolve: (...parts: string[]) => [root, ...parts].join("/") },
        services: { get(id: Services) {
            switch (id) {
                case Services.Story: return story;
                case Services.FileSystem: return fs;
                case Services.SceneHistory: return history;
                case Services.SaveStatus: return saveStatus;
                case Services.Uuid: return { generate: () => `entry-${++nextId}` };
                case Services.GlobalSettings: return settings;
                case Services.UI: return { notifications: notifications ?? { showSticky, close } };
                case Services.Console: return { log };
                default: throw new Error(`Unexpected service ${id}`);
            }
        } },
    }) as unknown as WorkspaceContext;
    const ctx = context(projectPath);
    await saveStatus.initialize(ctx, async () => {});
    await history.initialize(ctx, async () => {});
    history.activate(ctx);
    const scheduler = (history as unknown as { scheduler: SceneHistoryScheduler }).scheduler;
    return {
        history, saveStatus, fs, files, writes, showSticky, close, log, context, notifications,
        fail: (kind: typeof fail, code: FsRejectErrorCode = FsRejectErrorCode.IO_ERROR) => { fail = kind; failureCode = code; },
        edit: () => { scene = { ...scene, name: `${scene.name}!` }; documentChanged?.({ storyId: "story", document: { scenes: scenes() } }); },
        setLoaded: (value: boolean) => { loaded = value; },
        deleteScene: () => { sceneExists = false; documentChanged?.({ storyId: "story", document: { scenes: scenes() } }); },
        deleteStory: () => { exists = false; libraryChanged?.({ stories: [] }); },
        setEnabled: (value: boolean) => { enabled = value; settingsListeners.get("story.autoSnapshot.enabled")?.(value); },
        setInterval: (value: number) => { interval = value; settingsListeners.get("story.autoSnapshot.intervalMinutes")?.(value); },
        block: (kind: "entry" | "index") => {
            let markStarted!: () => void;
            let release!: () => void;
            const started = new Promise<void>(resolve => { markStarted = resolve; });
            const wait = new Promise<void>(resolve => { release = resolve; });
            blocked = { kind, started: markStarted, wait };
            return { started, release };
        },
        tick: async () => { vi.setSystemTime(Date.now() + 60_000); await scheduler.tick(); },
    };
}

describe("automatic scene history failure feedback", () => {
    let mounted: Awaited<ReturnType<typeof mount>> | undefined;
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-11-14T00:00:00Z"));
        vi.spyOn(console, "warn").mockImplementation(() => {});
    });
    afterEach(async () => {
        await mounted?.history.dispose();
        mounted?.saveStatus.dispose();
        mounted = undefined;
        thawProjectWrites();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("says a scheduled failure is retried in the background without an ineffective retry button", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        await h.tick();

        expect(h.showSticky).toHaveBeenCalledTimes(1);
        expect(h.showSticky.mock.calls[0][0]).toMatchObject({
            message: "Could not save the Scene History",
            detail: "Still retrying in the background.",
        });
        expect(h.showSticky.mock.calls[0][0].actions).toBeUndefined();
    });

    it("states both the cause and background retry for a persistent write failure", async () => {
        const h = mounted = await mount();
        h.fail("entry", FsRejectErrorCode.PERMISSION_DENIED);
        h.edit();
        await h.tick();
        expect(h.showSticky.mock.calls[0][0].detail).toBe(
            "The file is read-only, or Studio is not allowed to write to it. Still retrying in the background.",
        );
        expect(h.showSticky.mock.calls[0][0].actions).toBeUndefined();
    });

    it("clears the old entry failure after a scheduled retry writes a different path", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        await h.tick();
        expect(h.writes).toEqual([entryPath("entry-1")]);
        h.fail(null);
        h.edit();
        await h.tick();

        expect(h.writes).toContain(entryPath("entry-2"));
        expect(h.files.has(entryPath("entry-2"))).toBe(true);
        expect(h.close).toHaveBeenCalledWith("toast-1");
    });

    it("keeps direct automatic writes separate from scheduled retries", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        await expect(h.history.runAutoSnapshotNow(["story"])).rejects.toThrow();
        expect(h.showSticky.mock.calls[0][0].message).toBe("Could not save the Scene History");
        expect(h.showSticky.mock.calls[0][0].detail).toBe("The change was not saved.");
        expect(h.showSticky.mock.calls[0][0].actions).toBeUndefined();
    });

    it("closes the live notice after recovery and preserves the notification centre's historical record", async () => {
        const h = mounted = await mount({ realNotifications: true });
        h.fail("entry");
        h.edit();
        await h.tick();
        expect(h.notifications!.getAll()).toHaveLength(1);
        h.fail(null);
        await h.tick();
        expect(h.notifications!.getAll()).toHaveLength(0);
        expect(h.notifications!.getHistory()).toMatchObject([{ detail: "Still retrying in the background.", read: false }]);
    });

    it("closes a cancelled notice while the notification centre keeps its historical record", async () => {
        const h = mounted = await mount({ realNotifications: true });
        h.fail("entry");
        h.edit();
        await h.tick();
        h.setEnabled(false);
        expect(h.notifications!.getAll()).toHaveLength(0);
        expect(h.notifications!.getHistory()).toMatchObject([{ detail: "Still retrying in the background.", read: false }]);
    });

    it("keeps one notice through index and entry failures until the whole snapshot succeeds", async () => {
        const h = mounted = await mount();
        h.fail("index");
        h.edit();
        await h.tick();
        expect(h.showSticky).toHaveBeenCalledTimes(1);
        h.fail("entry");
        await h.tick();
        expect(h.showSticky).toHaveBeenCalledTimes(1);
        expect(h.close).not.toHaveBeenCalled();
        h.fail(null);
        await h.tick();
        expect(h.close).toHaveBeenCalledOnce();
        expect(h.files.has(entryPath("entry-3"))).toBe(true);
        const index = JSON.parse(h.files.get(entryPath("index"))!);
        expect(index.entries.map((entry: { id: string }) => entry.id)).toEqual(["entry-3"]);
        expect(h.log.mock.calls.filter(call => call[1] === "error").map(call => call[2])).toEqual([
            expect.stringContaining(entryPath("index")), expect.stringContaining(entryPath("entry-2")),
        ]);
    });

    it("keeps a manual index failure separate when a background index later succeeds", async () => {
        const h = mounted = await mount();
        h.fail("index");
        h.edit();
        await h.tick();
        expect((await h.history.createManualSnapshot("story", "scene")).status).toBe("save-reported");
        expect(h.showSticky).toHaveBeenCalledTimes(2);
        expect(h.showSticky.mock.calls[0][0].detail).toContain("retrying");
        expect(h.showSticky.mock.calls[1][0].detail).toBe("The change was not saved.");
        h.fail(null);
        await h.tick();
        expect(h.close.mock.calls.map(call => call[0])).toEqual(["toast-1"]);
        expect(h.saveStatus.getFailures()).toHaveLength(0);
        expect(h.saveStatus.getStatus()).toBe("clean");
    });

    it("settles a scheduled failure when a manual snapshot has already captured the same scene", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        await h.tick();
        h.fail(null);
        expect((await h.history.createManualSnapshot("story", "scene")).status).toBe("ok");
        const writes = [...h.writes];
        await h.tick();
        expect(h.writes).toEqual(writes);
        expect(h.close).toHaveBeenCalledWith("toast-1");
        expect(h.log.mock.calls.some(call => call[1] === "success")).toBe(false);
    });

    it("retains the retry while a story is temporarily unloaded", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        await h.tick();
        h.setLoaded(false);
        h.fail(null);
        await h.tick();
        expect(h.close).not.toHaveBeenCalled();
        expect(h.writes).toHaveLength(1);
        h.setLoaded(true);
        await h.tick();
        expect(h.close).toHaveBeenCalledWith("toast-1");
    });

    it.each(["scene", "story"] as const)("cancels the retry when its %s is deleted", async kind => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        await h.tick();
        if (kind === "scene") h.deleteScene(); else h.deleteStory();
        expect(h.close).toHaveBeenCalledWith("toast-1");
        expect(h.log.mock.calls.some(call => call[1] === "success")).toBe(false);
        await h.tick();
        expect(h.writes).toHaveLength(1);
    });

    it.each(["disabled", "invalid interval"] as const)("closes the background notice when snapshots are %s", async kind => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        await h.tick();
        if (kind === "disabled") h.setEnabled(false); else h.setInterval(0);
        expect(h.close).toHaveBeenCalledWith("toast-1");
        expect(h.log.mock.calls.some(call => call[1] === "success")).toBe(false);
        await h.tick();
        expect(h.writes).toHaveLength(1);
        h.fail(null);
        if (kind === "disabled") h.setEnabled(true); else h.setInterval(1);
        await h.tick();
        expect(h.files.has(entryPath("entry-2"))).toBe(true);
    });

    it("retains debt when the workspace freezes during an entry write", async () => {
        const h = mounted = await mount();
        h.edit();
        const block = h.block("entry");
        const ticking = h.tick();
        await block.started;
        freezeProjectWrites({ projectPath, reason: { kind: "manual" } });
        block.release();
        await ticking;
        expect(h.writes).toEqual([entryPath("entry-1")]);
        expect(h.files.has(entryPath("index"))).toBe(false);
        thawProjectWrites();
        await h.tick();
        expect(h.files.has(entryPath("entry-2"))).toBe(true);
        expect(h.files.has(entryPath("index"))).toBe(true);
    });

    it("keeps a failed snapshot pending while frozen and retries after thaw", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        await h.tick();
        freezeProjectWrites({ projectPath, reason: { kind: "manual" } });
        h.fail(null);
        await h.tick();
        expect(h.writes).toHaveLength(1);
        expect(h.close).toHaveBeenCalledWith("toast-1");
        expect(h.log.mock.calls.some(call => call[1] === "success")).toBe(false);
        thawProjectWrites();
        await h.tick();
        expect(h.files.has(entryPath("entry-2"))).toBe(true);
    });

    it("leaves a scheduled snapshot notice intact when the global savers are retried", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        await h.tick();
        await h.saveStatus.retryNow();
        expect(h.close).not.toHaveBeenCalled();
        expect(h.writes).toHaveLength(1);
        h.fail(null);
        await h.tick();
        expect(h.close).toHaveBeenCalledWith("toast-1");
    });

    it("ignores an in-flight failure after snapshots are disabled", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        const block = h.block("entry");
        const ticking = h.tick();
        await block.started;
        h.setEnabled(false);
        block.release();
        await ticking;
        expect(h.showSticky).not.toHaveBeenCalled();
        h.fail(null);
        h.setEnabled(true);
        await h.tick();
        expect(h.files.has(entryPath("entry-2"))).toBe(true);
    });

    it("ignores a late failed write after its scene has been deleted", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        const block = h.block("entry");
        const ticking = h.tick();
        await block.started;
        h.deleteScene();
        block.release();
        await ticking;
        expect(h.showSticky).not.toHaveBeenCalled();
        expect(h.log.mock.calls.some(call => call[1] === "success")).toBe(false);
    });

    it.each(["entry", "index"] as const)("waits for an in-flight %s write before reload and cancels its notice", async kind => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        await h.tick();
        if (kind === "index") h.fail(null);
        const block = h.block(kind);
        const ticking = h.tick();
        await block.started;
        const releaseHold = holdProjectWritesForReload(projectPath);
        let reloaded = false;
        const reload = h.saveStatus.prepareForReload().then(() => { reloaded = true; });
        await Promise.resolve();
        expect(reloaded).toBe(false);
        expect(h.close).toHaveBeenCalledWith("toast-1");
        block.release();
        await Promise.all([ticking, reload]);
        releaseHold();
        expect(reloaded).toBe(true);
        expect(h.showSticky).toHaveBeenCalledTimes(1);
        expect(h.log.mock.calls.some(call => call[1] === "success")).toBe(false);
        const writesAfterReload = h.writes.length;
        await h.tick();
        expect(h.writes).toHaveLength(writesAfterReload);
    });

    it("does not report an old project's late failure into the new project", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        h.edit();
        const block = h.block("entry");
        const ticking = h.tick();
        await block.started;
        const next = h.context("/next-project");
        const switching = h.history.initialize(next, async () => {});
        await h.saveStatus.initialize(next, async () => {});
        block.release();
        await Promise.all([ticking, switching]);
        expect(h.showSticky).not.toHaveBeenCalled();
        expect(h.saveStatus.getFailures()).toHaveLength(0);
        expect(h.writes).toEqual([entryPath("entry-1")]);
    });

    it("preserves retryNow after a normal debounced saver abandons a failed write for reload", async () => {
        const h = mounted = await mount();
        h.fail("entry");
        const path = `${projectPath}/normal.json`;
        const saver = new DebouncedSaver({
            delayMs: 10, maxWaitMs: 100,
            save: async () => {
                const result = await h.fs.writeFileNoFollowOrCreate(path, "{}", "utf-8", storeWrite("workspace.shell.save.stores.story", "retried"));
                if (!result.ok) throw new Error("write failed");
            },
        });
        h.saveStatus.register("normal", "workspace.shell.save.stores.story", saver);
        saver.schedule();
        await expect(saver.flush()).rejects.toThrow("write failed");
        expect(h.saveStatus.getFailures()).toHaveLength(1);
        await h.saveStatus.prepareForReload();
        await h.saveStatus.retryNow();
        expect(h.saveStatus.getFailures()).toHaveLength(0);
        expect(h.log.mock.calls.some(call => call[1] === "success")).toBe(false);
    });

    it("requeues a scheduler run that throws synchronously", async () => {
        const run = vi.fn().mockImplementationOnce(() => { throw new Error("failed"); }).mockResolvedValue(undefined);
        const scheduler = new SceneHistoryScheduler({
            enabled: () => true, intervalMinutes: () => 1, isFrozen: () => false, run,
        });
        scheduler.noteChange("story");
        vi.setSystemTime(Date.now() + 60_000);
        await scheduler.tick();
        vi.setSystemTime(Date.now() + 60_000);
        await scheduler.tick();
        expect(run).toHaveBeenCalledTimes(2);
        expect(run).toHaveBeenLastCalledWith(["story"]);
    });

    it("does not start a scheduler run cancelled before its task begins", async () => {
        const run = vi.fn().mockResolvedValue(undefined);
        const scheduler = new SceneHistoryScheduler({
            enabled: () => true, intervalMinutes: () => 1, isFrozen: () => false, run,
        });
        scheduler.noteChange("story");
        vi.setSystemTime(Date.now() + 60_000);
        const ticking = scheduler.tick();
        scheduler.stop();
        await ticking;
        expect(run).not.toHaveBeenCalled();
    });
});
