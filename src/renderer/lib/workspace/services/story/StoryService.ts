import { FsRejectErrorCode } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import {
    StoryBlock,
    StoryBlockId,
    StoryChapter,
    StoryDocument,
    StoryId,
    StoryLibraryEntry,
    StoryLibraryIndex,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";
import { ProjectNameConvention } from "../../project/nameConvention";
import { Service } from "../Service";
import { IStoryService, Services, WorkspaceContext, type StoryPluginActionRegistration } from "../services";
import { FileSystemService } from "../core/FileSystem";
import { ProjectService } from "../core/ProjectService";
import { UuidService } from "../core/UuidService";
import { AssetsService } from "../core/AssetsService";
import { AssetLockReason } from "../assets/AssetLockManager";
import { EventEmitter } from "../ui/EventEmitter";
import {
    createChapter as createStoryChapterModel,
    createEmptyStoryDocument,
    createEmptyStoryLibraryIndex,
    createScene as createStorySceneModel,
    createStoryLibraryEntry,
    deleteBlockFromScene,
    insertBlockInScene,
    moveBlockInScene,
    normalizeStoryDocument,
    normalizeStoryLibraryIndex,
    storyDocumentRelativePath,
    updateBlockPayload,
} from "./storyModel";

type StoryServiceEvents = {
    libraryChanged: StoryLibraryIndex;
    documentChanged: { storyId: StoryId; document: StoryDocument };
    dirtyChanged: boolean;
    pluginActionsChanged: StoryPluginActionRegistration[];
};

type BlockTarget = {
    parentId: StoryBlockId | null;
    beforeBlockId?: StoryBlockId | null;
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

export class StoryService extends Service<StoryService> implements IStoryService {
    private index: StoryLibraryIndex | null = null;
    private readonly documents = new Map<StoryId, StoryDocument>();
    private readonly events = new EventEmitter<StoryServiceEvents>();
    private dirty = false;
    private revision = 0;
    private lastSavedRevision = 0;
    private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
    private readonly autoSaveDelay = 800;
    private readonly storyAssetLocks = new Map<StoryId, Map<string, StoryAssetLockEntry>>();
    private readonly pluginActions = new Map<string, StoryPluginActionRegistration>();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        await depend([filesystemService, projectService, uuidService, assetsService]);

        await this.ensureStoryDirs();
        await this.loadLibrary();
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
        const storyId = uuid.generate();
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
        void this.ensureStoryDocumentDir(storyId)
            .then(() => this.writeStoryDocument(document))
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
            });
        }
        return true;
    }

    public deleteStory(storyId: StoryId): boolean {
        const entry = this.getStoryEntry(storyId);
        if (!entry) {
            return false;
        }
        this.releaseStoryAssetLocks(storyId);
        this.documents.delete(storyId);
        this.mutateLibrary(index => {
            index.stories = index.stories.filter(story => story.id !== storyId);
            if (index.defaultStoryId === storyId) {
                delete index.defaultStoryId;
            }
        });
        const dir = this.getContext().project.resolve(ProjectNameConvention.EditorStory, "stories", storyId, "/");
        void this.getFileSystem().deleteDir(dir).catch(err => {
            console.warn("[StoryService] failed to delete story directory", err);
        });
        return true;
    }

    public async loadStory(storyId: StoryId): Promise<StoryDocument> {
        const cached = this.documents.get(storyId);
        if (cached) {
            this.syncDocumentAssetLocks(storyId, cached);
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
            throw new RendererError(result.error.message || `Failed to read story document: ${entry.name}`);
        }
        try {
            const document = normalizeStoryDocument(result.data, new Date().toISOString());
            this.documents.set(storyId, document);
            this.syncDocumentAssetLocks(storyId, document);
            this.events.emit("documentChanged", { storyId, document });
            return document;
        } catch (error) {
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

    public async saveStory(storyId: StoryId): Promise<void> {
        const document = this.getStoryDocument(storyId);
        await this.writeStoryDocument(document);
        this.markStoryEntrySaved(storyId, document.meta?.updatedAt);
        await this.writeLibraryIndex();
        this.lastSavedRevision = this.revision;
        this.setDirty(false);
    }

    public async reloadStory(storyId: StoryId): Promise<StoryDocument> {
        this.documents.delete(storyId);
        return this.loadStory(storyId);
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
            throw new RendererError(result.error.message);
        }

        try {
            this.index = normalizeStoryLibraryIndex(result.data, new Date().toISOString());
            this.revision = 0;
            this.lastSavedRevision = 0;
            this.setDirty(false);
            this.events.emit("libraryChanged", this.index);
            return this.index;
        } catch (error) {
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

    public registerPluginAction(registration: StoryPluginActionRegistration): () => void {
        const actionId = registration.id.trim();
        if (!actionId) {
            throw new RendererError("Plugin action id is required");
        }
        if (this.pluginActions.has(actionId)) {
            throw new RendererError(`Plugin action already registered: ${actionId}`);
        }
        const normalized = { ...registration, id: actionId };
        this.pluginActions.set(actionId, normalized);
        this.emitPluginActionsChanged();
        return () => {
            this.unregisterPluginAction(actionId);
        };
    }

    public unregisterPluginAction(actionId: string): boolean {
        const removed = this.pluginActions.delete(actionId.trim());
        if (removed) {
            this.emitPluginActionsChanged();
        }
        return removed;
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
        });
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
        });
        return changed;
    }

    public deleteChapter(storyId: StoryId, chapterId: string): boolean {
        let changed = false;
        this.mutateDocument(storyId, document => {
            const index = document.chapters.findIndex(chapter => chapter.id === chapterId);
            if (index === -1) {
                return;
            }
            const [chapter] = document.chapters.splice(index, 1);
            chapter.sceneIds.forEach(sceneId => {
                delete document.scenes[sceneId];
            });
            if (document.entrySceneId && !document.scenes[document.entrySceneId]) {
                document.entrySceneId = this.firstSceneId(document);
            }
            changed = true;
        });
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
        });
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
        });
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
        });
        return changed;
    }

    public deleteScene(storyId: StoryId, sceneId: StorySceneId): boolean {
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
        });
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
        });
        return changed;
    }

    public setEntryScene(storyId: StoryId, sceneId: StorySceneId | undefined): void {
        this.mutateDocument(storyId, document => {
            if (sceneId && !document.scenes[sceneId]) {
                throw new RendererError(`Scene not found: ${sceneId}`);
            }
            document.entrySceneId = sceneId;
        });
    }

    public insertBlock(storyId: StoryId, sceneId: StorySceneId, block: StoryBlock, target: BlockTarget): StoryBlock {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            insertBlockInScene(scene, block, target);
        });
        return block;
    }

    public updateBlock(storyId: StoryId, sceneId: StorySceneId, blockId: StoryBlockId, payload: StoryBlock["payload"]): void {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            updateBlockPayload(scene, blockId, payload);
        });
    }

    public deleteBlock(storyId: StoryId, sceneId: StorySceneId, blockId: StoryBlockId): void {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            deleteBlockFromScene(scene, blockId);
        });
    }

    public replaceScene(storyId: StoryId, sceneId: StorySceneId, scene: StoryScene): void {
        this.mutateDocument(storyId, document => {
            this.getSceneOrThrow(document, sceneId);
            document.scenes[sceneId] = this.cloneScene({ ...scene, id: sceneId });
        });
    }

    public moveBlock(storyId: StoryId, sceneId: StorySceneId, blockId: StoryBlockId, target: BlockTarget): void {
        this.mutateDocument(storyId, document => {
            const scene = this.getSceneOrThrow(document, sceneId);
            moveBlockInScene(scene, blockId, target);
        });
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
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("libraryChanged", index);
    }

    private mutateDocument(storyId: StoryId, mutator: (document: StoryDocument) => void): void {
        const document = this.getStoryDocument(storyId);
        mutator(document);
        this.syncDocumentAssetLocks(storyId, document);
        document.meta = {
            ...document.meta,
            updatedAt: new Date().toISOString(),
        };
        this.revision += 1;
        this.setDirty(true);
        this.scheduleAutoSave();
        this.events.emit("documentChanged", { storyId, document });
    }

    private scheduleAutoSave(): void {
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        this.autoSaveTimer = setTimeout(() => {
            this.autoSaveTimer = null;
            void this.flush().catch(err => {
                console.warn("[StoryService] auto-save failed", err);
            });
        }, this.autoSaveDelay);
    }

    private async flush(): Promise<void> {
        for (const [storyId, document] of this.documents.entries()) {
            await this.writeStoryDocument(document);
            this.markStoryEntrySaved(storyId, document.meta?.updatedAt);
        }
        await this.writeLibraryIndex();
        this.lastSavedRevision = this.revision;
        this.setDirty(false);
    }

    private async writeLibraryIndex(): Promise<void> {
        const fs = this.getFileSystem();
        await this.ensureStoryDirs();
        const index = this.getLibraryIndex();
        const result = await fs.write(this.getIndexPath(), JSON.stringify(index, null, 2), "utf-8");
        if (!result.ok) {
            throw new RendererError(result.error.message);
        }
    }

    private async writeStoryDocument(document: StoryDocument): Promise<void> {
        await this.ensureStoryDocumentDir(document.id);
        const result = await this.getFileSystem().write(
            this.getStoryDocumentPath(document.id),
            JSON.stringify(document, null, 2),
            "utf-8",
        );
        if (!result.ok) {
            throw new RendererError(result.error.message);
        }
    }

    private markStoryEntrySaved(storyId: StoryId, updatedAt?: string): void {
        const entry = this.getLibraryIndex().stories.find(story => story.id === storyId);
        if (entry) {
            entry.updatedAt = updatedAt ?? new Date().toISOString();
        }
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

    private cleanName(value: string, fallback: string): string {
        return value.trim() || fallback;
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

    private async syncLibraryAssetLocks(): Promise<void> {
        const index = this.getLibraryIndex();
        for (const entry of index.stories) {
            const cached = this.documents.get(entry.id);
            if (cached) {
                this.syncDocumentAssetLocks(entry.id, cached);
                continue;
            }
            const result = await this.getFileSystem().readJSON<StoryDocument>(this.getStoryDocumentPath(entry.id));
            if (!result.ok) {
                continue;
            }
            try {
                const document = normalizeStoryDocument(result.data, new Date().toISOString());
                this.syncDocumentAssetLocks(entry.id, document);
            } catch (error) {
                console.warn("[StoryService] failed to read story asset references", error);
            }
        }
    }

    private syncDocumentAssetLocks(storyId: StoryId, document: StoryDocument): void {
        const assetsService = this.getAssetsService();
        const previous = this.storyAssetLocks.get(storyId) ?? new Map<string, StoryAssetLockEntry>();
        const next = this.collectDocumentAssetLocks(document);

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

        if (next.size === 0) {
            this.storyAssetLocks.delete(storyId);
        } else {
            this.storyAssetLocks.set(storyId, next);
        }
    }

    private releaseStoryAssetLocks(storyId: StoryId): void {
        const previous = this.storyAssetLocks.get(storyId);
        if (!previous) {
            return;
        }
        const assetsService = this.getAssetsService();
        for (const entry of previous.values()) {
            assetsService.unlockAsset(entry.assetId, AssetLockReason.UsedByScene, entry.metadata);
        }
        this.storyAssetLocks.delete(storyId);
    }

    private collectDocumentAssetLocks(document: StoryDocument): Map<string, StoryAssetLockEntry> {
        const locks = new Map<string, StoryAssetLockEntry>();
        const addAssetLock = (sceneId: StorySceneId, blockId: StoryBlockId, field: string, assetId: string | undefined) => {
            const normalizedAssetId = assetId?.trim();
            if (!normalizedAssetId) {
                return;
            }
            const key = `${sceneId}:${blockId}:${field}`;
            locks.set(key, {
                assetId: normalizedAssetId,
                metadata: {
                    storyId: document.id,
                    sceneId,
                    blockId,
                    field,
                },
            });
        };

        for (const scene of Object.values(document.scenes)) {
            for (const block of Object.values(scene.blocks)) {
                if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
                    addAssetLock(scene.id, block.id, "voiceAssetId", block.payload.voiceAssetId);
                    continue;
                }
                if (block.kind !== "action") {
                    continue;
                }
                const payload = block.payload;
                if (payload.action === "setBackground") {
                    addAssetLock(scene.id, block.id, "background.assetId", payload.assetId);
                } else if (payload.action === "character") {
                    addAssetLock(scene.id, block.id, "character.assetId", payload.assetId);
                } else if (payload.action === "audio") {
                    addAssetLock(scene.id, block.id, "audio.assetId", payload.assetId);
                }
            }
        }

        return locks;
    }

    private getIndexPath(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorStoryIndex);
    }

    private getStoryDocumentPath(storyId: StoryId): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorStoryDocument(storyId));
    }

    private async ensureStoryDirs(): Promise<void> {
        const fs = this.getFileSystem();
        const dirs = [
            this.getContext().project.resolve(ProjectNameConvention.EditorStory),
            this.getContext().project.resolve(ProjectNameConvention.EditorStory, "stories/"),
        ];
        for (const dir of dirs) {
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
        }
    }

    private async ensureStoryDocumentDir(storyId: StoryId): Promise<void> {
        const fs = this.getFileSystem();
        const dir = this.getContext().project.resolve(ProjectNameConvention.EditorStory, "stories", storyId, "/");
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error.message || "Failed to access story document directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error.message || "Failed to create story document directory");
            }
        }
    }
}
