/**
 * Scene content history: automatic snapshots on a timer, manual ones on request, and the reads that
 * the history panel and "view this row's history" are built from.
 *
 * Storage is `.nlstudio/scene-history/<storyId>/<sceneId>/` - an `index.json` of entry metadata and
 * one `<entryId>.json` per snapshot holding the scene. Under `.nlstudio/` because that prefix is
 * excluded from version control and packaging, and NOT under `editor/cache/`: deleting a snapshot
 * loses work, so by `docs/caches.md` it is product data, not a cache.
 *
 * Cost discipline (memory: story-typing-cost): nothing here runs per keystroke. A document change
 * only adds the story id to a set. The timer beat (every 30 s) is a clock check; only once the
 * interval has passed are the touched stories' scenes serialized - one scene per macrotask, so a
 * large story never becomes one long task - and only scenes whose hash differs from their last
 * snapshot are written. Writes are async IPC and never block the editor.
 *
 * Comments in English per convention.
 */

import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { translate } from "@/lib/i18n";
import type { StoryBlock, StoryDocument, StoryBlockId, StoryId, StoryScene, StorySceneId } from "@shared/types/story";
import type { VcsHistoryEntry } from "@shared/types/vcs";
import { Service } from "../../Service";
import { Services, type WorkspaceContext } from "../../services";
import type { GlobalSettingsService } from "../../GlobalSettingsService";
import type { FileSystemService } from "../../core/FileSystem";
import type { UuidService } from "../../core/UuidService";
import type { StoryService } from "../StoryService";
import type { VersionControlService } from "../../core/VersionControlService";
import { EventEmitter } from "../../ui/EventEmitter";
import {
    applyRetention,
    DEFAULT_RETENTION_POLICY,
    extractRowVersions,
    hashString,
    sceneWithRowRestored,
    type RowHistoryInput,
    type RowVersion,
    type SceneHistoryEntryMeta,
    type SceneHistoryIndex,
    type SceneHistoryKind,
} from "./sceneHistoryModel";

export const AUTO_SNAPSHOT_ENABLED_SETTING = "story.autoSnapshot.enabled";
export const AUTO_SNAPSHOT_INTERVAL_SETTING = "story.autoSnapshot.intervalMinutes";
export const AUTO_SNAPSHOT_KEEP_SETTING = "story.autoSnapshot.keepRecent";
export const AUTO_SNAPSHOT_DEFAULT_ENABLED = true;
export const AUTO_SNAPSHOT_DEFAULT_INTERVAL_MINUTES = 10;
export const AUTO_SNAPSHOT_DEFAULT_KEEP = DEFAULT_RETENTION_POLICY.keepRecent;

/** How often the timer checks the clock. Independent of the interval so a changed setting applies on the next beat. */
const HEARTBEAT_MS = 30_000;
/** How many past revisions "view this row's history" reads from version control at most. */
export const ROW_HISTORY_REVISION_LIMIT = 10;

type SceneHistoryEvents = {
    changed: { storyId: StoryId; sceneId: StorySceneId };
};

export type SceneHistorySchedulerDeps = {
    enabled: () => boolean;
    intervalMinutes: () => number;
    isFrozen: () => boolean;
    /** Snapshot every touched story; resolves when done. */
    run: (storyIds: StoryId[]) => Promise<void>;
    now?: () => number;
    heartbeat?: (beat: () => void, periodMs: number) => () => void;
    onError?: (error: unknown) => void;
};

/**
 * When an automatic snapshot is due. Same shape as the checkpoint scheduler: the interval is a
 * floor measured from the first unrecorded change, so an author who edits once and stops gets one
 * snapshot, not one every interval forever.
 */
export class SceneHistoryScheduler {
    private readonly now: () => number;
    private readonly heartbeat: (beat: () => void, periodMs: number) => () => void;
    private stopBeating: (() => void) | null = null;
    private dirtySince: number | null = null;
    private readonly touched = new Set<StoryId>();
    private running = false;

