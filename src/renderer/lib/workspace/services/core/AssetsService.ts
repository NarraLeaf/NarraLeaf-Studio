import { RequestStatus } from "@shared/types/ipcEvents";
import { FsRequestResult } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import { ProjectNameConvention } from "../../project/nameConvention";
import { AssetData, AssetType } from "../assets/assetTypes";
import { AudioService } from "../assets/AudioService";
import { FileFormatValidator } from "../assets/FileFormatValidator";
import { FontService } from "../assets/FontService";
import { ImageService } from "../assets/ImageService";
import { JSONService } from "../assets/JSONService";
import { ModelService } from "../assets/ModelService";
import { BlueprintService } from "../assets/BlueprintService";
import { AssetOrderManager } from "../assets/mgr/AssetOrderManager";
import { AssetsMetadataManager } from "../assets/mgr/AssetsMetadataManager";
import { EditorRemoteCacheManager } from "../assets/mgr/EditorRemoteCacheManager";
import { GroupAssetsManager } from "../assets/mgr/GroupAssetsManager";
import { LocalAssetsManager, type ImportFromPathsOptions } from "../assets/mgr/LocalAssetsManager";
import { RemoteAssetsManager } from "../assets/mgr/RemoteAssetsManager";
import { OtherService } from "../assets/OtherService";
import type { ExpandImportPathsResult } from "../assets/importPathExpansion";
import { Asset, AssetExtras, AssetGroup, AssetsMap, AssetSource } from "../assets/types";
import { VideoService } from "../assets/VideoService";
import { Service } from "../Service";
import { IAssetService, Services, WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
import { FileSystemService } from "./FileSystem";
import { MagicTagManager, MagicTagTemplate, MagicTagPreview } from "./MagicTagManager";
import { ProjectService } from "./ProjectService";
import { UuidService } from "./UuidService";
import { AssetLockManager, AssetLockReason } from "../assets/AssetLockManager";
import {
    collectAssetReferences,
    describeBlockedDelete,
    type AssetDeleteOptions,
    type AssetReferenceLookup,
    type AssetReferenceReport,
} from "../assets/assetDeleteGuard";
// Type-only: the reference index scans stories, blueprints, UI documents and characters, several of
// which read assets. A value import here would close that loop; the instance is resolved from the
// service registry at call time instead.
import type { ReferenceService } from "../references/ReferenceService";
import { dirname } from "@shared/utils/path";

interface AssetsEvents {
    deleted: Asset<AssetType, AssetSource>;
    updated: Asset<AssetType, AssetSource>;
    groupsUpdated: { type: AssetType; groupId?: string };
}

const THUMBNAIL_DIMENSION = 160;

export class AssetsService extends Service<AssetsService> implements IAssetService {
    private assetsMetadataManager: AssetsMetadataManager | null = null;
    private assetOrderManager: AssetOrderManager | null = null;
    private localAssetsManager: LocalAssetsManager | null = null;
    private groupAssetsManager: GroupAssetsManager | null = null;
    private remoteAssetsManager: RemoteAssetsManager | null = null;
    private editorRemoteCacheManager: EditorRemoteCacheManager | null = null;
    public imageService: ImageService | null = null;
    public audioService: AudioService | null = null;
    public videoService: VideoService | null = null;
    public jsonService: JSONService | null = null;
    public blueprintService: BlueprintService | null = null;
    public fontService: FontService | null = null;
    public modelService: ModelService | null = null;
    public otherService: OtherService | null = null;
    public fileFormatValidator: FileFormatValidator | null = null;
    private readonly thumbnailCache = new Map<string, string>();

    /**
     * Asset lock manager
     */
    private readonly lockManager = new AssetLockManager();

    /**
     * Event emitter for asset-level changes (added, deleted, updated)
     */
    private readonly events = new EventEmitter<AssetsEvents>();

    /**
     * Transaction batching support
     */
    private batchDepth = 0;
    private dirtyTypes = new Set<AssetType>();
    /** Types whose `assets.order.<type>.json` is behind the shards it orders. */
    private dirtyOrderTypes = new Set<AssetType>();
    private assetsMetadataInitializing = false;

    public getFileFormatValidator(): FileFormatValidator {
        if (!this.fileFormatValidator) {
            throw new RendererError("File format validator not initialized");
        }
        return this.fileFormatValidator;
    }

    /**
     * Get event emitter so UI layer can subscribe
     */
    public getEvents(): EventEmitter<AssetsEvents> {
        return this.events;
    }

    /**
     * Execute a transaction that batches all metadata changes
     */
    public async transaction(
        mutator: (svc: this) => Promise<void> | void,
    ): Promise<void> {
        this.beginBatch();
        try {
            await mutator(this);
        } finally {
            await this.endBatch();
        }
    }

    private beginBatch(): void {
        this.batchDepth += 1;
    }

    private async endBatch(): Promise<void> {
        if (--this.batchDepth > 0) return;
        await this.flushPendingWrites();
    }

    public markDirty(type: AssetType): void {
        this.dirtyTypes.add(type);
        // Adding or removing an asset changes the row order too, and the two live in different files.
        this.dirtyOrderTypes.add(type);
        if (this.batchDepth === 0 && !this.assetsMetadataInitializing) {
            void this.flushPendingWrites();
        }
    }

    /**
     * Queue the sibling order file without rewriting the metadata shard — what a group mutation
     * needs, since it has already written its own shard and only the order has moved.
     */
    public markOrderDirty(type: AssetType): void {
        this.dirtyOrderTypes.add(type);
        if (this.batchDepth === 0 && !this.assetsMetadataInitializing) {
            void this.flushPendingWrites();
        }
    }

    /**
     * Write the metadata shards that changed, and the order files that go with them.
     *
     * Failures used to vanish here: `writeAssetsMetadata` returns an `FsRequestResult` and this
     * dropped it, so a shard that could not be written was still marked clean and the library
     * silently diverged from disk. A rejected shard now stays dirty, so the next mutation retries
     * it, and the failure is reported (SaveStatusService observes the write itself and raises the
     * toast / "Storage" console line).
     */
    private async flushPendingWrites(): Promise<void> {
        if (this.dirtyTypes.size > 0) {
            const types = Array.from(this.dirtyTypes);
            this.dirtyTypes.clear();
            const results = await Promise.all(types.map(async type => ({ type, result: await this.writeAssetsMetadata(type) })));
            for (const { type, result } of results) {
                if (!result.ok) {
                    this.dirtyTypes.add(type);
                    console.warn(`[AssetsService] failed to write ${type} metadata: ${result.error.message}`);
                }
            }
        }

        await this.flushPendingOrderWrites();
    }

    /**
     * An order file names both an asset order and a group order, so it can only be written once both
     * managers are up. Until then the types stay queued rather than being written half-known: an
     * order file claiming a type has no groups would, after the shards are canonicalized, be
     * indistinguishable from one that had recorded their order.
     */
    private async flushPendingOrderWrites(): Promise<void> {
        if (this.dirtyOrderTypes.size === 0 || !this.assetOrderManager || !this.assetsMetadataManager || !this.groupAssetsManager) {
            return;
        }

        const metadataManager = this.assetsMetadataManager;
        const groupManager = this.groupAssetsManager;
        const orderManager = this.assetOrderManager;
        const types = Array.from(this.dirtyOrderTypes);
        this.dirtyOrderTypes.clear();

        const results = await Promise.all(types.map(async type => ({
            type,
            result: await orderManager.write(type, metadataManager.listOrdered(type), groupManager.listOrderedGroups(type)),
        })));
        for (const { type, result } of results) {
            if (!result.ok) {
                this.dirtyOrderTypes.add(type);
                console.warn(`[AssetsService] failed to write ${type} asset order: ${result.error.message}`);
            }
        }
    }

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const filesystemService = ctx.services.get<FileSystemService>(Services.FileSystem);
        const projectService = ctx.services.get<ProjectService>(Services.Project);
        const uuidService = ctx.services.get<UuidService>(Services.Uuid);
        await depend([filesystemService, projectService, uuidService]);

        // Initialize all asset services
        this.imageService = new ImageService(ctx);
        this.audioService = new AudioService(ctx);
        this.videoService = new VideoService(ctx);
        this.jsonService = new JSONService(ctx);
        this.blueprintService = new BlueprintService(ctx);
        this.fontService = new FontService(ctx);
        this.modelService = new ModelService(ctx);
        this.otherService = new OtherService(ctx);

        // Initialize file format validator
        this.fileFormatValidator = new FileFormatValidator();
        
        // Before the shard managers: each of them reads its half of the row order from here, and a
        // project that has no order file yet must fall back to its shards' key order, which is only
        // still the author's order for as long as nothing has rewritten those shards.
        this.assetOrderManager = await new AssetOrderManager(ctx).init();

        const assetsMetadataManager = new AssetsMetadataManager(this, ctx);
        this.assetsMetadataManager = assetsMetadataManager;
        this.assetsMetadataInitializing = true;
        try {
            await assetsMetadataManager.init();
        } catch (error) {
            this.assetsMetadataManager = null;
            this.dirtyTypes.clear();
            this.dirtyOrderTypes.clear();
            throw error;
        } finally {
            this.assetsMetadataInitializing = false;
        }
        await this.flushPendingWrites();

        this.groupAssetsManager = await new GroupAssetsManager(this, ctx).init();

        // Both halves are known now, so the order recovered from key order can be committed. This is
        // the migration for a project that predates the order file, and it has to happen on this
        // open: once a shard is rewritten with sorted keys there is nothing left to recover from.
        for (const type of this.assetOrderManager.listMissingTypes()) {
            this.dirtyOrderTypes.add(type);
        }
        await this.flushPendingWrites();

        this.localAssetsManager = await new LocalAssetsManager(this, ctx).init();
        this.editorRemoteCacheManager = await new EditorRemoteCacheManager(ctx).init();
        await this.ensureThumbnailRoot();
        this.remoteAssetsManager = await new RemoteAssetsManager(this, ctx, this.editorRemoteCacheManager).init();
    }

    public getAssetOrderManager(): AssetOrderManager {
        if (!this.assetOrderManager) {
            throw new RendererError("Asset order manager not initialized");
        }
        return this.assetOrderManager;
    }

    public getAssetsMetadataManager(): AssetsMetadataManager {
        if (!this.assetsMetadataManager) {
            throw new RendererError("Assets metadata manager not initialized");
        }
        return this.assetsMetadataManager;
    }

    public getGroupAssetsManager(): GroupAssetsManager {
        if (!this.groupAssetsManager) {
            throw new RendererError("Group assets manager not initialized");
        }
        return this.groupAssetsManager;
    }

    public getRemoteAssetsManager(): RemoteAssetsManager {
        if (!this.remoteAssetsManager) {
            throw new RendererError("Remote assets manager not initialized");
        }
        return this.remoteAssetsManager;
    }

    public getEditorRemoteCacheManager(): EditorRemoteCacheManager {
        if (!this.editorRemoteCacheManager) {
            throw new RendererError("Editor remote cache manager not initialized");
        }
        return this.editorRemoteCacheManager;
    }

    public getLocalAssetsManager(): LocalAssetsManager {
        if (!this.localAssetsManager) {
            throw new RendererError("Local assets manager not initialized");
        }
        return this.localAssetsManager;
    }

    public getAssets(): AssetsMap {
        return this.getAssetsMetadataManager().getAssets();
    }

    /**
     * Assets of `type` in browser order. Prefer this over `Object.values(getAssets()[type])`, whose
     * key order stops being the author's the moment a shard is written with sorted keys.
     */
    public getOrderedAssets<T extends AssetType>(type: T): Asset<T, AssetSource>[] {
        return this.getAssetsMetadataManager().getOrderedAssets(type);
    }

    public list<T extends AssetType>(type: T): string[] {
        return this.getAssetsMetadataManager().list(type);
    }

    public exists<T extends AssetType>(asset: Asset<T, AssetSource>): boolean {
        return this.getAssetsMetadataManager().exists(asset);
    }

    public async fetch<T extends AssetType>(asset: Asset<T, AssetSource>): Promise<RequestStatus<AssetData<T>>> {
        if (asset.source === AssetSource.Remote) {
            return this.getRemoteAssetsManager().fetch(asset as Asset<T, AssetSource.Remote>);
        }
        return this.getLocalAssetsManager().fetch(asset as Asset<T, AssetSource.Local>);
    }

    public async importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        return this.getLocalAssetsManager().importLocalAssets(type);
    }

    public async importRemoteAsset<T extends AssetType>(type: T, url: string): Promise<RequestStatus<Asset<T, AssetSource.Remote>>> {
        return this.getRemoteAssetsManager().importRemoteAsset(type, url);
    }

    public async clearRemoteCache(assetId?: string): Promise<void> {
        await this.getEditorRemoteCacheManager().evict(assetId);
    }

    public async getThumbnailPath(asset: Asset): Promise<RequestStatus<string>> {
        if (asset.type !== AssetType.Image) {
            return { success: false, error: "Thumbnails are only supported for image assets" };
        }

        const cachePath = this.getThumbnailCachePath(asset.id);
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const existing = await fs.isFileExists(cachePath);
        if (existing.ok && existing.data) {
            this.thumbnailCache.set(asset.id, cachePath);
            return { success: true, data: cachePath };
        }

        if (!this.imageService) {
            return { success: false, error: "Image service is not initialized" };
        }

        const imageResult = await this.imageService.readLocalImage(asset as Asset<AssetType.Image>);
        if (!imageResult.success || !imageResult.data) {
            return { success: false, error: imageResult.error ?? "Failed to read source image" };
        }

        const thumbnailBuffer = await this.createThumbnailBuffer(imageResult.data.data);
        await this.ensureThumbnailDir(cachePath);
        const writeResult = await fs.writeRaw(cachePath, thumbnailBuffer);
        if (!writeResult.ok) {
            return { success: false, error: writeResult.error?.message };
        }

        this.thumbnailCache.set(asset.id, cachePath);
        return { success: true, data: cachePath };
    }

    public async clearThumbnailCache(assetId?: string): Promise<void> {
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        if (assetId) {
            this.thumbnailCache.delete(assetId);
            const cachePath = this.getThumbnailCachePath(assetId);
            const exists = await fs.isFileExists(cachePath);
            if (exists.ok && exists.data) {
                await fs.deleteFile(cachePath);
            }
            return;
        }

        this.thumbnailCache.clear();
        const root = this.getThumbnailCacheRoot();
        const exists = await fs.isDirExists(root);
        if (exists.ok && exists.data) {
            await fs.deleteDir(root);
        }
    }

    private getThumbnailCacheRoot(): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorThumbnailCache);
    }

    private getThumbnailCachePath(assetId: string): string {
        return this.getContext().project.resolve(ProjectNameConvention.EditorThumbnailCacheShard(assetId));
    }

    private async ensureThumbnailRoot(): Promise<void> {
        const root = this.getThumbnailCacheRoot();
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const exists = await fs.isDirExists(root);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access thumbnail cache root");
        }
        if (!exists.data) {
            const created = await fs.createDir(root);
            if (!created.ok) {
                throw new RendererError(created.error?.message || "Failed to create thumbnail cache root");
            }
        }
    }

    private async ensureThumbnailDir(path: string): Promise<void> {
        const dir = dirname(path);
        const fs = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const exists = await fs.isDirExists(dir);
        if (!exists.ok) {
            throw new RendererError(exists.error?.message || "Failed to access thumbnail cache directory");
        }
        if (!exists.data) {
            const created = await fs.createDir(dir);
            if (!created.ok) {
                throw new RendererError(created.error?.message || "Failed to create thumbnail cache directory");
            }
        }
    }

    private async createThumbnailBuffer(buffer: Uint8Array): Promise<Uint8Array> {
        if (typeof document === "undefined" && typeof OffscreenCanvas === "undefined") {
            throw new RendererError("Thumbnail generation requires a document or OffscreenCanvas context");
        }

        const bufferSource = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
        const blob = new Blob([bufferSource]);
        const bitmap = await createImageBitmap(blob);
        const canvas = this.createCanvas();
        const context = canvas.getContext("2d");
        if (!context) {
            bitmap.close();
            throw new RendererError("Failed to acquire canvas context for thumbnail rendering");
        }

        const width = bitmap.width;
        const height = bitmap.height;
        const ratio = Math.min(THUMBNAIL_DIMENSION / width, THUMBNAIL_DIMENSION / height, 1);
        const drawWidth = width * ratio;
        const drawHeight = height * ratio;
        const offsetX = (THUMBNAIL_DIMENSION - drawWidth) / 2;
        const offsetY = (THUMBNAIL_DIMENSION - drawHeight) / 2;

        context.clearRect(0, 0, THUMBNAIL_DIMENSION, THUMBNAIL_DIMENSION);
        context.drawImage(bitmap, offsetX, offsetY, drawWidth, drawHeight);
        bitmap.close();

        return this.canvasToUint8Array(canvas);
    }

    private createCanvas(): HTMLCanvasElement | OffscreenCanvas {
        if (typeof OffscreenCanvas !== "undefined") {
            return new OffscreenCanvas(THUMBNAIL_DIMENSION, THUMBNAIL_DIMENSION);
        }

        const canvas = document.createElement("canvas");
        canvas.width = THUMBNAIL_DIMENSION;
        canvas.height = THUMBNAIL_DIMENSION;
        return canvas;
    }

    private async canvasToUint8Array(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Uint8Array> {
        if (typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas) {
            const blob = await canvas.convertToBlob({ type: "image/png" });
            const buffer = await blob.arrayBuffer();
            return new Uint8Array(buffer);
        }

        return await new Promise<Uint8Array>((resolve, reject) => {
            const domCanvas = canvas as HTMLCanvasElement;
            domCanvas.toBlob(async (blob) => {
                if (!blob) {
                    reject(new RendererError("Failed to encode thumbnail"));
                    return;
                }
                const buffer = await blob.arrayBuffer();
                resolve(new Uint8Array(buffer));
            }, "image/png");
        });
    }

    private async writeAssetsMetadata(type: AssetType): Promise<FsRequestResult<void>> {
        const metadata = this.getAssetsMetadataManager().getAssets();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data = JSON.stringify(metadata[type]);

        return await filesystemService.writeFileNoFollow(this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type)), data, "utf-8");
    }

    public async createGroup<T extends AssetType>(
        type: T,
        name: string,
        parentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        return this.getGroupAssetsManager().createGroup(type, name, parentGroupId);
    }

    /**
     * Delete a group and everything it contains.
     *
     * The reference check happens here, at the enumeration stage, over every asset the cascade would
     * remove — including the contents of nested groups. Checking per asset inside the cascade would
     * be too late: by the time the third file was refused the first two would already be gone.
     */
    public async deleteGroup<T extends AssetType>(
        type: T,
        groupId: string,
        recursive: boolean = false,
        options?: AssetDeleteOptions,
    ): Promise<RequestStatus<void>> {
        const groupManager = this.getGroupAssetsManager();
        const blocked = await this.findDeleteBlocker(groupManager.collectGroupAssets(type, groupId, recursive), options);
        if (blocked) {
            return { success: false, error: blocked };
        }

        // Cleared as a set above; the per-asset guard inside the cascade would only re-ask the same
        // question once per file.
        return groupManager.deleteGroup(type, groupId, recursive, { allowReferenced: true });
    }

    public async renameGroup<T extends AssetType>(
        type: T,
        groupId: string,
        newName: string
    ): Promise<RequestStatus<AssetGroup>> {
        return this.getGroupAssetsManager().renameGroup(type, groupId, newName);
    }

    public async moveGroupToParent<T extends AssetType>(
        type: T,
        groupId: string,
        newParentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        return this.getGroupAssetsManager().moveGroupToParent(type, groupId, newParentGroupId);
    }

    public async moveAssetToGroup<T extends AssetType>(
        asset: Asset<T>,
        groupId?: string
    ): Promise<RequestStatus<void>> {
        return this.getGroupAssetsManager().moveAssetToGroup(asset, groupId);
    }

    public async duplicateGroup<T extends AssetType>(
        type: T,
        groupId: string,
        newParentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        return this.getGroupAssetsManager().duplicateGroup(type, groupId, newParentGroupId);
    }

    // Metadata management APIs
    public async updateAssetTags<T extends AssetType>(
        asset: Asset<T>,
        tags: string[]
    ): Promise<RequestStatus<void>> {
        return this.getAssetsMetadataManager().updateAssetTags(asset, tags);
    }

    public async updateAssetDescription<T extends AssetType>(
        asset: Asset<T>,
        description: string
    ): Promise<RequestStatus<void>> {
        return this.getAssetsMetadataManager().updateAssetDescription(asset, description);
    }

    /** Merge editor-authored extras (cue points…) into the asset record. */
    public async patchAssetExtras<T extends AssetType>(
        asset: Asset<T>,
        patch: Partial<AssetExtras>,
    ): Promise<RequestStatus<void>> {
        return this.getAssetsMetadataManager().patchAssetExtras(asset, patch);
    }

    public async renameAsset<T extends AssetType>(
        asset: Asset<T>,
        newName: string
    ): Promise<RequestStatus<void>> {
        return this.getAssetsMetadataManager().renameAsset(asset, newName);
    }

    /**
     * The reverse lookup behind the delete guard, exposed so the panel can draw its warning from the
     * same reading the guard enforces — two independent lookups would eventually disagree, and the
     * one the author sees is not the one that decides.
     */
    public async findAssetReferences(assetIds: readonly string[]): Promise<AssetReferenceReport> {
        return collectAssetReferences(this.getReferenceLookup(), assetIds);
    }

    /**
     * The reference index, or null when it is not registered in this workspace. Resolved at call
     * time rather than at init: the index scans stories, blueprints, UI documents and characters,
     * several of which read assets, so depending on it here would be a cycle.
     */
    private getReferenceLookup(): AssetReferenceLookup | null {
        try {
            return this.getContext().services.get<ReferenceService>(Services.Reference) ?? null;
        } catch {
            return null;
        }
    }

    /**
     * The guard itself: the single point every delete passes through.
     *
     * It used to live in `useAssetActions`, which meant a group cascade — and any programmatic
     * delete — walked straight past it. Semantics per the ruling: block by default, and let a caller
     * that has actually asked the author come through with `allowReferenced`. The service never
     * shows UI; it only refuses.
     *
     * Returns the reason to refuse, or null to proceed.
     */
    private async findDeleteBlocker(
        assets: readonly Asset<AssetType, AssetSource>[],
        options?: AssetDeleteOptions,
    ): Promise<string | null> {
        if (options?.allowReferenced || assets.length === 0) {
            return null;
        }

        const report = await this.findAssetReferences(assets.map(asset => asset.id));
        if (report.checked && report.references.size === 0) {
            return null;
        }
        return describeBlockedDelete(report, new Map(assets.map(asset => [asset.id, asset.name])));
    }

    // Asset operations
    public async deleteAsset<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        options?: AssetDeleteOptions,
    ): Promise<RequestStatus<void>> {
        const blocked = await this.findDeleteBlocker([asset], options);
        if (blocked) {
            return { success: false, error: blocked };
        }

        let result: RequestStatus<void>;
        if (asset.source === AssetSource.Remote) {
            result = await this.getRemoteAssetsManager().deleteAsset(asset as Asset<T, AssetSource.Remote>);
        } else {
            result = await this.getLocalAssetsManager().deleteAsset(asset as Asset<T, AssetSource.Local>);
        }

        if (result.success) {
            try {
                await this.clearThumbnailCache(asset.id);
            } catch (error) {
                console.warn(`Failed to clear thumbnail cache for asset: ${asset.id}`, error);
            }
        }

        return result;
    }

    /**
     * Swap the bytes behind an existing asset, keeping its id.
     *
     * References store the asset id, never a path, so every place that pointed at this asset follows
     * automatically — that is the whole point of replacing rather than importing-and-relinking.
     *
     * The four steps below have to happen in this order, and three of them had no caller at all
     * before this method existed:
     *
     *  1. write the new bytes (`LocalAssetsManager.writeAssetContentFromPath`);
     *  2. recompute `hash` — it used to be written once at import and never again, while several
     *     readers use it as the cache key deciding whether to re-read the file;
     *  3. drop the cached thumbnail PNG, which is keyed by asset id and would otherwise survive the
     *     swap and keep every grid tile showing the old picture;
     *  4. write the record, then announce `updated` — last, so nobody wakes up and re-reads a stale
     *     thumbnail that step 3 was about to delete.
     *
     * There is no asset-level history: this cannot be undone. The UI expresses that with the button
     * hierarchy on the confirm, not with a sentence.
     */
    public async replaceAssetContent<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        sourcePath: string,
    ): Promise<RequestStatus<Asset<T, AssetSource>>> {
        if (asset.source !== AssetSource.Local) {
            return { success: false, error: "Replacing the contents of a remote asset is not supported" };
        }

        const written = await this.getLocalAssetsManager()
            .writeAssetContentFromPath(asset as Asset<T, AssetSource.Local>, sourcePath);
        if (!written.success || !written.data) {
            return { success: false, error: written.error };
        }

        try {
            await this.clearThumbnailCache(asset.id);
        } catch (error) {
            console.warn(`Failed to clear thumbnail cache for asset: ${asset.id}`, error);
        }

        const applied = this.getAssetsMetadataManager().applyReplacedContent(asset, written.data);
        if (!applied.success || !applied.data) {
            return { success: false, error: applied.error };
        }

        this.getEvents().emit("updated", applied.data);

        return { success: true, data: applied.data };
    }

    /**
     * Duplicate an existing asset, returning the new asset metadata.
     */
    public async duplicateAsset<T extends AssetType>(asset: Asset<T, AssetSource>): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        if (asset.source !== AssetSource.Local) {
            return { success: false, error: "Duplicating remote assets is not supported" };
        }
        return this.getLocalAssetsManager().duplicateAsset(asset as Asset<T, AssetSource.Local>);
    }

    public async importFromPaths<T extends AssetType>(
        type: T,
        paths: string[],
        options?: ImportFromPathsOptions,
    ): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        return this.getLocalAssetsManager().importFromPaths(type, paths, options);
    }

    /**
     * Expand dropped paths (files and/or directories) into the concrete files to import for the
     * given asset type. Directories are walked recursively and filtered by extension; plain files
     * pass through unchanged. See {@link LocalAssetsManager.expandImportPaths}.
     */
    public async expandImportPaths<T extends AssetType>(
        type: T,
        paths: string[]
    ): Promise<ExpandImportPathsResult> {
        return this.getLocalAssetsManager().expandImportPaths(type, paths);
    }

    // Magic Tag functionality
    /**
     * Analyze filenames and generate a magic tag template (auto-detect mode)
     * @param filenames Array of filenames to analyze
     * @returns Magic tag template with detected delimiters
     */
    public analyzeMagicTags(filenames: string[]): MagicTagTemplate {
        return MagicTagManager.analyzeFilenames(filenames);
    }

    /**
     * Analyze filenames using a regular expression (regex mode)
     * @param filenames Array of filenames to analyze
     * @param regexPattern Regular expression with named capture groups
     * @returns Magic tag template with regex pattern
     */
    public analyzeMagicTagsWithRegex(
        filenames: string[],
        regexPattern: string
    ): MagicTagTemplate {
        return MagicTagManager.analyzeWithRegex(filenames, regexPattern);
    }

    /**
     * Generate tag preview based on user's category mapping
     * @param template Magic tag template
     * @param categoryMapping Map from segment index to category name
     * @returns Array of previews for each file
     */
    public generateMagicTagPreview(
        template: MagicTagTemplate,
        categoryMapping: Record<number, string>
    ): MagicTagPreview[] {
        return MagicTagManager.generatePreview(template, categoryMapping);
    }

    // Asset Lock Management APIs

    /**
     * Lock an asset with a specific reason
     */
    public lockAsset(assetId: string, reason: AssetLockReason, metadata?: Record<string, any>): void {
        this.lockManager.lock(assetId, reason, metadata);
    }

    /**
     * Unlock an asset for a specific reason
     */
    public unlockAsset(assetId: string, reason: AssetLockReason, metadata?: Record<string, any>): void {
        this.lockManager.unlock(assetId, reason, metadata);
    }

    /**
     * Check if an asset is locked
     */
    public isAssetLocked(assetId: string): boolean {
        return this.lockManager.isLocked(assetId);
    }

    /**
     * Get all locks on an asset
     */
    public getAssetLocks(assetId: string): string[] {
        return this.lockManager.getLockReasons(assetId);
    }

    /**
     * Get a formatted lock message for an asset
     */
    public getAssetLockMessage(assetId: string): string | null {
        return this.lockManager.getLockMessage(assetId);
    }

    /**
     * Get the lock manager instance (for internal service use)
     */
    public getLockManager(): AssetLockManager {
        return this.lockManager;
    }
}
