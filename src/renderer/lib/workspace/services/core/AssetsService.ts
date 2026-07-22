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
import { BlueprintService } from "../assets/BlueprintService";
import { AssetsMetadataManager } from "../assets/mgr/AssetsMetadataManager";
import { EditorRemoteCacheManager } from "../assets/mgr/EditorRemoteCacheManager";
import { GroupAssetsManager } from "../assets/mgr/GroupAssetsManager";
import { LocalAssetsManager } from "../assets/mgr/LocalAssetsManager";
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
import { dirname } from "@shared/utils/path";

interface AssetsEvents {
    deleted: Asset<AssetType, AssetSource>;
    updated: Asset<AssetType, AssetSource>;
    groupsUpdated: { type: AssetType; groupId?: string };
}

const THUMBNAIL_DIMENSION = 160;

export class AssetsService extends Service<AssetsService> implements IAssetService {
    private assetsMetadataManager: AssetsMetadataManager | null = null;
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
        if (this.batchDepth === 0 && !this.assetsMetadataInitializing) {
            void this.flushPendingWrites();
        }
    }

    private async flushPendingWrites(): Promise<void> {
        if (this.dirtyTypes.size === 0) return;
        const types = Array.from(this.dirtyTypes);
        this.dirtyTypes.clear();
        await Promise.all(types.map(type => this.writeAssetsMetadata(type)));
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
        this.otherService = new OtherService(ctx);

        // Initialize file format validator
        this.fileFormatValidator = new FileFormatValidator();
        
        const assetsMetadataManager = new AssetsMetadataManager(this, ctx);
        this.assetsMetadataManager = assetsMetadataManager;
        this.assetsMetadataInitializing = true;
        try {
            await assetsMetadataManager.init();
        } catch (error) {
            this.assetsMetadataManager = null;
            this.dirtyTypes.clear();
            throw error;
        } finally {
            this.assetsMetadataInitializing = false;
        }
        await this.flushPendingWrites();

        this.groupAssetsManager = await new GroupAssetsManager(this, ctx).init();
        this.localAssetsManager = await new LocalAssetsManager(this, ctx).init();
        this.editorRemoteCacheManager = await new EditorRemoteCacheManager(ctx).init();
        await this.ensureThumbnailRoot();
        this.remoteAssetsManager = await new RemoteAssetsManager(this, ctx, this.editorRemoteCacheManager).init();
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

    public async deleteGroup<T extends AssetType>(
        type: T, 
        groupId: string, 
        recursive: boolean = false
    ): Promise<RequestStatus<void>> {
        return this.getGroupAssetsManager().deleteGroup(type, groupId, recursive);
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

    // Asset operations
    public async deleteAsset<T extends AssetType>(
        asset: Asset<T, AssetSource>
    ): Promise<RequestStatus<void>> {
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
        paths: string[]
    ): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        return this.getLocalAssetsManager().importFromPaths(type, paths);
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