    constructor(private readonly deps: SceneHistorySchedulerDeps) {
        this.now = deps.now ?? (() => Date.now());
        this.heartbeat = deps.heartbeat ?? ((beat, periodMs) => {
            const timer = setInterval(beat, periodMs);
            return () => clearInterval(timer);
        });
    }

    public start(): void {
        if (this.stopBeating) return;
        this.stopBeating = this.heartbeat(() => void this.tick(), HEARTBEAT_MS);
    }

    public stop(): void {
        this.stopBeating?.();
        this.stopBeating = null;
        this.touched.clear();
        this.dirtySince = null;
    }

    public noteChange(storyId: StoryId): void {
        // A frozen workspace shows a past revision or is mid-reload; what changes there is not the
        // author's work, and a snapshot of it would be a lie in the list.
        if (this.deps.isFrozen()) return;
        this.touched.add(storyId);
        this.dirtySince ??= this.now();
    }

    public async tick(): Promise<void> {
        if (!this.deps.enabled()) return;
        const minutes = this.deps.intervalMinutes();
        if (!Number.isFinite(minutes) || minutes <= 0) return;
        if (this.dirtySince === null || this.running || this.deps.isFrozen()) return;
        if (this.now() - this.dirtySince < minutes * 60_000) return;
        this.running = true;
        const storyIds = [...this.touched];
        this.touched.clear();
        this.dirtySince = null;
        try {
            await this.deps.run(storyIds);
        } catch (error) {
            storyIds.forEach(id => this.touched.add(id));
            this.dirtySince ??= this.now();
            this.deps.onError?.(error);
        } finally {
            this.running = false;
        }
    }
}

