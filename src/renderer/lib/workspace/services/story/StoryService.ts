import type { TranslationKey } from "@shared/i18n";
import { FsRejectErrorCode, type FsRequestResult } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import {
    StoryAnimationAsset,
    StoryAnimationAssetId,
    StoryAnimationConfig,
    StoryAnimationIndex,
    StoryAnimationIndexEntry,
    StoryAnimationSequence,
    StoryAnimationTimeline,
    StoryBlock,
    StoryBlockId,
    StoryChapter,
    StoryDocument,
    StoryId,
    StoryLibraryEntry,
    StoryLibraryIndex,
    StoryLiteralValue,
    StorySavedVariableDefinition,
    StoryScene,
    StorySceneId,
    StorySceneSnapshot,
    StorySceneUpdate,
    StorySceneVariableDefinition,
    StoryVariableValueType,
    StoryDeclarationBlock,
    StoryDeclarationPayload,
    StoryVariableScope,
} from "@shared/types/story";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IStoryService, Services, WorkspaceContext, type StoryPluginActionRegistration } from "../services";
import { DEFAULT_AUTOSAVE_DELAY_MS, DEFAULT_AUTOSAVE_MAX_WAIT_MS, DebouncedSaver } from "../autosave/DebouncedSaver";
import { registerAutoSaver } from "../autosave/SaveStatusService";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { AssetsService } from "../core/AssetsService";
import { AssetLockReason } from "../assets/AssetLockManager";
import { EventEmitter } from "../ui/EventEmitter";
import { HistoryService } from "../history/HistoryService";
import type { HistoryLabel } from "../history/historyModel";
import { projectHistoryScope } from "../history/historyScopes";
import { reportWorkspaceAnomaly } from "@/lib/workspace/recovery/anomalyLog";
import { findDeclarationBlock } from "@shared/types/story/declarations";
import { listSceneIdsInDocumentOrder } from "@shared/types/story/order";
import { assertValidStoryId } from "@shared/utils/storyId";
import {
    createChapter as createStoryChapterModel,
    createEmptyStoryDocument,
    createEmptyStoryAnimationIndex,
    createEmptyStoryLibraryIndex,
    createScene as createStorySceneModel,
    createStoryAnimationAsset,
    createStoryAnimationIndexEntry,
    createStoryLibraryEntry,
    deleteBlockFromScene,
    insertBlockInScene,
    moveBlockInScene,
    moveBlocksInScene,
    normalizeStoryAnimationAsset,
    normalizeStoryAnimationIndex,
    normalizeStoryDocument,
    normalizeStoryLibraryIndex,
    storyAnimationDocumentRelativePath,
    storyDocumentRelativePath,
    updateBlockPayload,
} from "./storyModel";

type StoryServiceEvents = {
    libraryChanged: StoryLibraryIndex;
    animationsChanged: StoryAnimationIndex;
    documentChanged: { storyId: StoryId; document: StoryDocument };
    dirtyChanged: boolean;
    pluginActionsChanged: StoryPluginActionRegistration[];
};

type BlockTarget = {
    parentId: StoryBlockId | null;
    beforeBlockId?: StoryBlockId | null;
};

/** See {@link StoryService.captureStoryStructure}. */
type StoryStructureSnapshot = {
    chapters: StoryChapter[];
    scenes: Record<StorySceneId, StoryScene>;
    entrySceneId?: StorySceneId;
};

type StoryAssetLockEntry = {
    assetId: string;
    metadata: {
        storyId: StoryId;
        sceneId: StorySceneId;
        blockId: StoryBlockId;
        field: string;
    };
};

/**
 * One scene's asset locks, keyed by `${blockId}:${field}`.
 *
 * The scene id is the outer key rather than part of this one, which is what makes the table
 * splittable: every lock a scene can produce is derived from that scene alone, so recomputing one
 * scene's map can never invalidate another's.
 */
type StorySceneAssetLocks = Map<string, StoryAssetLockEntry>;

/**
 * One story's asset locks, keyed by scene id.
 *
 * Every scene the document has is present, including scenes that reference no asset at all - the
 * empty map is the record that the scene *was* looked at. {@link StoryService.assetLockSceneSetMatches}
 * relies on that: the key set is the document's scene set, so a scene that appeared or vanished
 * outside a declared scope is caught by comparing two sets rather than by walking any blocks.
 */
type StoryAssetLocks = Map<StorySceneId, StorySceneAssetLocks>;

/**
 * Which scenes a document mutation may have changed the asset references of.
 *
 * `"all"` re-derives the whole table and is always correct; an array names the scenes the mutation
 * could have touched and costs one walk per named scene instead of one per scene in the document.
 * The array is read *after* the mutator has run, so a mutator that only discovers its scene while
 * running can be handed a mutable array and push into it.
 *
 * The rule for choosing: name a scene if the mutation reads or writes anything under
 * `document.scenes[...]`, and reach for `"all"` the moment that set is not knowable up front.
 * Naming too many scenes only costs time; naming too few is a wrong lock table, so
 * {@link StoryService.syncDocumentAssetLocks} additionally checks the document's scene set against
 * the table's on every scoped sync and falls back to a full rebuild if they have drifted.
 */
type StoryAssetLockScope = "all" | readonly StorySceneId[];

/**
 * The scope of a mutation that touches no scene: chapter lists, the entry pointer, the story name.
 *
 * Spelled out rather than written as a bare `[]` at each call site so the claim is greppable, and
 * so that the reason it is safe lives in one place: none of these mutations can reach a
 * `defaultBackgroundAssetId` or a block payload, which are the only two things a lock is made of.
 */
const NO_SCENES: readonly StorySceneId[] = [];

export class StoryService extends Service<StoryService> implements IStoryService {
    private index: StoryLibraryIndex | null = null;
    private animationIndex: StoryAnimationIndex | null = null;
    private readonly animationAssets = new Map<StoryAnimationAssetId, StoryAnimationAsset>();
    private readonly documents = new Map<StoryId, StoryDocument>();
    private readonly events = new EventEmitter<StoryServiceEvents>();
    private dirty = false;
    private revision = 0;
    /**
     * What this service still owes the disk, one entry per file rather than one flag for the lot.
     *
     * A save used to rewrite **every** loaded story document, every motion asset and both indexes,
     * whatever had actually changed. Measured on a 300-scene, 25,200-row script that is 15.4 MB on
     * disk: renaming one scene with three chapters open handed 46.2 MB to the filesystem and spent
     * 133 ms of the renderer's own thread inside `JSON.stringify`, every 5 seconds of continuous
     * typing. At 560 scenes it is 92.2 MB and 281 ms.
     *
     * The rule that keeps these sets honest is in {@link writeStoryDocument}: an entry is dropped in
     * the *same synchronous step* that serialises it, never after the await. An edit that lands
     * while the write is in flight therefore re-marks the entry and is written next time, instead of
     * being mistaken for the state that just went out. Every other direction is deliberately
     * conservative - a refused write, a failed write, and a document whose write was never attempted
     * all stay owed.
     */
    private readonly dirtyDocuments = new Set<StoryId>();
    private readonly dirtyAnimationAssets = new Set<StoryAnimationAssetId>();
    /** Absolute directories already known to exist; see {@link ensureDir}. */
    private readonly verifiedDirs = new Set<string>();
    private libraryIndexDirty = false;
    private animationIndexDirty = false;
    private readonly autoSaver = new DebouncedSaver({
        delayMs: DEFAULT_AUTOSAVE_DELAY_MS,
        maxWaitMs: DEFAULT_AUTOSAVE_MAX_WAIT_MS,
        save: () => this.flush(),
        onError: err => console.warn("[StoryService] auto-save failed", err),
    });
    /**
     * storyId -> the locks that story holds, by scene.
     *
     * A story is present here from the moment its locks have been derived once and absent only
     * before that and after {@link releaseStoryAssetLocks} - never because it happened to reference
     * nothing. {@link ensureStoryAssetLocks} reads it that way, and a table that deleted itself when
     * it went empty would make "never derived" and "derived, references nothing" indistinguishable.
     */
    private readonly storyAssetLocks = new Map<StoryId, StoryAssetLocks>();
    private readonly pluginActions = new Map<string, StoryPluginActionRegistration>();
    /**
     * actionId -> the plugin that registered it.
     *
     * Kept beside the registration rather than inside it because the registration is the plugin
     * author's object, and this is the host's own bookkeeping: the dependency scanner needs to say
     * which plugin a `{action:"plugin"}` row belongs to even for an action whose registration has
     * since gone away with an uninstall.
     */
    private readonly pluginActionOwners = new Map<string, string>();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        await depend([filesystemService, projectService, uuidService, assetsService]);
        await registerAutoSaver(ctx, depend, "story", "workspace.shell.save.stores.story", this.autoSaver);

        await this.ensureStoryDirs();
        await this.loadLibrary();
        await this.loadAnimationIndex();
        await this.syncLibraryAssetLocks();
    }

    public listStories(): StoryLibraryEntry[] {
        return [...this.getLibraryIndex().stories];
    }

    public getStoryEntry(storyId: StoryId): StoryLibraryEntry | undefined {
        return this.getLibraryIndex().stories.find(story => story.id === storyId);
    }

    public getDefaultStoryId(): StoryId | undefined {
        return this.getLibraryIndex().defaultStoryId;
    }

    public setDefaultStory(storyId: StoryId | undefined): void {
        if (storyId && !this.getStoryEntry(storyId)) {
            throw new RendererError(`Story not found: ${storyId}`);
        }
        this.mutateLibrary(index => {
            if (storyId) {
                index.defaultStoryId = storyId;
            } else {
                delete index.defaultStoryId;
            }
        });
    }

    public createStory(name: string): StoryLibraryEntry {
        const trimmed = this.cleanName(name, "Untitled Story");
        const now = new Date().toISOString();
        const uuid = this.getUuidService();
        const storyId = this.generateUniqueStoryId();
        const documentPath = storyDocumentRelativePath(storyId);
        const entry = createStoryLibraryEntry({
            id: storyId,
            name: trimmed,
            documentPath,
            now,
        });
        const document = createEmptyStoryDocument({
            id: storyId,
            name: trimmed,
            now,
            generateId: () => uuid.generate(),
        });

        this.documents.set(storyId, document);
        // An empty story locks nothing, so this exists for the *table*, not its contents: from here
        // on every loaded document has one, which is what lets `mutateDocument` treat a table as
        // current rather than as possibly-never-derived, and what lets a read stop at a map lookup.
        this.syncDocumentAssetLocks(storyId, document, "all");
        // Owed before it is attempted. The eager write below is a floating promise whose failure is
        // only logged, and `ensureStoryDocumentDir` can reject before the write is even reached - so
        // without this a new story whose first write did not land would never be written again.
        this.dirtyDocuments.add(storyId);
        void this.ensureStoryDocumentDir(storyId)
            .then(() => this.writeStoryDocument(storyId, document))
            .catch(err => console.warn("[StoryService] failed to persist new story", err));

        this.mutateLibrary(index => {
            index.stories.push(entry);
            if (!index.defaultStoryId) {
                index.defaultStoryId = storyId;
            }
        });

        this.events.emit("documentChanged", { storyId, document });
        return entry;
    }

    public renameStory(storyId: StoryId, name: string): boolean {
        const trimmed = name.trim();
        if (!trimmed) {
            return false;
        }
        const entry = this.getStoryEntry(storyId);
        if (!entry) {
            return false;
        }
        this.mutateLibrary(index => {
            const target = index.stories.find(story => story.id === storyId);
            if (target) {
                target.name = trimmed;
                target.updatedAt = new Date().toISOString();
            }
        });
        const document = this.documents.get(storyId);
        if (document) {
            this.mutateDocument(storyId, doc => {
                doc.name = trimmed;
            }, NO_SCENES);
        }
        return true;
    }

    /**
     * Remove a story: its library entry, its in-memory document, its asset locks, and its directory.
     *
     * Asynchronous because undo needs the document, and the document may only be on disk - a story
     * the author never opened this session is not in {@link documents}. Loading it first is the
     * whole reason this is not a one-liner: after the directory is gone there is nothing left to
     * read, and an undo that restored the library entry but not the file would put a story in the
     * list that cannot be opened.
     */
    public async deleteStory(storyId: StoryId): Promise<boolean> {
        const entry = this.getStoryEntry(storyId);
        if (!entry) {
            return false;
        }
        const document = await this.loadStory(storyId).catch(() => null);
        const index = this.getLibraryIndex();
        const position = index.stories.findIndex(story => story.id === storyId);
        const wasDefault = index.defaultStoryId === storyId;
        const storedEntry = JSON.parse(JSON.stringify(entry)) as StoryLibraryEntry;
        const storedDocument = document
            ? JSON.parse(JSON.stringify(document)) as StoryDocument
            : null;

        this.removeStory(storyId);

        this.getHistoryService().pushCommand(projectHistoryScope(), {
            label: { key: "story.history.deleteStory" as TranslationKey, params: { name: storedEntry.name } },
            undo: async () => {
                if (storedDocument) {
                    this.documents.set(storyId, JSON.parse(JSON.stringify(storedDocument)) as StoryDocument);
                    this.dirtyDocuments.add(storyId);
                    await this.writeStoryDocument(storyId, this.getStoryDocument(storyId));
                    // The story was deleted, so `removeStory` released its table; this restores it
                    // whole from a document that has just come back from a clone.
                    this.syncDocumentAssetLocks(storyId, this.getStoryDocument(storyId), "all");
                }
                this.mutateLibrary(target => {
                    const restored = JSON.parse(JSON.stringify(storedEntry)) as StoryLibraryEntry;
                    if (position >= 0 && position <= target.stories.length) {
                        target.stories.splice(position, 0, restored);
                    } else {
                        target.stories.push(restored);
                    }
                    if (wasDefault) {
                        target.defaultStoryId = storyId;
                    }
                });
                if (storedDocument) {
                    this.events.emit("documentChanged", { storyId, document: this.getStoryDocument(storyId) });
                }
            },
            redo: () => {
                this.removeStory(storyId);
            },
        });
        return true;
    }

    /** The deletion itself, so undo's `redo` and the original call cannot drift apart. */
    private removeStory(storyId: StoryId): void {
        this.releaseStoryAssetLocks(storyId);
        this.documents.delete(storyId);
        // The file is about to go; a debt against it would only outlive the story it belonged to.
        this.dirtyDocuments.delete(storyId);
        this.mutateLibrary(index => {
            index.stories = index.stories.filter(story => story.id !== storyId);
            if (index.defaultStoryId === storyId) {
                delete index.defaultStoryId;
            }
        });
        const dir = this.getStoryDocumentDir(storyId);
        // Its directory is going away, and undo can bring the story back: leaving it memoized would
        // let the restoring write skip the `createDir` that has to happen first.
        this.verifiedDirs.delete(dir);
        void this.getFileSystem().deleteDir(dir).catch(err => {
            console.warn("[StoryService] failed to delete story directory", err);
        });
    }

    public async loadStory(storyId: StoryId): Promise<StoryDocument> {
        assertValidStoryId(storyId);
        const cached = this.documents.get(storyId);
        if (cached) {
            // Not a re-derivation. This used to re-walk the whole document on every read, and this is
            // read from three dozen places - the build, the linter, the search index, every panel that
            // wants a scene name - so a project with thirty thousand rows paid for a full walk to
            // learn nothing. What a read actually has to guarantee is that the story *has* a table,
            // which is a map lookup; keeping it current is `mutateDocument`'s job and it does it as
            // the edit is made.
            this.ensureStoryAssetLocks(storyId, cached);
            return cached;
        }
        const entry = this.getStoryEntry(storyId);
        if (!entry) {
            throw new RendererError(`Story not found: ${storyId}`);
        }
        const fs = this.getFileSystem();
        const path = this.getStoryDocumentPath(storyId);
        const result = await fs.readJSON<StoryDocument>(path);
        if (!result.ok) {
            // Both throws below are re-wrapped as `RendererError`, which keeps the message and drops
            // the fs error code and the parse position with it. Recorded here while the original is
            // still in hand - "unexpected token } at 41273" is what says a write was truncated, and
            // the caller only ever sees "Failed to read story document: Chapter 1".
            reportWorkspaceAnomaly({
                source: "story",
                operationKey: "workspace.recovery.operations.storyDocumentRead",
                path,
                error: result.error,
                severity: "degraded",
            });
            throw new RendererError(result.error.message || `Failed to read story document: ${entry.name}`);
        }
        try {
            const document = normalizeStoryDocument(result.data, new Date().toISOString());
            if (document.id !== storyId) {
                throw new Error(`Story document id mismatch: expected ${storyId}, received ${document.id}`);
            }
            this.documents.set(storyId, document);
            // A first read, or a re-read after `reloadStory`: either way this document has never been
            // walked, and `syncLibraryAssetLocks` may already hold a table derived from the bytes on
            // disk before this read. Full, so the two are diffed rather than stacked.
            this.syncDocumentAssetLocks(storyId, document, "all");
            this.events.emit("documentChanged", { storyId, document });
            return document;
        } catch (error) {
            reportWorkspaceAnomaly({
                source: "story",
                operationKey: "workspace.recovery.operations.storyDocumentParse",
                path,
                error,
                severity: "degraded",
            });
            throw new RendererError(error instanceof Error ? error.message : String(error));
        }
    }

    public getStoryDocument(storyId: StoryId): StoryDocument {
        const document = this.documents.get(storyId);
        if (!document) {
            throw new RendererError(`Story document not loaded: ${storyId}`);
        }
        return document;
    }

    /**
     * Re-derive one story's asset locks from its document as it now stands.
     *
     * The escape hatch for a caller that has edited a loaded document without coming through
     * {@link mutateDocument}. There is exactly one - `promoteTempSpeaker`, which the scene editor runs
     * over the whole document when an author turns a bare speaker name into a character, and which
     * reaches the live blocks because the editor holds a shallow copy of the document. That rewrite
     * happens to carry `voiceAssetId` through untouched, so today it cannot move a lock; the call
     * exists so that the lock table does not depend on that staying true, now that nothing re-walks a
     * document on the author's behalf.
     *
     * A full walk, and no scope to name: a caller that went around this service is in no position to
     * say which scenes it touched. That is the price of going around it, and it is why there is one.
     */
    public resyncAssetLocks(storyId: StoryId): void {
        const document = this.documents.get(storyId);
        if (!document) {
            return;
        }
        this.syncDocumentAssetLocks(storyId, document, "all");
    }

    /**
     * Write one story now, whatever this service thinks it owes.
     *
     * The named document goes out unconditionally - the caller asked for it by name, and a "save
     * this" that decides not to is the one answer nobody wants from it. Everything else is written
     * only if it is owed, and the service is left dirty when any of it still is: this saves *a
     * story*, not the project, and reporting clean over another story's unwritten edits is how those
     * edits get lost at quit time.
     */
    public async saveStory(storyId: StoryId): Promise<void> {
        const document = this.getStoryDocument(storyId);
        await this.writeStoryDocument(storyId, document);
        this.markStoryEntrySaved(storyId, document.meta?.updatedAt);
        if (this.libraryIndexDirty) {
            await this.writeLibraryIndex();
        }
        if (this.animationIndexDirty) {
            await this.writeAnimationIndex();
        }
        for (const [animationId, asset] of this.animationAssets.entries()) {
            if (this.dirtyAnimationAssets.has(animationId)) {
                await this.writeAnimationAsset(asset);
            }
        }
        this.setDirty(this.hasPendingWrites());
    }

    public async flushPendingChanges(): Promise<void> {
        await this.autoSaver.flush();
    }

    public async reloadStory(storyId: StoryId): Promise<StoryDocument> {
        this.documents.delete(storyId);
        return this.loadStory(storyId);
    }

    /**
     * Throw away every story held in memory and read the library back off the disk.
     *
     * A participant of `WorkspaceReloadService`; see it for why this exists at all. The case that
     * forces it: a story or scene created while the workspace was frozen never reached the disk (the
     * write was refused), but this service kept it, and the next successful save wrote it there.
     *
     * Written read-first: the index is re-read before anything is dropped, so an index that cannot
     * be read leaves the workspace showing the stories it already had - stale but coherent, which
     * half a library is not.
     */
    public async reloadFromDisk(): Promise<void> {
        const previouslyLoaded = [...this.documents.keys()];

        // The working tree was replaced under us - a checkout, a merge, a revision view leaving. The
        // paths have not moved, so nothing else would make this service re-ask whether they are
        // still there.
        this.forgetVerifiedDirs();

        await this.loadLibrary();
        await this.loadAnimationIndex();

        this.documents.clear();
        this.animationAssets.clear();
        this.revision = 0;
        this.discardPendingWrites();

        // A story the re-read index no longer lists took its asset locks with it, and nothing else
        // releases them: `syncLibraryAssetLocks` only visits stories the index still names.
        for (const storyId of [...this.storyAssetLocks.keys()]) {
            if (!this.getStoryEntry(storyId)) {
                this.releaseStoryAssetLocks(storyId);
            }
        }

        // Re-open what was open, one document at a time. One that cannot be read is left *not
        // loaded* - the state `getStoryDocument` already reports and `flush` already skips over -
        // rather than half-parsed, and it does not stop the other stories coming back.
        const failures: string[] = [];
        for (const storyId of previouslyLoaded) {
            if (!this.getStoryEntry(storyId)) {
                // Never reached the index on disk, so from here on it does not exist. Its editor tab
                // re-resolves to "scene not found"; see `WorkspaceReloadService`.
                continue;
            }
            try {
                await this.loadStory(storyId);
            } catch (error) {
                failures.push(`${storyId} (${error instanceof Error ? error.message : String(error)})`);
            }
        }

        await this.syncLibraryAssetLocks();

        if (failures.length > 0) {
            throw new RendererError(`Could not re-read ${failures.length} story document(s): ${failures.join("; ")}`);
        }
    }

    public async loadLibrary(): Promise<StoryLibraryIndex> {
        const fs = this.getFileSystem();
        const indexPath = this.getIndexPath();
        const exists = await fs.isFileExists(indexPath);
        if (!exists.ok) {
            throw new RendererError(exists.error.message || "Failed to access story library index");
        }
        if (!exists.data) {
            const created = createEmptyStoryLibraryIndex(new Date().toISOString());
            this.index = created;
            await this.writeLibraryIndex();
            return created;
        }

        const result = await fs.readJSON<StoryLibraryIndex>(indexPath);
        if (!result.ok) {
            if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
                const created = createEmptyStoryLibraryIndex(new Date().toISOString());
                this.index = created;
                await this.writeLibraryIndex();
                return created;
            }
            // Fatal: this runs in `init`, so the throw takes the whole workspace down to the error
            // screen. That screen shows a message and no path, and the path is most of the answer.
            reportWorkspaceAnomaly({
                source: "story",
                operationKey: "workspace.recovery.operations.storyIndexRead",
                path: indexPath,
                error: result.error,
                severity: "fatal",
            });
            throw new RendererError(result.error.message);
        }

        try {
            this.index = normalizeStoryLibraryIndex(result.data, new Date().toISOString());
            this.revision = 0;
            this.discardPendingWrites();
            this.events.emit("libraryChanged", this.index);
            return this.index;
        } catch (error) {
            reportWorkspaceAnomaly({
                source: "story",
                operationKey: "workspace.recovery.operations.storyIndexParse",
                path: indexPath,
                error,
                severity: "fatal",
            });
            throw new RendererError(error instanceof Error ? error.message : String(error));
        }
    }

    public getLibraryIndex(): StoryLibraryIndex {
        if (!this.index) {
            throw new RendererError("Story library not initialized");
        }
        return this.index;
    }

    public onLibraryChanged(handler: (index: StoryLibraryIndex) => void): () => void {
        return this.events.on("libraryChanged", handler);
    }

    public async loadAnimationIndex(): Promise<StoryAnimationIndex> {
        const fs = this.getFileSystem();
        await this.ensureStoryDirs();
        const indexPath = this.getAnimationIndexPath();
        const exists = await fs.isFileExists(indexPath);
        if (!exists.ok) {
            throw new RendererError(exists.error.message || "Failed to access story animation index");
        }
        if (!exists.data) {
            const created = createEmptyStoryAnimationIndex(new Date().toISOString());
            this.animationIndex = created;
            await this.writeAnimationIndex();
            this.events.emit("animationsChanged", created);
            return created;
        }

        const result = await fs.readJSON<StoryAnimationIndex>(indexPath);
        if (!result.ok) {
            if (result.error.code === FsRejectErrorCode.NOT_FOUND) {
                const created = createEmptyStoryAnimationIndex(new Date().toISOString());
                this.animationIndex = created;
                await this.writeAnimationIndex();
                this.events.emit("animationsChanged", created);
                return created;
            }
            throw new RendererError(result.error.message);
        }

        try {
            this.animationIndex = normalizeStoryAnimationIndex(result.data, new Date().toISOString());
            this.events.emit("animationsChanged", this.animationIndex);
            return this.animationIndex;
        } catch (error) {
            throw new RendererError(error instanceof Error ? error.message : String(error));
        }
    }

    public getAnimationIndex(): StoryAnimationIndex {
        if (!this.animationIndex) {
            throw new RendererError("Story animation index not initialized");
        }
        return this.animationIndex;
    }

    public listAnimationAssets(): StoryAnimationIndexEntry[] {
        return [...this.getAnimationIndex().animations];
    }

    public async loadAnimationAsset(animationId: StoryAnimationAssetId): Promise<StoryAnimationAsset> {
        const cached = this.animationAssets.get(animationId);
        if (cached) {
            return cached;
        }
        const entry = this.getAnimationIndex().animations.find(animation => animation.id === animationId);
        if (!entry) {
            throw new RendererError(`Story animation not found: ${animationId}`);
        }
        const result = await this.getFileSystem().readJSON<StoryAnimationAsset>(this.getAnimationAssetPath(animationId));
        if (!result.ok) {
            throw new RendererError(result.error.message || `Failed to read story animation: ${entry.name}`);
        }
        try {
            const asset = normalizeStoryAnimationAsset(result.data, new Date().toISOString());
            this.animationAssets.set(animationId, asset);
            return asset;
        } catch (error) {
            throw new RendererError(error instanceof Error ? error.message : String(error));
        }
    }

    public getLoadedAnimationAsset(animationId: StoryAnimationAssetId): StoryAnimationAsset | undefined {
        return this.animationAssets.get(animationId);
    }

    public async createAnimationAsset(input: {
        name: string;
        targetKind?: StoryAnimationIndexEntry["targetKind"];
        timeline?: StoryAnimationTimeline;
        sequences?: StoryAnimationSequence[];
        config?: StoryAnimationConfig;
    }): Promise<StoryAnimationAsset> {
        const now = new Date().toISOString();
        const animationId = this.generateUniqueAnimationId();
        const targetKind = input.targetKind ?? "image";
        const asset = createStoryAnimationAsset({
            id: animationId,
            name: this.cleanName(input.name, "Untitled Motion"),
            targetKind,
            timeline: input.timeline,
            sequences: input.sequences,
            config: input.config,
            now,
        });
        const entry = createStoryAnimationIndexEntry({
            id: animationId,
            name: asset.name,
            targetKind,
            documentPath: storyAnimationDocumentRelativePath(animationId),
            now,
        });
        this.animationAssets.set(animationId, asset);
        this.dirtyAnimationAssets.add(animationId);
        this.mutateAnimationIndex(index => {
            index.animations.push(entry);
        });
        return asset;
    }

    public updateAnimationAsset(animationId: StoryAnimationAssetId, updater: (asset: StoryAnimationAsset) => StoryAnimationAsset): StoryAnimationAsset {
        const asset = this.animationAssets.get(animationId);
        if (!asset) {
            throw new RendererError(`Story animation not loaded: ${animationId}`);
        }
        const now = new Date().toISOString();
        const next = normalizeStoryAnimationAsset({
            ...updater(JSON.parse(JSON.stringify(asset)) as StoryAnimationAsset),
            id: animationId,
            schemaVersion: asset.schemaVersion,
            meta: {
                ...asset.meta,
                updatedAt: now,
            },
        }, now);
        this.animationAssets.set(animationId, next);
        this.dirtyAnimationAssets.add(animationId);
        this.mutateAnimationIndex(index => {
            const entry = index.animations.find(animation => animation.id === animationId);
            if (entry) {
                entry.name = next.name;
                entry.targetKind = next.targetKind;
                entry.updatedAt = next.meta?.updatedAt ?? now;
            }
        });
        return next;
    }

    /**
     * Remove a motion asset: its index entry, its cached object, and its file.
     *
     * Asynchronous for the same reason {@link deleteStory} is - the timeline is on disk and may not
     * be loaded, and after the file is gone there is nothing to read. Note the motion editor's own
     * undo stack is keyed by this asset's id and dies with it, so this entry is the only way back.
     */
    public async deleteAnimationAsset(animationId: StoryAnimationAssetId): Promise<boolean> {
        const index = this.getAnimationIndex();
        const position = index.animations.findIndex(animation => animation.id === animationId);
        if (position === -1) {
            return false;
        }
        const storedEntry = JSON.parse(JSON.stringify(index.animations[position])) as StoryAnimationIndexEntry;
        const asset = await this.loadAnimationAsset(animationId).catch(() => null);
        const storedAsset = asset ? JSON.parse(JSON.stringify(asset)) as StoryAnimationAsset : null;

        this.removeAnimationAsset(animationId);

        this.getHistoryService().pushCommand(projectHistoryScope(), {
            label: {
                key: "story.history.deleteAnimation" as TranslationKey,
                params: { name: storedEntry.name },
            },
            undo: async () => {
                if (storedAsset) {
                    const restored = JSON.parse(JSON.stringify(storedAsset)) as StoryAnimationAsset;
                    this.animationAssets.set(animationId, restored);
                    this.dirtyAnimationAssets.add(animationId);
                    await this.writeAnimationAsset(restored);
                }
                this.mutateAnimationIndex(target => {
                    const entry = JSON.parse(JSON.stringify(storedEntry)) as StoryAnimationIndexEntry;
                    if (position <= target.animations.length) {
                        target.animations.splice(position, 0, entry);
                    } else {
                        target.animations.push(entry);
                    }
                });
            },
            redo: () => {
                this.removeAnimationAsset(animationId);
            },
        });
        return true;
    }

    private removeAnimationAsset(animationId: StoryAnimationAssetId): void {
        this.animationAssets.delete(animationId);
        this.dirtyAnimationAssets.delete(animationId);
        this.mutateAnimationIndex(target => {
            target.animations = target.animations.filter(animation => animation.id !== animationId);
        });
        void this.getFileSystem().deleteFile(this.getAnimationAssetPath(animationId)).catch(err => {
            console.warn("[StoryService] failed to delete story animation", err);
        });
    }

    public onAnimationsChanged(handler: (index: StoryAnimationIndex) => void): () => void {
        return this.events.on("animationsChanged", handler);
    }

    public registerPluginAction(registration: StoryPluginActionRegistration, ownerPluginId?: string): () => void {
        const actionId = registration.id.trim();
        if (!actionId) {
            throw new RendererError("Plugin action id is required");
        }
        if (this.pluginActions.has(actionId)) {
            throw new RendererError(`Plugin action already registered: ${actionId}`);
        }
        if (typeof registration.createBlock !== "function") {
            // Refuse at registration rather than at insert. Without this the action reaches the
            // palette and fails only when an author picks it - an error in their hands, about a
            // plugin they did not write, at the one moment they were trying to write a line.
            throw new RendererError(`Plugin action must supply createBlock: ${actionId}`);
        }
        const normalized = { ...registration, id: actionId };
        this.pluginActions.set(actionId, normalized);
        if (ownerPluginId) {
            this.pluginActionOwners.set(actionId, ownerPluginId);
        }
        this.emitPluginActionsChanged();
        return () => {
            this.unregisterPluginAction(actionId);
        };
    }

    public unregisterPluginAction(actionId: string): boolean {
        const id = actionId.trim();
        const removed = this.pluginActions.delete(id);
        this.pluginActionOwners.delete(id);
        if (removed) {
            this.emitPluginActionsChanged();
        }
        return removed;
    }

    /** Plugin ids currently contributing at least one story action, for the dependency scanner. */
    public getContributingPluginIds(): string[] {
        return [...new Set(this.pluginActionOwners.values())];
    }

    public getPluginAction(actionId: string): StoryPluginActionRegistration | undefined {
        return this.pluginActions.get(actionId.trim());
    }

    public listPluginActions(): StoryPluginActionRegistration[] {
        return [...this.pluginActions.values()];
    }

    public onPluginActionsChanged(handler: (actions: StoryPluginActionRegistration[]) => void): () => void {
        return this.events.on("pluginActionsChanged", handler);
    }

    public onDocumentChanged(handler: (event: { storyId: StoryId; document: StoryDocument }) => void): () => void {
        return this.events.on("documentChanged", handler);
    }

    public onDirtyChanged(handler: (dirty: boolean) => void): () => void {
        return this.events.on("dirtyChanged", handler);
    }

    public isDirty(): boolean {
        return this.dirty;
    }

    public getRevision(): number {
        return this.revision;
    }

    public createChapter(storyId: StoryId, name: string): StoryChapter {
        const now = new Date().toISOString();
        const chapter = createStoryChapterModel({
            id: this.getUuidService().generate(),
            name: this.cleanName(name, "New Chapter"),
            now,
        });
        this.mutateDocument(storyId, document => {
            document.chapters.push(chapter);
        }, NO_SCENES);
        return chapter;
    }

    public renameChapter(storyId: StoryId, chapterId: string, name: string): boolean {
        const trimmed = name.trim();
        if (!trimmed) {
            return false;
        }
        let changed = false;
        this.mutateDocument(storyId, document => {
            const chapter = document.chapters.find(item => item.id === chapterId);
            if (!chapter) {
                return;
            }
            chapter.name = trimmed;
            chapter.meta = { ...chapter.meta, updatedAt: new Date().toISOString() };
            changed = true;
        }, NO_SCENES);
        return changed;
    }

    /**
     * Remove a chapter **and every scene in it**.
     *
     * Nothing calls this today - the story panel offers no "delete chapter" - but the cascade is
     * the widest of the structural deletions, so it is the one most worth being able to take back
     * if a caller ever appears.
     */
    public deleteChapter(storyId: StoryId, chapterId: string): boolean {
        const before = this.captureStoryStructure(storyId);
        const name = this.getStoryDocument(storyId).chapters.find(c => c.id === chapterId)?.name ?? "";
        let changed = false;
        // Filled by the mutator and read by `mutateDocument` once it returns: which scenes leave with
        // the chapter is not knowable until the chapter has been found.
        const removedSceneIds: StorySceneId[] = [];
        this.mutateDocument(storyId, document => {
            const index = document.chapters.findIndex(chapter => chapter.id === chapterId);
            if (index === -1) {
                return;
            }
            const [chapter] = document.chapters.splice(index, 1);
            chapter.sceneIds.forEach(sceneId => {
                removedSceneIds.push(sceneId);
                delete document.scenes[sceneId];
            });
            if (document.entrySceneId && !document.scenes[document.entrySceneId]) {
                document.entrySceneId = this.firstSceneId(document);
            }
            changed = true;
        }, removedSceneIds);
        if (changed) {
            this.recordStructuralDeletion(storyId, {
                key: "story.history.deleteChapter" as TranslationKey,
                params: { name },
            }, before);
        }
        return changed;
    }

    public moveChapter(storyId: StoryId, chapterId: string, beforeChapterId: string | null): boolean {
        let changed = false;
        this.mutateDocument(storyId, document => {
            const from = document.chapters.findIndex(chapter => chapter.id === chapterId);
            if (from === -1) {
                return;
            }
            const [chapter] = document.chapters.splice(from, 1);
            const to = beforeChapterId
                ? document.chapters.findIndex(item => item.id === beforeChapterId)
                : -1;
            if (to === -1) {
                document.chapters.push(chapter);
            } else {
                document.chapters.splice(to, 0, chapter);
            }
            changed = true;
        }, NO_SCENES);
        return changed;
    }

    public createScene(storyId: StoryId, input: { chapterId?: string; name: string }): StoryScene {
        const now = new Date().toISOString();
        const scene = createStorySceneModel({
            id: this.getUuidService().generate(),
            name: this.cleanName(input.name, "New Scene"),
            runtimeName: this.toRuntimeName(input.name),
            now,
        });
        this.mutateDocument(storyId, document => {
            let chapter = input.chapterId
                ? document.chapters.find(item => item.id === input.chapterId)
                : document.chapters[0];
            if (!chapter) {
                chapter = createStoryChapterModel({
                    id: this.getUuidService().generate(),
                    name: "Chapter 1",
                    now,
                });
                document.chapters.push(chapter);
            }
            document.scenes[scene.id] = scene;
            chapter.sceneIds.push(scene.id);
            if (!document.entrySceneId) {
                document.entrySceneId = scene.id;
            }
        }, [scene.id]);
        return scene;
    }

    public renameScene(storyId: StoryId, sceneId: StorySceneId, name: string): boolean {
        const trimmed = name.trim();
        if (!trimmed) {
            return false;
        }
        let changed = false;
        this.mutateDocument(storyId, document => {
            const scene = document.scenes[sceneId];
            if (!scene) {
                return;
            }
            scene.name = trimmed;
            scene.runtimeName = scene.runtimeName || this.toRuntimeName(trimmed);
            scene.meta = { ...scene.meta, updatedAt: new Date().toISOString() };
            changed = true;
        }, [sceneId]);
        return changed;
    }

    // -----------------------------------------------------------------------
    // Variable declarations (schema v6: a declaration ROW is the variable)
    //
    // These keep the pre-v6 method names so the panel and editor did not have to move, but they are
    // block operations now: creating declares a row at the top of the owning scene, edits mutate the
    // row's payload, and delete removes the row - which IS deleting the variable. Undo rides the
    // ordinary scene history like any other block edit.
    // -----------------------------------------------------------------------

    public createSceneVariable(
        storyId: StoryId,
        sceneId: StorySceneId,
        input: { name: string; valueType: StoryVariableValueType; defaultValue?: StoryLiteralValue },
    ): StorySceneVariableDefinition | null {
        return this.createDeclaration(storyId, sceneId, "scene", input);
    }

    public renameSceneVariable(storyId: StoryId, _sceneId: StorySceneId, variableId: string, name: string): boolean {
        return this.updateDeclaration(storyId, variableId, payload => {
            payload.name = this.cleanName(name, payload.name);
        });
    }

    public retypeSceneVariable(storyId: StoryId, _sceneId: StorySceneId, variableId: string, valueType: StoryVariableValueType): boolean {
        return this.updateDeclaration(storyId, variableId, payload => {
            payload.valueType = valueType;
            payload.defaultValue = undefined;
        });
    }

    public setSceneVariableDefault(storyId: StoryId, _sceneId: StorySceneId, variableId: string, value: StoryLiteralValue): boolean {
        return this.updateDeclaration(storyId, variableId, payload => {
            payload.defaultValue = value;
        });
    }

    public deleteSceneVariable(storyId: StoryId, _sceneId: StorySceneId, variableId: string): boolean {
        return this.deleteDeclaration(storyId, variableId);
    }

    public createSavedVariable(
        storyId: StoryId,
        input: { name: string; valueType: StoryVariableValueType; defaultValue?: StoryLiteralValue },
    ): StorySavedVariableDefinition | null {
        const document = this.getStoryDocument(storyId);
        // Where a saved variable's declaration row lands. Falling back to key order would move a new
        // variable's row into an arbitrary scene once the record is rewritten, so it follows the
        // author's scene order instead.
        const homeSceneId = document.entrySceneId && document.scenes[document.entrySceneId]
            ? document.entrySceneId
            : listSceneIdsInDocumentOrder(document)[0];
        return homeSceneId ? this.createDeclaration(storyId, homeSceneId, "saved", input) : null;
    }

    public renameSavedVariable(storyId: StoryId, variableId: string, name: string): boolean {
        return this.updateDeclaration(storyId, variableId, payload => {
            payload.name = this.cleanName(name, payload.name);
        });
    }

    public retypeSavedVariable(storyId: StoryId, variableId: string, valueType: StoryVariableValueType): boolean {
        return this.updateDeclaration(storyId, variableId, payload => {
            payload.valueType = valueType;
            payload.defaultValue = undefined;
        });
    }

    public setSavedVariableDefault(storyId: StoryId, variableId: string, value: StoryLiteralValue): boolean {
        return this.updateDeclaration(storyId, variableId, payload => {
            payload.defaultValue = value;
        });
    }

    public deleteSavedVariable(storyId: StoryId, variableId: string): boolean {
        return this.deleteDeclaration(storyId, variableId);
    }

    /**
     * Delete a declaration row by id whatever scope it declares - the scope-agnostic name for what
     * `deleteSceneVariable` / `deleteSavedVariable` already do.
     *
     * It exists for the `/save` + `/global` retirement pass (`storyDeclarationMigration`), which
     * removes rows of both project scopes and has no business calling the *saved* method to delete a
     * *persistent* row. The scope-named methods stay because the panels that call them are scoped,
     * and a caller that knows the scope should say so.
     *
     * Rides the ordinary document dirty/autosave path and pushes nothing onto the undo history,
     * which is what the migration needs: an undo step holding a pre-migration document would restore
     * the row while its registry entry stayed, i.e. re-create the duplicate the pass just removed.
     */
    public deleteDeclarationRow(storyId: StoryId, variableId: string): boolean {
        return this.deleteDeclaration(storyId, variableId);
    }

    // -----------------------------------------------------------------------
    // Scene Snapshots (变量快照): named per-scene sets of variable override values, used to launch a
    // row-precise Dev Mode preview under conditions the editor cannot analyse statically. Stored on
    // the scene (authoring data, not runtime); edits ride the ordinary document history.
    // -----------------------------------------------------------------------

    public listSceneSnapshots(storyId: StoryId, sceneId: StorySceneId): StorySceneSnapshot[] {
        try {
            return this.getStoryDocument(storyId).scenes[sceneId]?.sceneSnapshots ?? [];
        } catch {
            return [];
        }
    }

    public createSceneSnapshot(storyId: StoryId, sceneId: StorySceneId, name: string): string | null {
        const id = this.getUuidService().generate();
        let created: string | null = null;
        this.mutateDocument(storyId, document => {
            const scene = document.scenes[sceneId];
            if (!scene) return;
            const snapshot: StorySceneSnapshot = { id, name: name.trim() || "Snapshot", values: {} };
            scene.sceneSnapshots = [...(scene.sceneSnapshots ?? []), snapshot];
            created = id;
        }, [sceneId]);
        return created;
    }

    public renameSceneSnapshot(storyId: StoryId, sceneId: StorySceneId, snapshotId: string, name: string): boolean {
        const trimmed = name.trim();
        if (!trimmed) return false;
        return this.mutateSceneSnapshot(storyId, sceneId, snapshotId, snapshot => {
            snapshot.name = trimmed;
        });
    }

    public deleteSceneSnapshot(storyId: StoryId, sceneId: StorySceneId, snapshotId: string): boolean {
        let changed = false;
        this.mutateDocument(storyId, document => {
            const scene = document.scenes[sceneId];
            if (!scene?.sceneSnapshots) return;
            const next = scene.sceneSnapshots.filter(snapshot => snapshot.id !== snapshotId);
            if (next.length === scene.sceneSnapshots.length) return;
            scene.sceneSnapshots = next;
            changed = true;
        }, [sceneId]);
        return changed;
    }

    public setSceneSnapshotValue(
        storyId: StoryId,
        sceneId: StorySceneId,
        snapshotId: string,
        refKey: string,
        value: StoryLiteralValue,
    ): boolean {
        return this.mutateSceneSnapshot(storyId, sceneId, snapshotId, snapshot => {
            snapshot.values = { ...snapshot.values, [refKey]: value };
        });
    }

    public clearSceneSnapshotValue(storyId: StoryId, sceneId: StorySceneId, snapshotId: string, refKey: string): boolean {
        return this.mutateSceneSnapshot(storyId, sceneId, snapshotId, snapshot => {
            const next = { ...snapshot.values };
            delete next[refKey];
            snapshot.values = next;
        });
    }

    private mutateSceneSnapshot(
        storyId: StoryId,
        sceneId: StorySceneId,
        snapshotId: string,
        mutate: (snapshot: StorySceneSnapshot) => void,
    ): boolean {
        let changed = false;
        this.mutateDocument(storyId, document => {
            const snapshot = document.scenes[sceneId]?.sceneSnapshots?.find(entry => entry.id === snapshotId);
            if (!snapshot) return;
            mutate(snapshot);
            changed = true;
        }, [sceneId]);
        return changed;
    }

    private createDeclaration(
        storyId: StoryId,
        sceneId: StorySceneId,
        scope: StoryVariableScope,
        input: { name: string; valueType: StoryVariableValueType; defaultValue?: StoryLiteralValue },
    ): StorySceneVariableDefinition | null {
        const id = this.getUuidService().generate();
        let created: StorySceneVariableDefinition | null = null;
        this.mutateDocument(storyId, document => {
            const scene = document.scenes[sceneId];
            if (!scene) return;
            const block: StoryDeclarationBlock = {
                id,
                kind: "declaration",
                parentId: null,
                childrenIds: [],
                payload: {
                    scope,
                    name: this.cleanName(input.name, "variable"),
                    valueType: input.valueType,
                    defaultValue: input.defaultValue,
                    storageKey: id,
                },
            };
            insertBlockInScene(scene, block, { parentId: null, beforeBlockId: scene.rootBlockIds[0] ?? null });
            created = { id, name: block.payload.name, valueType: block.payload.valueType, defaultValue: block.payload.defaultValue, storageKey: id };
        }, [sceneId]);
        return created;
    }

    /** Saved/persistent declarations may sit in any scene, so lookups search the whole document. */
    private updateDeclaration(storyId: StoryId, variableId: string, mutate: (payload: StoryDeclarationPayload) => void): boolean {
        let changed = false;
        // A declaration payload carries no asset id, so this could honestly be `NO_SCENES`. It names
        // the scene anyway: the payload shape is the variable system's to change, and a scope that
        // is right because of a fact about *another* module is a scope that will be wrong one day.
        const touchedSceneIds: StorySceneId[] = [];
        this.mutateDocument(storyId, document => {
            const found = findDeclarationBlock(document, variableId);
            if (!found) return;
            touchedSceneIds.push(found.sceneId);
            // Reassign the payload rather than mutating it in place, so a fresh reference marks the edit:
            // `updateBlockPayload` (the other write path) already reassigns, and the inspector bridge's
            // republish gate compares payload identity — an in-place mutation would slip past it,
            // leaving an open declaration inspector stale after a rename/retype from the Variables panel.
            const nextPayload = { ...found.block.payload };
            mutate(nextPayload);
            found.block.payload = nextPayload;
            changed = true;
        }, touchedSceneIds);
        return changed;
    }

    private deleteDeclaration(storyId: StoryId, variableId: string): boolean {
        let changed = false;
        // Deleting a declaration takes its whole subtree with it (`deleteBlockFromScene`), and a
        // subtree can hold anything - so the scene it was found in has to be re-walked.
        const touchedSceneIds: StorySceneId[] = [];
        this.mutateDocument(storyId, document => {
            const found = findDeclarationBlock(document, variableId);
            if (!found) return;
            touchedSceneIds.push(found.sceneId);
            deleteBlockFromScene(document.scenes[found.sceneId], variableId);
            changed = true;
        }, touchedSceneIds);
        return changed;
    }

    public updateScene(storyId: StoryId, sceneId: StorySceneId, patch: StorySceneUpdate): boolean {
        const document = this.getStoryDocument(storyId);
        const current = document.scenes[sceneId];
        if (!current) {
            return false;
        }

        const nextName = patch.name !== undefined ? this.cleanName(patch.name, current.name || "Untitled Scene") : current.name;
        const nextDescription = patch.description !== undefined ? patch.description.trim() : current.description ?? "";
        const nextBackgroundAssetId = patch.defaultBackgroundAssetId !== undefined
            ? this.cleanOptionalString(patch.defaultBackgroundAssetId ?? "")
            : current.defaultBackgroundAssetId;
        const currentBackgroundAssetId = current.defaultBackgroundAssetId ?? undefined;
        // The whole record is replaced, never merged: a partial merge would make "clear the volume"
        // unexpressible, and the caller already holds the record it is editing.
        const nextBgm = patch.bgm !== undefined
            ? (patch.bgm && this.cleanOptionalString(patch.bgm.assetId) ? patch.bgm : undefined)
            : current.bgm;

        const hasNameChange = patch.name !== undefined && nextName !== current.name;
        const hasDescriptionChange = patch.description !== undefined && nextDescription !== (current.description ?? "");
        const hasBackgroundChange = patch.defaultBackgroundAssetId !== undefined && nextBackgroundAssetId !== currentBackgroundAssetId;
        const hasBgmChange = patch.bgm !== undefined
            && JSON.stringify(nextBgm ?? null) !== JSON.stringify(current.bgm ?? null);
        if (!hasNameChange && !hasDescriptionChange && !hasBackgroundChange && !hasBgmChange) {
            return false;
        }

        this.mutateDocument(storyId, targetDocument => {
            const scene = targetDocument.scenes[sceneId];
            if (!scene) {
                return;
            }
            if (hasNameChange) {
                scene.name = nextName;
                scene.runtimeName = scene.runtimeName || this.toRuntimeName(nextName);
            }
            if (hasDescriptionChange) {
                scene.description = nextDescription;
            }
            if (hasBackgroundChange) {
                if (nextBackgroundAssetId) {
                    scene.defaultBackgroundAssetId = nextBackgroundAssetId;
                } else {
                    delete scene.defaultBackgroundAssetId;
                }
            }
            if (hasBgmChange) {
                if (nextBgm) {
                    scene.bgm = nextBgm;
                } else {
                    delete scene.bgm;
                }
            }
            scene.meta = { ...scene.meta, updatedAt: new Date().toISOString() };
        }, [sceneId]);
        return true;
    }

    public deleteScene(storyId: StoryId, sceneId: StorySceneId): boolean {
        const before = this.captureStoryStructure(storyId);
        const name = this.getStoryDocument(storyId).scenes[sceneId]?.name ?? "";
        let changed = false;
        this.mutateDocument(storyId, document => {
            if (!document.scenes[sceneId]) {
                return;
            }
            delete document.scenes[sceneId];
            for (const chapter of document.chapters) {
                chapter.sceneIds = chapter.sceneIds.filter(id => id !== sceneId);
            }
            if (document.entrySceneId === sceneId) {
                document.entrySceneId = this.firstSceneId(document);
            }
            changed = true;
        }, [sceneId]);
        if (changed) {
            this.recordStructuralDeletion(storyId, {
                key: "story.history.deleteScene" as TranslationKey,
                params: { name },
            }, before);
        }
        return changed;
    }

    public moveScene(storyId: StoryId, sceneId: StorySceneId, target: { chapterId: string; beforeSceneId?: string | null }): boolean {
        let changed = false;
        this.mutateDocument(storyId, document => {
            const targetChapter = document.chapters.find(chapter => chapter.id === target.chapterId);
            if (!targetChapter || !document.scenes[sceneId]) {
                return;
            }
            for (const chapter of document.chapters) {
                chapter.sceneIds = chapter.sceneIds.filter(id => id !== sceneId);
            }
            const before = target.beforeSceneId ?? null;
            if (!before) {
                targetChapter.sceneIds.push(sceneId);
            } else {
                const index = targetChapter.sceneIds.indexOf(before);
                if (index === -1) {
                    targetChapter.sceneIds.push(sceneId);
                } else {
                    targetChapter.sceneIds.splice(index, 0, sceneId);
                }
            }
            changed = true;
        }, NO_SCENES);
        return changed;
    }

    public setEntryScene(storyId: StoryId, sceneId: StorySceneId | undefined): void {
        this.mutateDocument(storyId, document => {
            if (sceneId && !document.scenes[sceneId]) {
                throw new RendererError(`Scene not found: ${sceneId}`);
            }
            document.entrySceneId = sceneId;
        }, NO_SCENES);
    }

    public insertBlock(storyId: StoryId, sceneId: StorySceneId, block: StoryBlock, target: BlockTarget): StoryBlock {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            insertBlockInScene(scene, block, target);
        }, [sceneId]);
        return block;
    }

    public updateBlock(storyId: StoryId, sceneId: StorySceneId, blockId: StoryBlockId, payload: StoryBlock["payload"]): void {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            updateBlockPayload(scene, blockId, payload);
        }, [sceneId]);
    }

    /**
     * Write many blocks' payloads, across any number of scenes, as ONE mutation.
     *
     * {@link mutateDocument} emits `documentChanged` every time it runs, and the story editor
     * re-renders its visible rows on each emit. Looping {@link updateBlock} therefore costs a full
     * editor repaint per row - fine for the two or three rows an editing gesture touches, and
     * seconds of synchronous React for the two hundred a project-wide replace touches. One mutation
     * means one event, one revision and one save for the whole sweep.
     */
    public updateBlocks(
        storyId: StoryId,
        edits: readonly { sceneId: StorySceneId; blockId: StoryBlockId; payload: StoryBlock["payload"] }[],
    ): void {
        if (edits.length === 0) {
            return;
        }
        this.mutateDocument(storyId, document => {
            for (const edit of edits) {
                const scene = this.getSceneOrThrow(document, edit.sceneId);
                updateBlockPayload(scene, edit.blockId, edit.payload);
            }
        }, edits.map(edit => edit.sceneId));
    }

    public deleteBlock(storyId: StoryId, sceneId: StorySceneId, blockId: StoryBlockId): void {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            deleteBlockFromScene(scene, blockId);
        }, [sceneId]);
    }

    /** Set or clear a block's compiled-out flag (schema v7). Clearing deletes the field so an enabled block stays clean. */
    public setBlockDisabled(storyId: StoryId, sceneId: StorySceneId, blockId: StoryBlockId, disabled: boolean): void {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            const block = scene.blocks[blockId];
            if (!block) {
                return;
            }
            if (disabled) {
                block.disabled = true;
            } else {
                delete block.disabled;
            }
        }, [sceneId]);
    }

    public replaceScene(storyId: StoryId, sceneId: StorySceneId, scene: StoryScene): void {
        this.mutateDocument(storyId, document => {
            this.getSceneOrThrow(document, sceneId);
            document.scenes[sceneId] = this.cloneScene({ ...scene, id: sceneId });
        }, [sceneId]);
    }

    public moveBlock(storyId: StoryId, sceneId: StorySceneId, blockId: StoryBlockId, target: BlockTarget): void {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            moveBlockInScene(scene, blockId, target);
        }, [sceneId]);
    }

    /**
     * Move groups of blocks, each group to its own target — one mutation, one revision, one save.
     * Looping over {@link moveBlock} instead would publish the scene once per row and let the editor
     * repaint on a document where half the selection has landed.
     */
    public moveBlocks(storyId: StoryId, sceneId: StorySceneId, moves: { blockIds: StoryBlockId[]; target: BlockTarget }[]): void {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            moveBlocksInScene(scene, moves);
        }, [sceneId]);
    }

    public canImportStoryPackage(): false {
        return false;
    }

    public canExportStoryPackage(): false {
        return false;
    }

    private mutateLibrary(mutator: (index: StoryLibraryIndex) => void): void {
        const index = this.getLibraryIndex();
        mutator(index);
        index.meta = {
            ...index.meta,
            updatedAt: new Date().toISOString(),
        };
        this.revision += 1;
        this.libraryIndexDirty = true;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("libraryChanged", index);
    }

    private mutateAnimationIndex(mutator: (index: StoryAnimationIndex) => void): void {
        const index = this.getAnimationIndex();
        mutator(index);
        index.meta = {
            ...index.meta,
            updatedAt: new Date().toISOString(),
        };
        this.revision += 1;
        this.animationIndexDirty = true;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("animationsChanged", index);
    }

    /**
     * The one way a loaded story document changes.
     *
     * `scope` says which scenes the mutator may have changed the asset references of; see
     * {@link StoryAssetLockScope} for how to choose one, and note that it is read *after* the mutator
     * runs, so a mutator that only learns its scene while running can push into a mutable array. It
     * is a required argument rather than an optional one because the honest answer is sometimes
     * `"all"` and a defaulted parameter is how a new mutator ends up never having been asked.
     */
    private mutateDocument(
        storyId: StoryId,
        mutator: (document: StoryDocument) => void,
        scope: StoryAssetLockScope,
    ): void {
        const document = this.getStoryDocument(storyId);
        mutator(document);
        this.syncDocumentAssetLocks(storyId, document, scope);
        document.meta = {
            ...document.meta,
            updatedAt: new Date().toISOString(),
        };
        this.revision += 1;
        this.dirtyDocuments.add(storyId);
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", { storyId, document });
    }

    private scheduleAutoSave(): void {
        this.autoSaver.schedule();
    }

    /**
     * Write what has actually changed, and nothing else.
     *
     * The order is not free. Writing a story document stamps its library entry's `updatedAt`, so the
     * library index has to come **after** every document or it goes out one save stale; the
     * animation index sits after its assets on the same reasoning.
     *
     * Every write is attempted even when an earlier one fails, and the first error is re-thrown at
     * the end. Stopping at the first failure would let one unwritable file - a permission on one
     * document, a name the volume rejects - starve every other document forever, because the saver
     * retries the same flush from the top and would never get past it.
     */
    private async flush(): Promise<void> {
        let firstError: unknown = null;
        const attempt = async (write: () => Promise<void>): Promise<void> => {
            try {
                await write();
            } catch (error) {
                firstError ??= error;
            }
        };

        for (const [storyId, document] of this.documents.entries()) {
            if (!this.dirtyDocuments.has(storyId)) {
                continue;
            }
            await attempt(async () => {
                await this.writeStoryDocument(storyId, document);
                this.markStoryEntrySaved(storyId, document.meta?.updatedAt);
            });
        }
        for (const [animationId, asset] of this.animationAssets.entries()) {
            if (!this.dirtyAnimationAssets.has(animationId)) {
                continue;
            }
            await attempt(() => this.writeAnimationAsset(asset));
        }
        if (this.animationIndexDirty) {
            await attempt(() => this.writeAnimationIndex());
        }
        if (this.libraryIndexDirty) {
            await attempt(() => this.writeLibraryIndex());
        }

        this.setDirty(this.hasPendingWrites());
        if (firstError !== null) {
            throw firstError;
        }
    }

    /**
     * Forget every debt, because the memory it is owed on is being replaced by the disk's version.
     *
     * The two callers - a library re-read and a working-tree reload - are the two moments where
     * writing what we still hold would put back exactly the state the re-read exists to discard.
     * See `DebouncedSaver.abandon`, which drops the same debt on the same reasoning.
     */
    private discardPendingWrites(): void {
        this.dirtyDocuments.clear();
        this.dirtyAnimationAssets.clear();
        this.libraryIndexDirty = false;
        this.animationIndexDirty = false;
        this.setDirty(false);
    }

    /** Whether any file this service owns is still owed to the disk. */
    private hasPendingWrites(): boolean {
        return this.dirtyDocuments.size > 0
            || this.dirtyAnimationAssets.size > 0
            || this.libraryIndexDirty
            || this.animationIndexDirty;
    }

    /**
     * Whether the bytes handed to `fs.write` are known to have reached the disk.
     *
     * A refusal answers `ok` - see {@link FsRequestResult.refused} - so `ok` alone is not the
     * question a debt-tracking writer is asking.
     */
    private static wrote(result: FsRequestResult<void>): boolean {
        return result.ok && result.refused !== true;
    }

    /**
     * The common tail of every writer here: re-owe what did not land, then report a real failure.
     *
     * `reOwe` runs for a *refused* write as well as a failed one - see {@link wrote} - which is why
     * it is a callback and not a flag: only the caller knows which debt it just cleared.
     */
    private settleWrite(result: FsRequestResult<void>, reOwe: () => void): void {
        if (!StoryService.wrote(result)) {
            reOwe();
        }
        if (!result.ok) {
            // One way a write fails is a directory that went missing under a running Studio. Drop
            // what `ensureDir` believes, so the auto-saver's retry re-checks the disk and re-creates
            // it instead of repeating the same doomed attempt down the whole backoff ladder.
            this.forgetVerifiedDirs();
            throw new RendererError(result.error.message);
        }
    }

    private async writeLibraryIndex(): Promise<void> {
        const fs = this.getFileSystem();
        await this.ensureStoryDirs();
        const payload = JSON.stringify(this.getLibraryIndex(), null, 2);
        this.libraryIndexDirty = false;
        const result = await fs.write(this.getIndexPath(), payload, "utf-8");
        this.settleWrite(result, () => {
            this.libraryIndexDirty = true;
        });
    }

    /**
     * Serialise, clear the debt, then write - in that order, and the first two in one tick.
     *
     * `JSON.stringify` is synchronous, so the bytes and the `delete` below are taken at the same
     * instant: nothing can edit the document between them. Everything after is awaited, and an edit
     * arriving during the await re-adds the id through {@link mutateDocument}. Clearing the entry
     * *after* the await instead would delete exactly that re-mark and lose the edit - it would look
     * like a write of state that was in fact never serialised.
     *
     * The `storyId` is a parameter rather than read off `document.id` so a document whose id has
     * drifted from its map key cannot silently write itself over a different story's file.
     */
    private async writeStoryDocument(storyId: StoryId, document: StoryDocument): Promise<void> {
        await this.ensureStoryDocumentDir(storyId);
        const payload = JSON.stringify(document, null, 2);
        this.dirtyDocuments.delete(storyId);
        const result = await this.getFileSystem().write(this.getStoryDocumentPath(storyId), payload, "utf-8");
        this.settleWrite(result, () => {
            this.dirtyDocuments.add(storyId);
        });
    }

    private async writeAnimationIndex(): Promise<void> {
        const fs = this.getFileSystem();
        await this.ensureStoryDirs();
        const payload = JSON.stringify(this.getAnimationIndex(), null, 2);
        this.animationIndexDirty = false;
        const result = await fs.write(this.getAnimationIndexPath(), payload, "utf-8");
        this.settleWrite(result, () => {
            this.animationIndexDirty = true;
        });
    }

    private async writeAnimationAsset(asset: StoryAnimationAsset): Promise<void> {
        await this.ensureStoryDirs();
        const payload = JSON.stringify(asset, null, 2);
        this.dirtyAnimationAssets.delete(asset.id);
        const result = await this.getFileSystem().write(this.getAnimationAssetPath(asset.id), payload, "utf-8");
        this.settleWrite(result, () => {
            this.dirtyAnimationAssets.add(asset.id);
        });
    }

    /**
     * Stamp a story's library entry with the moment its document reached the disk.
     *
     * Marks the index dirty only when the stamp actually moves. Unconditionally marking it would
     * make every save of any document a save of the index too, which is most of what per-file
     * tracking is here to stop.
     */
    private markStoryEntrySaved(storyId: StoryId, updatedAt?: string): void {
        const entry = this.getLibraryIndex().stories.find(story => story.id === storyId);
        if (!entry) {
            return;
        }
        const stamp = updatedAt ?? new Date().toISOString();
        if (entry.updatedAt === stamp) {
            return;
        }
        entry.updatedAt = stamp;
        this.libraryIndexDirty = true;
    }

    private setDirty(value: boolean): void {
        if (this.dirty === value) {
            return;
        }
        this.dirty = value;
        this.events.emit("dirtyChanged", value);
    }

    private emitPluginActionsChanged(): void {
        this.events.emit("pluginActionsChanged", this.listPluginActions());
    }

    private generateUniqueStoryId(): StoryId {
        const uuid = this.getUuidService();
        for (let attempts = 0; attempts < 10; attempts += 1) {
            const storyId = uuid.generate();
            assertValidStoryId(storyId);
            if (!this.getStoryEntry(storyId)) {
                return storyId;
            }
        }
        throw new RendererError("Failed to generate a unique story id");
    }

    private generateUniqueAnimationId(): StoryAnimationAssetId {
        const uuid = this.getUuidService();
        for (let attempts = 0; attempts < 10; attempts += 1) {
            const animationId = uuid.generate();
            if (!this.getAnimationIndex().animations.some(animation => animation.id === animationId)) {
                return animationId;
            }
        }
        throw new RendererError("Failed to generate a unique story animation id");
    }

    private getSceneOrThrow(document: StoryDocument, sceneId: StorySceneId): StoryScene {
        const scene = document.scenes[sceneId];
        if (!scene) {
            throw new RendererError(`Scene not found: ${sceneId}`);
        }
        return scene;
    }

    private firstSceneId(document: StoryDocument): StorySceneId | undefined {
        for (const chapter of document.chapters) {
            if (chapter.sceneIds[0]) {
                return chapter.sceneIds[0];
            }
        }
        return undefined;
    }

    private cloneScene(scene: StoryScene): StoryScene {
        return JSON.parse(JSON.stringify(scene)) as StoryScene;
    }

    /**
     * Everything a structural deletion inside one story can destroy.
     *
     * Whole-shape rather than a hand-written list of what each deletion touches. Deleting a chapter
     * removes the chapter, every scene in it, that scene's id from the chapter's list, and re-points
     * `entrySceneId` if it happened to name one of them - four consequences from one call, and a
     * restore that enumerates them is a restore that will be wrong the first time a fifth is added.
     * Deletions are rare enough that the clone costs nothing worth measuring.
     */
    private captureStoryStructure(storyId: StoryId): StoryStructureSnapshot {
        const document = this.getStoryDocument(storyId);
        return JSON.parse(JSON.stringify({
            chapters: document.chapters,
            scenes: document.scenes,
            entrySceneId: document.entrySceneId,
        })) as StoryStructureSnapshot;
    }

    private applyStoryStructure(storyId: StoryId, snapshot: StoryStructureSnapshot): void {
        this.mutateDocument(storyId, document => {
            const restored = JSON.parse(JSON.stringify(snapshot)) as StoryStructureSnapshot;
            document.chapters = restored.chapters;
            document.scenes = restored.scenes;
            if (restored.entrySceneId === undefined) {
                delete document.entrySceneId;
            } else {
                document.entrySceneId = restored.entrySceneId;
            }
        }, "all");
    }

    /**
     * Record a structural deletion as one undo step on the project stack.
     *
     * `before` is captured by the caller ahead of the mutation; `after` is taken here, so undo and
     * redo are the same operation in opposite directions and neither has to re-derive what was lost.
     */
    private recordStructuralDeletion(
        storyId: StoryId,
        label: HistoryLabel,
        before: StoryStructureSnapshot,
    ): void {
        const after = this.captureStoryStructure(storyId);
        this.getHistoryService().pushCommand(projectHistoryScope(), {
            label,
            undo: () => this.applyStoryStructure(storyId, before),
            redo: () => this.applyStoryStructure(storyId, after),
        });
    }

    private getHistoryService(): HistoryService {
        return this.getContext().services.get<HistoryService>(Services.History);
    }

    private cleanName(value: string, fallback: string): string {
        return value.trim() || fallback;
    }

    private cleanOptionalString(value: string): string | undefined {
        const trimmed = value.trim();
        return trimmed || undefined;
    }

    private toRuntimeName(name: string): string {
        const normalized = name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");
        return normalized || `scene_${this.getUuidService().generate(true)}`;
    }

    private getFileSystem(): FileSystemService {
        return this.getContext().services.get<FileSystemService>(Services.FileSystem);
    }

    private getUuidService(): UuidService {
        return this.getContext().services.get<UuidService>(Services.Uuid);
    }

    private getAssetsService(): AssetsService {
        return this.getContext().services.get<AssetsService>(Services.Assets);
    }

    /**
     * Derive a lock table for every story the library names, reading from disk the ones not open.
     *
     * The cold-start cost, and it stays a full walk per story on purpose. There is no cheaper way to
     * learn what a document on disk points at than to read it, and a lock table cached beside the
     * document would have to be provably current before it could be believed - "the file has not
     * changed since" is exactly the claim a copied project, a version-control checkout or an editor
     * open in another window makes false. A stale table under-reports use, and an asset reported
     * unused is an asset the author is invited to delete out from under a story.
     */
    private async syncLibraryAssetLocks(): Promise<void> {
        const index = this.getLibraryIndex();
        for (const entry of index.stories) {
            const cached = this.documents.get(entry.id);
            if (cached) {
                // Held in memory, so its table is either already current or has never been made.
                // `reloadFromDisk` reaches here right after re-loading each open story, and this is
                // what stops that being a second full walk of everything the author had open.
                this.ensureStoryAssetLocks(entry.id, cached);
                continue;
            }
            const result = await this.getFileSystem().readJSON<StoryDocument>(this.getStoryDocumentPath(entry.id));
            if (!result.ok) {
                continue;
            }
            try {
                const document = normalizeStoryDocument(result.data, new Date().toISOString());
                this.syncDocumentAssetLocks(entry.id, document, "all");
            } catch (error) {
                console.warn("[StoryService] failed to read story asset references", error);
            }
        }
    }

    /**
     * Bring this story's asset locks back in line with the document, walking only what `scope` names.
     *
     * The whole point is that a lock is a function of one scene: the key a lock is filed under is
     * `sceneId` + `blockId` + `field`, and nothing outside `document.scenes[sceneId]` contributes to
     * it. So an edit that changed one scene can be answered by recomputing that scene, and the other
     * thirty-nine scenes of a long story are left alone instead of re-walked on every keystroke.
     *
     * Two things stop a wrong `scope` from becoming a wrong lock table:
     *
     * - A story with no table yet is rebuilt in full whatever the scope says. There is nothing to be
     *   incremental against, and a scoped sync would otherwise file one scene and quietly declare the
     *   other thirty-nine lock-free.
     * - After a scoped sync the document's scene set is compared against the table's. That is O(one
     *   entry per scene), not per block, and it catches every scene that appeared or vanished without
     *   being named. A mismatch is repaired by a full rebuild rather than trusted, because a scope
     *   that was wrong about the scene *set* has already shown it cannot be trusted about the rest.
     *
     * What neither check can see is a scope that names the right scenes but misses a block edit
     * inside an unnamed one. That is what `StoryService.assetLocks.test.ts` is for: it drives every
     * mutator on the service and asserts that forcing a full rebuild afterwards changes nothing.
     */
    private syncDocumentAssetLocks(storyId: StoryId, document: StoryDocument, scope: StoryAssetLockScope): void {
        const table = this.storyAssetLocks.get(storyId);
        if (!table || scope === "all") {
            this.rebuildStoryAssetLocks(storyId, document, table);
            return;
        }

        for (const sceneId of new Set(scope)) {
            this.syncSceneAssetLocks(document, table, sceneId);
        }

        if (!this.assetLockSceneSetMatches(document, table)) {
            console.warn(
                "[StoryService] asset lock scope missed a scene; rebuilding the table for",
                storyId,
            );
            this.rebuildStoryAssetLocks(storyId, document, table);
        }
    }

    /**
     * Derive this story's locks from every scene it has, and diff the result against what is held.
     *
     * Diffed per scene rather than wholesale so that a rebuild over an unchanged document issues no
     * lock or unlock calls at all. That matters beyond tidiness: `AssetLockManager` stores one object
     * per lock and removes one per unlock, so a rebuild that dropped and re-took every lock would be
     * balanced only as long as nothing threw in between.
     */
    private rebuildStoryAssetLocks(
        storyId: StoryId,
        document: StoryDocument,
        previous: StoryAssetLocks | undefined,
    ): void {
        const next: StoryAssetLocks = new Map();
        for (const scene of Object.values(document.scenes)) {
            next.set(scene.id, this.collectSceneAssetLocks(document.id, scene));
        }

        if (previous) {
            for (const [sceneId, sceneLocks] of previous.entries()) {
                if (!next.has(sceneId)) {
                    this.releaseSceneAssetLocks(sceneLocks);
                }
            }
            for (const [sceneId, sceneLocks] of next.entries()) {
                this.applySceneAssetLockDiff(previous.get(sceneId), sceneLocks);
            }
        } else {
            for (const sceneLocks of next.values()) {
                this.applySceneAssetLockDiff(undefined, sceneLocks);
            }
        }

        this.storyAssetLocks.set(storyId, next);
    }

    /** Recompute one scene's entry in a table that already exists, or release it if the scene is gone. */
    private syncSceneAssetLocks(document: StoryDocument, table: StoryAssetLocks, sceneId: StorySceneId): void {
        const scene = document.scenes[sceneId];
        if (!scene) {
            const previous = table.get(sceneId);
            if (previous) {
                this.releaseSceneAssetLocks(previous);
                table.delete(sceneId);
            }
            return;
        }
        const next = this.collectSceneAssetLocks(document.id, scene);
        // Filed under `scene.id`, which is what the lock metadata carries. The two agree for every
        // scene this service writes; if they ever did not, the scene-set check below would see a key
        // it cannot account for and rebuild.
        this.applySceneAssetLockDiff(table.get(scene.id), next);
        table.set(scene.id, next);
    }

    /**
     * Does the table hold exactly one entry per scene the document has?
     *
     * Cheap enough to run after every scoped sync - one map lookup per scene, and a story has scenes
     * in the tens where it has blocks in the tens of thousands.
     */
    private assetLockSceneSetMatches(document: StoryDocument, table: StoryAssetLocks): boolean {
        let seen = 0;
        for (const scene of Object.values(document.scenes)) {
            if (!table.has(scene.id)) {
                return false;
            }
            seen += 1;
        }
        return seen === table.size;
    }

    private applySceneAssetLockDiff(
        previous: StorySceneAssetLocks | undefined,
        next: StorySceneAssetLocks,
    ): void {
        if (!previous) {
            if (next.size === 0) {
                return;
            }
            const assetsService = this.getAssetsService();
            for (const entry of next.values()) {
                assetsService.lockAsset(entry.assetId, AssetLockReason.UsedByScene, entry.metadata);
            }
            return;
        }
        const assetsService = this.getAssetsService();
        for (const [key, entry] of previous.entries()) {
            const nextEntry = next.get(key);
            if (!nextEntry || nextEntry.assetId !== entry.assetId) {
                assetsService.unlockAsset(entry.assetId, AssetLockReason.UsedByScene, entry.metadata);
            }
        }
        for (const [key, entry] of next.entries()) {
            const previousEntry = previous.get(key);
            if (!previousEntry || previousEntry.assetId !== entry.assetId) {
                assetsService.lockAsset(entry.assetId, AssetLockReason.UsedByScene, entry.metadata);
            }
        }
    }

    private releaseSceneAssetLocks(sceneLocks: StorySceneAssetLocks): void {
        if (sceneLocks.size === 0) {
            return;
        }
        const assetsService = this.getAssetsService();
        for (const entry of sceneLocks.values()) {
            assetsService.unlockAsset(entry.assetId, AssetLockReason.UsedByScene, entry.metadata);
        }
    }

    /**
     * Derive a story's locks once, if nobody has yet.
     *
     * The cheap half of what the old per-read full sync bought. A document held in memory only ever
     * changes through {@link mutateDocument}, which files the change as it makes it, so a table that
     * exists is a table that is current and re-walking thirty thousand rows to confirm it buys
     * nothing. A table that does *not* exist is the one case a read has to answer for: `createStory`
     * and both load paths derive one, but a future path that installs a document without doing so
     * would otherwise leave the story's assets deletable.
     */
    private ensureStoryAssetLocks(storyId: StoryId, document: StoryDocument): void {
        if (this.storyAssetLocks.has(storyId)) {
            return;
        }
        this.rebuildStoryAssetLocks(storyId, document, undefined);
    }

    private releaseStoryAssetLocks(storyId: StoryId): void {
        const previous = this.storyAssetLocks.get(storyId);
        if (!previous) {
            return;
        }
        for (const sceneLocks of previous.values()) {
            this.releaseSceneAssetLocks(sceneLocks);
        }
        this.storyAssetLocks.delete(storyId);
    }

    /**
     * Every asset one scene points at, keyed by `${blockId}:${field}`.
     *
     * The scene id is carried in each entry's metadata because that is what `AssetLockManager`
     * matches an unlock against - it has to stay in the shape the lock was taken with.
     */
    private collectSceneAssetLocks(storyId: StoryId, scene: StoryScene): StorySceneAssetLocks {
        const locks: StorySceneAssetLocks = new Map();
        const addAssetLock = (blockId: StoryBlockId, field: string, assetId: string | undefined) => {
            const normalizedAssetId = assetId?.trim();
            if (!normalizedAssetId) {
                return;
            }
            locks.set(`${blockId}:${field}`, {
                assetId: normalizedAssetId,
                metadata: {
                    storyId,
                    sceneId: scene.id,
                    blockId,
                    field,
                },
            });
        };

        addAssetLock("__scene__", "scene.defaultBackgroundAssetId", scene.defaultBackgroundAssetId);
        for (const block of Object.values(scene.blocks)) {
            if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
                addAssetLock(block.id, "voiceAssetId", block.payload.voiceAssetId);
                continue;
            }
            if (block.kind !== "action") {
                continue;
            }
            const payload = block.payload;
            if (payload.action === "setBackground") {
                addAssetLock(block.id, "background.assetId", payload.assetId);
            } else if (payload.action === "character") {
                addAssetLock(block.id, "character.assetId", payload.assetId);
            } else if (payload.action === "audio") {
                addAssetLock(block.id, "audio.assetId", payload.assetId);
            } else if (payload.action === "displayable") {
                addAssetLock(block.id, "displayable.maskAssetId", payload.transform?.to?.maskAssetId ?? undefined);
            }
        }

        return locks;
    }

    private getIndexPath(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorStoryIndex);
    }

    private getStoryDocumentPath(storyId: StoryId): string {
        assertValidStoryId(storyId);
        return this.getContext().project.resolve(ProjectNameConvention.EditorStoryDocument(storyId));
    }

    private getAnimationIndexPath(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorStoryAnimationIndex);
    }

    private getAnimationAssetPath(animationId: StoryAnimationAssetId): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorStoryAnimationDocument(animationId));
    }

    private async ensureStoryDirs(): Promise<void> {
        await this.ensureDir(this.getContext().project.resolve(ProjectNameConvention.EditorStory));
        await this.ensureDir(this.getContext().project.resolve(ProjectNameConvention.EditorStoryStories));
        await this.ensureDir(this.getContext().project.resolve(ProjectNameConvention.EditorStoryAnimations));
    }

    private async ensureStoryDocumentDir(storyId: StoryId): Promise<void> {
        assertValidStoryId(storyId);
        await this.ensureStoryDirs();
        await this.ensureDir(this.getStoryDocumentDir(storyId));
    }

    /**
     * Make sure `dir` exists, asking the disk only the first time.
     *
     * Every save used to re-ask. A one-line edit on a 300-scene project spent 21 ms of its 196 ms
     * flush on seven `isDirExists` round trips - three for the story tree, one for the document's own
     * directory, then the same three again for the library index - all of them re-confirming
     * directories that `init` verified before the project was even shown.
     *
     * **A stale "yes" is accepted on purpose**, and it is safe for two independent reasons:
     *
     *  - The check is duplicated in the main process anyway. `allocateWrite` (privilegedAction.ts)
     *    stats the parent directory of every write grant it hands out and answers `NOT_FOUND` when it
     *    is gone. So a directory that disappears under a running Studio - a VCS checkout, another
     *    window, the author in Explorer - fails the *write*, loudly, whatever this memo believes.
     *  - A failed write is not swallowed: the debt is re-owed (see {@link writeStoryDocument}) and
     *    the writers below drop the memo, so the auto-saver's next retry re-checks the disk and
     *    re-creates whatever went missing. A stale entry therefore costs one failed attempt, never a
     *    lost edit.
     *
     * The memo is keyed by *absolute* path, which is what makes a project switch invalidate it for
     * free: another project resolves to other paths and simply misses. {@link reloadFromDisk} and
     * {@link removeStory} clear it explicitly, because those are the two moments where the tree this
     * service is looking at changes without the paths changing with it.
     */
    private async ensureDir(dir: string): Promise<void> {
        if (this.verifiedDirs.has(dir)) {
            return;
        }
        const fs = this.getFileSystem();
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error.message || "Failed to access story directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error.message || "Failed to create story directory");
            }
        }
        this.verifiedDirs.add(dir);
    }

    /**
     * Forget what this service believes about the disk's shape.
     *
     * Called from every write that did not land, so the retry re-checks rather than repeating the
     * same doomed attempt forever, and from the two places the working tree is replaced underneath
     * us. Never called on a *refused* write: a freeze latch says nothing about directories.
     */
    private forgetVerifiedDirs(): void {
        this.verifiedDirs.clear();
    }

    private getStoryDocumentDir(storyId: StoryId): string {
        assertValidStoryId(storyId);
        return this.getContext().project.resolve(ProjectNameConvention.EditorStoryStories, `${storyId}/`);
    }
}