const yieldToEditor = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export class SceneHistoryService extends Service<SceneHistoryService> {
    private workspace: WorkspaceContext | null = null;
    private settings: GlobalSettingsService | null = null;
    private scheduler: SceneHistoryScheduler | null = null;
    private stopListening: (() => void) | null = null;
    private readonly events = new EventEmitter<SceneHistoryEvents>();
    /** Parsed indexes by scene key, so the panel and the scheduler do not re-read the disk. */
    private readonly indexes = new Map<string, SceneHistoryIndex>();
    /** One write chain per scene, so an auto snapshot and a manual one never interleave on its index. */
    private readonly chains = new Map<string, Promise<unknown>>();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        this.workspace = ctx;
        const story = ctx.services.get<StoryService>(Services.Story);
        const fs = ctx.services.get<FileSystemService>(Services.FileSystem);
        try {
            const settings = ctx.services.get<GlobalSettingsService>(Services.GlobalSettings);
            await depend([story, fs, settings]);
            this.settings = settings;
        } catch {
            await depend([story, fs]);
            this.settings = null;
        }
        this.scheduler = new SceneHistoryScheduler({
            enabled: () => this.setting<boolean>(AUTO_SNAPSHOT_ENABLED_SETTING, AUTO_SNAPSHOT_DEFAULT_ENABLED) !== false,
            intervalMinutes: () => Number(this.setting(AUTO_SNAPSHOT_INTERVAL_SETTING, AUTO_SNAPSHOT_DEFAULT_INTERVAL_MINUTES)),
            isFrozen: () => getProjectWriteFreeze() !== null,
            run: storyIds => this.snapshotStories(storyIds),
            onError: error => console.warn("[SceneHistory] automatic snapshot failed", error),
        });
    }

    public override activate(ctx: WorkspaceContext): void {
        this.scheduler?.start();
        this.stopListening?.();
        this.stopListening = ctx.services.get<StoryService>(Services.Story)
            .onDocumentChanged(event => this.scheduler?.noteChange(event.storyId));
    }

    public override dispose(): void {
        this.scheduler?.stop();
        this.scheduler = null;
        this.stopListening?.();
        this.stopListening = null;
        this.indexes.clear();
        this.chains.clear();
        this.events.clear();
        this.workspace = null;
    }

    public onChanged(handler: (event: { storyId: StoryId; sceneId: StorySceneId }) => void): () => void {
        return this.events.on("changed", handler);
    }

    /** Entries of one scene, newest first. */
    public async listEntries(storyId: StoryId, sceneId: StorySceneId): Promise<SceneHistoryEntryMeta[]> {
        const index = await this.readIndex(storyId, sceneId);
        return [...index.entries].sort((a, b) => b.createdAt - a.createdAt);
    }

    /** Snapshot the scene as it is in memory now (including edits not yet auto-saved). Null when unchanged since the last one. */
    public createManualSnapshot(storyId: StoryId, sceneId: StorySceneId, label?: string): Promise<SceneHistoryEntryMeta | null> {
        return this.snapshotScene(storyId, sceneId, "manual", label, true);
    }

    public async readSnapshotScene(storyId: StoryId, sceneId: StorySceneId, entryId: string): Promise<StoryScene | null> {
        const result = await this.fs().readJSON<{ scene: StoryScene }>(this.entryPath(storyId, sceneId, entryId));
        return result.ok ? result.data.scene ?? null : null;
    }

    public deleteEntry(storyId: StoryId, sceneId: StorySceneId, entryId: string): Promise<void> {
        return this.chain(storyId, sceneId, async () => {
            const index = await this.readIndex(storyId, sceneId);
            const next = { ...index, entries: index.entries.filter(entry => entry.id !== entryId) };
            await this.writeIndex(storyId, sceneId, next);
            await this.fs().deleteFile(this.entryPath(storyId, sceneId, entryId));
            this.events.emit("changed", { storyId, sceneId });
        });
    }

    /**
     * The distinct versions one row went through across this scene's snapshots and, when asked,
     * the last {@link ROW_HISTORY_REVISION_LIMIT} version-control revisions. Newest first; the
     * current version is not listed.
     */
    public async rowHistory(
        storyId: StoryId,
        sceneId: StorySceneId,
        blockId: StoryBlockId,
        options: { includeRevisions?: boolean } = {},
    ): Promise<{ versions: RowVersion[]; revisionsRead: number; revisionsFailed: boolean }> {
        const current = this.story().getLoadedStoryDocument(storyId)?.scenes[sceneId]?.blocks[blockId] ?? null;
        const inputs: RowHistoryInput[] = [];
        for (const entry of await this.listEntries(storyId, sceneId)) {
            inputs.push({ source: { kind: "snapshot", entry }, at: entry.createdAt, scene: await this.readSnapshotScene(storyId, sceneId, entry.id) });
        }
        let revisionsRead = 0;
        let revisionsFailed = false;
        if (options.includeRevisions) {
            try {
                const vcs = this.workspace!.services.get<VersionControlService>(Services.VersionControl);
                if (await vcs.isRepository()) {
                    const history: VcsHistoryEntry[] = await vcs.getHistory(ROW_HISTORY_REVISION_LIMIT, { includeDetails: true });
                    const path = `editor/story/stories/${storyId}/storydoc.json`;
                    for (const revision of history.slice(0, ROW_HISTORY_REVISION_LIMIT)) {
                        let scene: StoryScene | null = null;
                        try {
                            const bytes = await vcs.readBlob(revision.revision, path);
                            const document = JSON.parse(new TextDecoder().decode(bytes)) as StoryDocument;
                            scene = document.scenes?.[sceneId] ?? null;
                        } catch {
                            scene = null;
                        }
                        revisionsRead += 1;
                        inputs.push({
                            source: { kind: "revision", revision: revision.revision, number: revision.number, message: revision.message },
                            at: revision.timestamp ?? 0,
                            scene,
                        });
                    }
                }
            } catch (error) {
                console.warn("[SceneHistory] could not read version-control revisions", error);
                revisionsFailed = true;
            }
        }
        return { versions: extractRowVersions(blockId, current, inputs), revisionsRead, revisionsFailed };
    }

    /**
     * Put a whole snapshot's rows back, as one undoable step on the scene's own undo stack.
     *
     * The current scene is snapshotted first (a manual "before restoring" entry), so restoring can
     * never lose what the author had - not even what undo alone would not bring back after the
     * editor is reloaded. When the newest snapshot already holds exactly this content, that one is
     * the copy and no duplicate is written. Only the block tree is restored: the scene's name, runtime name, music
     * and variable snapshots are not content a row history speaks about.
     */
    public async restoreSceneSnapshot(storyId: StoryId, sceneId: StorySceneId, entryId: string): Promise<boolean> {
        const snapshot = await this.readSnapshotScene(storyId, sceneId, entryId);
        const current = this.story().getLoadedStoryDocument(storyId)?.scenes[sceneId];
        if (!snapshot || !current) return false;
        await this.snapshotBeforeRestore(storyId, sceneId);
        return this.story().commitSceneReplacement(storyId, sceneId, {
            ...current,
            rootBlockIds: [...snapshot.rootBlockIds],
            blocks: JSON.parse(JSON.stringify(snapshot.blocks)),
        }, { label: { key: "sceneHistory.historyRestoreScene" } });
    }

    /** Set one row's content back to `version`, keeping its place in the tree. One undo step. */
    public async restoreRowVersion(storyId: StoryId, sceneId: StorySceneId, version: StoryBlock): Promise<boolean> {
        const current = this.story().getLoadedStoryDocument(storyId)?.scenes[sceneId];
        if (!current) return false;
        const next = sceneWithRowRestored(current, version);
        if (!next) return false;
        await this.snapshotBeforeRestore(storyId, sceneId);
        return this.story().commitSceneReplacement(storyId, sceneId, next, { label: { key: "sceneHistory.historyRestoreRow" } });
    }

    private async snapshotBeforeRestore(storyId: StoryId, sceneId: StorySceneId): Promise<void> {
        try {
            await this.snapshotScene(storyId, sceneId, "manual", translate("sceneHistory.beforeRestore"));
        } catch (error) {
            console.warn("[SceneHistory] could not snapshot before restoring", error);
        }
    }

    /** Run the scheduler's beat now. For tests and acceptance; the timer calls the same thing. */
    public async runAutoSnapshotNow(storyIds?: StoryId[]): Promise<void> {
        const ids = storyIds ?? this.story().getLibraryIndex().stories.map(entry => entry.id);
        await this.snapshotStories(ids);
    }

    private async snapshotStories(storyIds: StoryId[]): Promise<void> {
        for (const storyId of storyIds) {
            const document = this.story().getLoadedStoryDocument(storyId);
            if (!document) continue;
            for (const sceneId of Object.keys(document.scenes)) {
                if (getProjectWriteFreeze() !== null) return;
                await this.snapshotScene(storyId, sceneId, "auto");
                await yieldToEditor();
            }
        }
    }

    private snapshotScene(
        storyId: StoryId,
        sceneId: StorySceneId,
        kind: SceneHistoryKind,
        label?: string,
        force = false,
    ): Promise<SceneHistoryEntryMeta | null> {
        return this.chain(storyId, sceneId, async () => {
            const scene = this.story().getLoadedStoryDocument(storyId)?.scenes[sceneId];
            if (!scene) return null;
            // Serialized synchronously, so the bytes are the scene at this instant.
            const serialized = JSON.stringify(scene);
            const hash = hashString(serialized);
            const index = await this.readIndex(storyId, sceneId);
            const newest = [...index.entries].sort((a, b) => b.createdAt - a.createdAt)[0];
            if (newest && newest.hash === hash && !force) return null;
            // A scene's very first automatic snapshot is still taken: it is the baseline every
            // later row version is compared against.
            const entry: SceneHistoryEntryMeta = {
                id: this.uuid().generate(true),
                kind,
                createdAt: Date.now(),
                hash,
                blockCount: Object.keys(scene.blocks).length,
                ...(label ? { label } : {}),
            };
            await this.ensureDir(this.sceneDir(storyId, sceneId));
            const wrote = await this.fs().writeFileNoFollowOrCreate(
                this.entryPath(storyId, sceneId, entry.id),
                `{"version":1,"scene":${serialized}}`,
                "utf-8",
            );
            if (!wrote.ok || wrote.refused) return null;
            const keepRecent = Math.max(1, Number(this.setting(AUTO_SNAPSHOT_KEEP_SETTING, AUTO_SNAPSHOT_DEFAULT_KEEP)) || AUTO_SNAPSHOT_DEFAULT_KEEP);
            const { keep, drop } = applyRetention([...index.entries, entry], {
                ...DEFAULT_RETENTION_POLICY,
                keepRecent,
                maxAuto: Math.max(DEFAULT_RETENTION_POLICY.maxAuto, keepRecent + DEFAULT_RETENTION_POLICY.keepDaily),
            });
            await this.writeIndex(storyId, sceneId, { version: 1, entries: keep });
            for (const gone of drop) {
                await this.fs().deleteFile(this.entryPath(storyId, sceneId, gone.id));
            }
            this.events.emit("changed", { storyId, sceneId });
            return entry;
        }) as Promise<SceneHistoryEntryMeta | null>;
    }

    private chain<T>(storyId: StoryId, sceneId: StorySceneId, task: () => Promise<T>): Promise<T> {
        const key = this.key(storyId, sceneId);
        const previous = this.chains.get(key) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(task);
        this.chains.set(key, next);
        return next;
    }

    private async readIndex(storyId: StoryId, sceneId: StorySceneId): Promise<SceneHistoryIndex> {
        const key = this.key(storyId, sceneId);
        const cached = this.indexes.get(key);
        if (cached) return cached;
        const path = this.indexPath(storyId, sceneId);
        const exists = await this.fs().isFileExists(path);
        let index: SceneHistoryIndex = { version: 1, entries: [] };
        if (exists.ok && exists.data) {
            const read = await this.fs().readJSON<SceneHistoryIndex>(path);
            if (read.ok && Array.isArray(read.data?.entries)) index = { version: 1, entries: read.data.entries };
        }
        this.indexes.set(key, index);
        return index;
    }

    private async writeIndex(storyId: StoryId, sceneId: StorySceneId, index: SceneHistoryIndex): Promise<void> {
        this.indexes.set(this.key(storyId, sceneId), index);
        await this.ensureDir(this.sceneDir(storyId, sceneId));
        await this.fs().writeFileNoFollowOrCreate(this.indexPath(storyId, sceneId), JSON.stringify(index), "utf-8");
    }

    private async ensureDir(dir: string): Promise<void> {
        const exists = await this.fs().isDirExists(dir);
        if (exists.ok && !exists.data) await this.fs().createDir(dir);
    }

    private setting<T>(key: string, fallback: T): T {
        return (this.settings?.getSync<T>(key, fallback) ?? fallback) as T;
    }

    private key(storyId: StoryId, sceneId: StorySceneId): string {
        return `${storyId}\u0000${sceneId}`;
    }

    private sceneDir(storyId: StoryId, sceneId: StorySceneId): string {
        return this.workspace!.project.resolve(".nlstudio", "scene-history", safeSegment(storyId), safeSegment(sceneId));
    }

    private indexPath(storyId: StoryId, sceneId: StorySceneId): string {
        return this.workspace!.project.resolve(".nlstudio", "scene-history", safeSegment(storyId), safeSegment(sceneId), "index.json");
    }

    private entryPath(storyId: StoryId, sceneId: StorySceneId, entryId: string): string {
        return this.workspace!.project.resolve(".nlstudio", "scene-history", safeSegment(storyId), safeSegment(sceneId), `${safeSegment(entryId)}.json`);
    }

    private fs(): FileSystemService {
        return this.workspace!.services.get<FileSystemService>(Services.FileSystem);
    }

    private story(): StoryService {
        return this.workspace!.services.get<StoryService>(Services.Story);
    }

    private uuid(): UuidService {
        return this.workspace!.services.get<UuidService>(Services.Uuid);
    }
}

/** Ids are generated, but a path segment is never trusted to be one: no separators, no dot-dot. */
function safeSegment(id: string): string {
    return id.replace(/[^A-Za-z0-9_-]/g, "_");
}
