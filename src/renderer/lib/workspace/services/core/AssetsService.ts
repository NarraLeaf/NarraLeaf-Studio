import { RendererError } from "@shared/utils/error";
import { ProjectNameConvention } from "../../project/nameConvention";
import { AssetData, AssetExtensions, AssetType } from "../assets/assetTypes";
import { Asset, AssetsMap, AssetSource, AssetGroupMap, AssetGroup } from "../assets/types";
import { Service } from "../Service";
import { IAssetService, Services, WorkspaceContext } from "../services";
import { FileSystemService } from "./FileSystem";
import { ProjectService } from "./ProjectService";
import { ImageService } from "../assets/ImageService";
import { AudioService } from "../assets/AudioService";
import { VideoService } from "../assets/VideoService";
import { JSONService } from "../assets/JSONService";
import { FontService } from "../assets/FontService";
import { OtherService } from "../assets/OtherService";
import { FileFormatValidator } from "../assets/FileFormatValidator";
import { RequestStatus } from "@shared/types/ipcEvents";
import { getInterface } from "@/lib/app/bridge";
import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { basename, dirname } from "@shared/utils/path";
import { EventEmitter } from "../ui/EventEmitter";

interface AssetsEvents {
    deleted: Asset;
    updated: Asset;
}

export class AssetsService extends Service<AssetsService> implements IAssetService {
    private assetsMetadata: AssetsMap | null = null;
    private assetsGroups: AssetGroupMap | null = null;
    private imageService: ImageService | null = null;
    private audioService: AudioService | null = null;
    private videoService: VideoService | null = null;
    private jsonService: JSONService | null = null;
    private fontService: FontService | null = null;
    private otherService: OtherService | null = null;
    private fileFormatValidator: FileFormatValidator | null = null;

    /**
     * Event emitter for asset-level changes (added, deleted, updated)
     */
    private readonly events = new EventEmitter<AssetsEvents>();

    /**
     * Transaction batching support
     */
    private batchDepth = 0;
    private dirtyTypes = new Set<AssetType>();

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

    private markDirty(type: AssetType): void {
        this.dirtyTypes.add(type);
        if (this.batchDepth === 0) {
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
        await depend([filesystemService, projectService]);

        // Initialize all asset services
        this.imageService = new ImageService(filesystemService);
        this.audioService = new AudioService(filesystemService);
        this.videoService = new VideoService(filesystemService);
        this.jsonService = new JSONService(filesystemService);
        this.fontService = new FontService(filesystemService);
        this.otherService = new OtherService(filesystemService);

        // Initialize file format validator
        this.fileFormatValidator = new FileFormatValidator();
        
        this.assetsMetadata = await this.fetchAssetsMetadata();
        this.assetsGroups = await this.fetchAssetsGroups();
    }

    public getAssets(): AssetsMap {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return this.assetsMetadata;
    }

    public getMetadata<T extends AssetType>(type: T, name: string): Asset<T> {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return this.assetsMetadata[type][name];
    }

    public list<T extends AssetType>(type: T): string[] {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return Object.keys(this.assetsMetadata[type]);
    }

    public exists<T extends AssetType>(asset: Asset<T>): boolean {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return this.assetsMetadata[asset.type][asset.id] !== undefined;
    }

    public async fetch<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<AssetData<T>>> {
        if (asset.source === AssetSource.Local) {
            const path = this.getLocalAssetPath(asset.id);
            switch (asset.type) {
                case AssetType.Image:
                    if (!this.imageService) {
                        throw new RendererError("Image service not initialized");
                    }
                    return await this.imageService.readLocalImage(path) as RequestStatus<AssetData<T>>;
                case AssetType.Audio:
                    if (!this.audioService) {
                        throw new RendererError("Audio service not initialized");
                    }
                    return await this.audioService.readLocalAudio(path) as RequestStatus<AssetData<T>>;
                case AssetType.Video:
                    if (!this.videoService) {
                        throw new RendererError("Video service not initialized");
                    }
                    return await this.videoService.readLocalVideo(path) as RequestStatus<AssetData<T>>;
                case AssetType.JSON:
                    if (!this.jsonService) {
                        throw new RendererError("JSON service not initialized");
                    }
                    return await this.jsonService.readLocalJSON(path) as RequestStatus<AssetData<T>>;
                case AssetType.Font:
                    if (!this.fontService) {
                        throw new RendererError("Font service not initialized");
                    }
                    return await this.fontService.readLocalFont(path) as RequestStatus<AssetData<T>>;
                case AssetType.Other:
                    if (!this.otherService) {
                        throw new RendererError("Other service not initialized");
                    }
                    return await this.otherService.readLocalOther(path) as RequestStatus<AssetData<T>>;
                default:
                    return {
                        success: false,
                        error: `Failed to fetch asset: ${asset.id}. Type "${asset.type}" is not supported.`,
                    };
            }
        }

        return {
            success: false,
            error: `Failed to fetch asset: ${asset.id}. Source "${asset.source}" is not supported.`,
        };
    }

    public async importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        const assetExtensions = AssetExtensions[type];
        const files = await getInterface().fs.selectFile(assetExtensions, true);
        if (!files.success || !files.data.ok) {
            return {
                success: false,
                error: `Failed to select files: ${files.error || (`[${(files.data as FsRequestResult<string[], false>)?.error.code}] ${(files.data as FsRequestResult<string[], false>)?.error.message}`)}`,
            };
        }

        const results: RequestStatus<Asset<T, AssetSource.Local>>[] = [];
        for (const file of files.data.data) {
            results.push(await this.importLocalAsset(type, file));
        }

        this.markDirty(type);

        return {
            success: true,
            data: results,
        };
    }

    /**
     * Still in development.  
     * Check the integrity of the assets. This is a heavy operation. 
     */
    public async checkIntegrity(): Promise<FsRequestResult<void, false>[]> {
        const results: FsRequestResult<void, false>[] = [];

        for (const type of Object.values(AssetType)) {
            const assetIds = this.list(type);
            for (const assetId of assetIds) {
                const asset = this.assetsMetadata![type][assetId];
                if (!asset) {
                    results.push({
                        ok: false,
                        error: {
                            code: FsRejectErrorCode.UNKNOWN,
                            message: `Asset not found: ${assetId}`,
                        },
                    });
                    continue;
                }

                const dest = this.getLocalAssetPath(asset.id);
                const hashResult = await getInterface().fs.hash(dest);
                if (!hashResult.success) {
                    results.push({
                        ok: false,
                        error: {
                            code: FsRejectErrorCode.UNKNOWN,
                            message: `Failed to hash asset: ${dest}. ${hashResult.error}`,
                        },
                    });
                    continue;
                }
                if (!hashResult.data.ok) {
                    results.push(hashResult.data);
                    continue;
                }
                const computedHash = (hashResult.data as FsRequestResult<string, true>).data;
                if (computedHash !== asset.hash) {
                    results.push({
                        ok: false,
                        error: {
                            code: FsRejectErrorCode.HASH_MISMATCH,
                            message: `Hash mismatch for asset: ${dest}. Expected ${asset.hash} got ${computedHash}`,
                        },
                    });
                }
            }
        }

        return results;
    }

    private async importLocalAsset<T extends AssetType>(type: T, path: string): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        // Validate file format before importing
        const formatValidation = await this.validateFileFormat(type, path);
        if (!formatValidation.success) {
            return {
                success: false,
                error: formatValidation.error || "File format validation failed",
            };
        }

        // compute file hash for info only
        const hashResult = await getInterface().fs.hash(path);
        const fileHash = hashResult.success && hashResult.data.ok ? hashResult.data.data : "";

        // generate unique id for storage / indexing
        const id = crypto.randomUUID();

        // resolve unique display name (e.g. "image.png", "image-1.png")
        const originalName = basename(path);
        const uniqueName = this.resolveUniqueAssetName(type, originalName);

        // construct asset metadata
        const asset: Asset<T, AssetSource.Local> = {
            id,
            type,
            name: uniqueName,
            hash: fileHash,
            source: AssetSource.Local,
            meta: {},
            tags: [],
            description: "",
        };

        // copy asset to local directory using id as filename
        const destPath = this.getLocalAssetPath(id);

        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const existCheck = await fsService.isFileExists(destPath);
        if (!existCheck.ok) {
            return {
                success: false,
                error: `Failed to check existing asset file: ${existCheck.error?.message}`,
            } as RequestStatus<Asset<T, AssetSource.Local>>;
        }

        this.assertMetadata();
        const record: Record<string, Asset<T, AssetSource.Local>> = this.assetsMetadata![type];
        if (record[id]) {
            return {
                success: true,
                data: record[id] as Asset<T, AssetSource.Local>,
            };
        }

        if (!existCheck.data) {
            // Ensure destination directory exists
            const destDir = dirname(destPath);
            const dirExistCheck = await fsService.isDirExists(destDir);
            if (!dirExistCheck.ok) {
                return {
                    success: false,
                    error: `Failed to check destination directory: ${dirExistCheck.error?.message}`,
                } as RequestStatus<Asset<T, AssetSource.Local>>;
            }

            if (!dirExistCheck.data) {
                const mkdirResult = await fsService.createDir(destDir);
                if (!mkdirResult.ok) {
                    return {
                        success: false,
                        error: `Failed to create destination directory: ${destDir}. ${mkdirResult.error?.message}`,
                    };
                }
            }

            const copyResult = await getInterface().fs.copyFile(path, destPath);
            if (!copyResult.success || !copyResult.data.ok) {
                const message = copyResult.error
                    || (`[${(copyResult.data as FsRequestResult<void, false>)?.error.code}] ${(copyResult.data as FsRequestResult<void, false>)?.error.message}`);
                return {
                    success: false,
                    error: `Failed to copy asset: ${path} to ${destPath}. ${message}`,
                };
            }
        }

        // update assets metadata
        record[id] = asset;

        return {
            success: true,
            data: asset,
        };
    }

    /**
     * Ensure asset display name is unique within given type. Append "-n" if duplicate.
     */
    private resolveUniqueAssetName<T extends AssetType>(type: T, originalName: string): string {
        this.assertMetadata();
        const record = this.assetsMetadata![type];
        const existingNames = new Set(Object.values(record).map(a => a.name));

        if (!existingNames.has(originalName)) {
            return originalName;
        }

        const extIndex = originalName.lastIndexOf('.');
        const base = extIndex !== -1 ? originalName.slice(0, extIndex) : originalName;
        const ext = extIndex !== -1 ? originalName.slice(extIndex) : '';

        let counter = 1;
        let candidate = `${base}-${counter}${ext}`;
        while (existingNames.has(candidate)) {
            counter += 1;
            candidate = `${base}-${counter}${ext}`;
        }
        return candidate;
    }

    private getLocalAssetPath(name: string): string {
        return this.getContext().project.resolve(ProjectNameConvention.AssetsDataShard(name));
    }

    private async fetchAssetsMetadata(): Promise<AssetsMap> {
        // Initialize assets metadata
        await this.initAssetsMetadata();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data: AssetsMap = {
            [AssetType.Image]: {},
            [AssetType.Audio]: {},
            [AssetType.Video]: {},
            [AssetType.JSON]: {},
            [AssetType.Font]: {},
            [AssetType.Other]: {},
        };

        for (const type of Object.values(AssetType)) {
            const shardPath = this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type));
            const shardResult = await filesystemService.readJSON<Record<string, Asset>>(shardPath);
            if (shardResult.ok) {
                Object.assign(data[type], shardResult.data);
            } else {
                // readJSON failed (file missing or invalid JSON) – attempt manual recovery
                const rawResult = await filesystemService.read(shardPath, "utf-8");
                let parsed: Record<string, Asset> | null = null;
                if (rawResult.ok) {
                    try {
                        parsed = JSON.parse(rawResult.data);
                    } catch {
                        parsed = null;
                    }
                }

                if (parsed) {
                    Object.assign(data[type], parsed);
                } else {
                    console.warn(`AssetsService: metadata shard corrupted, backing up and resetting: ${shardPath}`);
                    // Backup corrupted file
                    await filesystemService.copyFile(shardPath, `${shardPath}.bak`);
                    // Overwrite with empty object
                    await filesystemService.write(shardPath, JSON.stringify({}), "utf-8");
                }
            }
        }

        return data;
    }

    private async writeAssetsMetadata(type: AssetType): Promise<FsRequestResult<void>> {
        this.assertMetadata();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data = JSON.stringify(this.assetsMetadata![type]);

        return await filesystemService.write(this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type)), data, "utf-8");
    }

    private async initAssetsMetadata(): Promise<void> {
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const files = [
            AssetType.Image, AssetType.Audio, AssetType.Video, AssetType.JSON, AssetType.Font, AssetType.Other,
        ].map(type => this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type)));

        const tasks = files.map(async file => {
            const existsResult = await filesystemService.isFileExists(file);
            if (!existsResult.ok || !existsResult.data) {
                return filesystemService.write(file, JSON.stringify({}), "utf-8");
            }
            return { ok: true, data: void 0 } satisfies FsRequestResult<void, true>;
        });
        const results = await Promise.all(tasks);
        if (results.some(result => !result.ok)) {
            throw new RendererError(`Failed to read assets metadata shards`);
        }
    }

    private async fetchAssetsGroups(): Promise<AssetGroupMap> {
        // Initialize assets groups
        await this.initAssetsGroups();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data: AssetGroupMap = {
            [AssetType.Image]: {},
            [AssetType.Audio]: {},
            [AssetType.Video]: {},
            [AssetType.JSON]: {},
            [AssetType.Font]: {},
            [AssetType.Other]: {},
        };

        for (const type of Object.values(AssetType)) {
            const shardPath = this.getContext().project.resolve(ProjectNameConvention.AssetsGroupsShard(type));
            const shardResult = await filesystemService.readJSON<Record<string, AssetGroup>>(shardPath);
            if (shardResult.ok) {
                Object.assign(data[type], shardResult.data);
            } else {
                throw new RendererError(`Failed to read assets groups shard: ${shardPath}`);
            }
        }

        return data;
    }

    private async initAssetsGroups(): Promise<void> {
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const files = [
            AssetType.Image, AssetType.Audio, AssetType.Video, AssetType.JSON, AssetType.Font, AssetType.Other,
        ].map(type => this.getContext().project.resolve(ProjectNameConvention.AssetsGroupsShard(type)));

        const tasks = files.map(async file => {
            const existsResult = await filesystemService.isFileExists(file);
            if (!existsResult.ok || !existsResult.data) {
                return filesystemService.write(file, JSON.stringify({}), "utf-8");
            }
            return { ok: true, data: void 0 } satisfies FsRequestResult<void, true>;
        });
        const results = await Promise.all(tasks);
        if (results.some(result => !result.ok)) {
            throw new RendererError(`Failed to initialize assets groups shards`);
        }
    }

    private assertMetadata() {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
    }

    private assertGroups() {
        if (!this.assetsGroups) {
            throw new RendererError("Assets groups not initialized");
        }
    }

    // Group management APIs
    public getGroups<T extends AssetType>(type: T): AssetGroup[] {
        this.assertGroups();
        const groups = Object.values(this.assetsGroups![type]);
        return groups;
    }

    public async createGroup<T extends AssetType>(
        type: T,
        name: string,
        parentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        this.assertGroups();

        const id = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const group: AssetGroup = {
            id,
            name,
            type,
            parentGroupId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        (this.assetsGroups![type] as Record<string, AssetGroup>)[id] = group;
        
        // Save to filesystem
        const writeResult = await this.writeAssetsGroupsMetadata(type);
        if (!writeResult.ok) {
            return {
                success: false,
                error: `Failed to save group: ${writeResult.error.code} ${writeResult.error.message}`,
            };
        }
        
        return {
            success: true,
            data: group,
        };
    }

    public async deleteGroup<T extends AssetType>(
        type: T, 
        groupId: string, 
        recursive: boolean = false
    ): Promise<RequestStatus<void>> {
        this.assertGroups();
        this.assertMetadata();

        if (!this.assetsGroups![type][groupId]) {
            return {
                success: false,
                error: `Group not found: ${groupId}`,
            };
        }

        // Check for child groups
        const childGroups = Object.values(this.assetsGroups![type]).filter(
            g => g.parentGroupId === groupId
        );

        if (childGroups.length > 0 && !recursive) {
            return {
                success: false,
                error: `Group has ${childGroups.length} child group(s). Use recursive delete or move them first.`,
            };
        }

        // Check for assets in this group
        const assetsInGroup = Object.values(this.assetsMetadata![type]).filter(
            a => a.groupId === groupId
        );

        // Delete all assets within this group instead of moving them to root
        for (const asset of assetsInGroup) {
            // Ensure we await each deletion to keep metadata consistent
            await this.deleteAsset(asset);
        }

        // Delete child groups recursively
        if (recursive) {
            for (const child of childGroups) {
                await this.deleteGroup(type, child.id, true);
            }
        }

        // Delete the group
        delete this.assetsGroups![type][groupId];

        // Remove any now-empty parent groups
        this.cleanupEmptyGroups(type);

        // Save changes
        await this.writeAssetsGroupsMetadata(type);
        this.markDirty(type);

        return {
            success: true,
            data: void 0,
        };
    }

    public async renameGroup<T extends AssetType>(
        type: T,
        groupId: string,
        newName: string
    ): Promise<RequestStatus<AssetGroup>> {
        this.assertGroups();

        const group = this.assetsGroups![type][groupId];
        if (!group) {
            return {
                success: false,
                error: `Group not found: ${groupId}`,
            };
        }

        group.name = newName;
        group.updatedAt = Date.now();

        await this.writeAssetsGroupsMetadata(type);

        return {
            success: true,
            data: group,
        };
    }

    public async moveGroupToParent<T extends AssetType>(
        type: T,
        groupId: string,
        newParentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        this.assertGroups();

        const group = this.assetsGroups![type][groupId];
        if (!group) {
            return {
                success: false,
                error: `Group not found: ${groupId}`,
            };
        }

        // Verify new parent group exists if provided
        if (newParentGroupId && !this.assetsGroups![type][newParentGroupId]) {
            return {
                success: false,
                error: `Parent group not found: ${newParentGroupId}`,
            };
        }

        group.parentGroupId = newParentGroupId;
        group.updatedAt = Date.now();

        await this.writeAssetsGroupsMetadata(type);

        return {
            success: true,
            data: group,
        };
    }

    public async moveAssetToGroup<T extends AssetType>(
        asset: Asset<T>,
        groupId?: string
    ): Promise<RequestStatus<void>> {
        this.assertMetadata();
        this.assertGroups();

        // Verify group exists if provided
        if (groupId && !this.assetsGroups![asset.type][groupId]) {
            return {
                success: false,
                error: `Group not found: ${groupId}`,
            };
        }

        const existingAsset = this.assetsMetadata![asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.groupId = groupId;
        this.markDirty(asset.type);

        // Emit update event so UI can react
        this.events.emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    // Metadata management APIs
    public async updateAssetTags<T extends AssetType>(
        asset: Asset<T>,
        tags: string[]
    ): Promise<RequestStatus<void>> {
        this.assertMetadata();

        const existingAsset = this.assetsMetadata![asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.tags = tags;
        this.markDirty(asset.type);

        // Emit update event so UI can react
        this.events.emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    public async updateAssetDescription<T extends AssetType>(
        asset: Asset<T>,
        description: string
    ): Promise<RequestStatus<void>> {
        this.assertMetadata();

        const existingAsset = this.assetsMetadata![asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.description = description;
        this.markDirty(asset.type);

        // Emit update event so UI can react
        this.events.emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    public async renameAsset<T extends AssetType>(
        asset: Asset<T>,
        newName: string
    ): Promise<RequestStatus<void>> {
        this.assertMetadata();

        const existingAsset = this.assetsMetadata![asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.name = newName;
        this.markDirty(asset.type);

        // Emit update event so UI can react
        this.events.emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    // Asset operations
    public async deleteAsset<T extends AssetType>(
        asset: Asset<T>
    ): Promise<RequestStatus<void>> {
        this.assertMetadata();

        if (!this.assetsMetadata![asset.type][asset.id]) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        // Delete asset file
        const assetPath = this.getLocalAssetPath(asset.id);
        const deleteResult = await getInterface().fs.deleteFile(assetPath);
        
        if (!deleteResult.success || !deleteResult.data.ok) {
            // Continue even if file deletion fails (file might not exist)
            console.warn(`Failed to delete asset file: ${assetPath}`);
        }

        // Remove from metadata
        delete this.assetsMetadata![asset.type][asset.id];
        this.markDirty(asset.type);

        // Emit deletion event so UI can react
        this.events.emit("deleted", asset);

        // Note: cleanup of empty groups should be triggered by caller after batch deletions to avoid frequent writes

        return {
            success: true,
            data: void 0,
        };
    }

    /**
     * Duplicate an existing asset, returning the new asset metadata.
     */
    public async duplicateAsset<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        this.assertMetadata();

        // Ensure asset exists
        const existing = this.assetsMetadata![asset.type][asset.id];
        if (!existing) {
            return { success: false, error: `Asset not found: ${asset.id}` };
        }

        // Generate new uuid and resolve unique name
        const newId = crypto.randomUUID();
        const uniqueName = this.resolveUniqueAssetName(asset.type, asset.name);

        // Source/dest paths
        const srcPath = this.getLocalAssetPath(asset.id);
        const destPath = this.getLocalAssetPath(newId);

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        // Ensure destination directory exists
        const destDir = dirname(destPath);
        const dirEnsure = await filesystemService.createDir(destDir);
        if (!dirEnsure.ok) {
            return { success: false, error: `Failed to create destination directory: ${dirEnsure.error?.message}` };
        }

        // Check if source file exists
        const srcExists = await filesystemService.isFileExists(srcPath);
        if (!srcExists.ok || !srcExists.data) {
            return { success: false, error: `Source asset file not found: ${srcPath}` };
        }

        // Copy file
        const copyResult = await getInterface().fs.copyFile(srcPath, destPath);
        if (!copyResult.success || !copyResult.data.ok) {
            const msg = copyResult.error || (copyResult.data as FsRequestResult<void, false>)?.error.message;
            return { success: false, error: `Failed to copy asset file: ${msg}` };
        }

        // Compute hash for the duplicated file
        const hashResult = await getInterface().fs.hash(destPath);
        const fileHash = hashResult.success && hashResult.data.ok ? hashResult.data.data : asset.hash;

        // Create metadata
        const newAsset: Asset<T, AssetSource.Local> = {
            ...asset,
            id: newId,
            hash: fileHash,
            name: uniqueName,
            source: AssetSource.Local,
        };

        // Save metadata
        (this.assetsMetadata![asset.type] as Record<string, Asset<T>>)[newId] = newAsset as Asset<T>;
        this.markDirty(asset.type);

        return { success: true, data: newAsset };
    }

    public async importFromPaths<T extends AssetType>(
        type: T,
        paths: string[]
    ): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        const results: RequestStatus<Asset<T, AssetSource.Local>>[] = [];
        
        for (const path of paths) {
            results.push(await this.importLocalAsset(type, path));
        }

        this.markDirty(type);

        return {
            success: true,
            data: results,
        };
    }

    private async writeAssetsGroupsMetadata(type: AssetType): Promise<FsRequestResult<void>> {
        this.assertGroups();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data = JSON.stringify(this.assetsGroups![type]);

        return await filesystemService.write(
            this.getContext().project.resolve(ProjectNameConvention.AssetsGroupsShard(type)), 
            data, 
            "utf-8"
        );
    }

    // Validate file format by checking magic bytes
    private async validateFileFormat<T extends AssetType>(type: T, path: string): Promise<RequestStatus<void>> {
        if (!this.fileFormatValidator) {
            throw new RendererError("FileFormatValidator not initialized");
        }

        const fsService = this.getContext().services.get<FileSystemService>(Services.FileSystem);

        // Read first 12 bytes to detect format
        const fileResult = await fsService.readRaw(path);
        if (!fileResult.ok) {
            return {
                success: false,
                error: `Failed to read file: ${fileResult.error?.message || 'Unknown error'}`,
            };
        }

        const buffer = fileResult.data;
        if (buffer.length === 0) {
            return {
                success: false,
                error: 'File is empty',
            };
        }

        return await this.fileFormatValidator.validateFileFormat(type, path, buffer);
    }


    /**
     * Remove groups that have become empty (no assets and no child groups)
     */
    public cleanupEmptyGroups(type?: AssetType): boolean {
        if (!this.assetsGroups || !this.assetsMetadata) return false;

        const types = type ? [type] as AssetType[] : (Object.values(AssetType) as AssetType[]);

        let changed = false;
        for (const t of types) {
            const groups = this.assetsGroups[t];
            if (!groups) continue;

            let currentChanged = true;
            while (currentChanged) {
                currentChanged = false;
                for (const [gid, g] of Object.entries(groups)) {
                    // Skip rootless groups until their children processed
                    const hasChildGroup = Object.values(groups).some(gr => gr.parentGroupId === gid);
                    const hasAssets = Object.values(this.assetsMetadata[t]).some(a => a.groupId === gid);
                    if (!hasChildGroup && !hasAssets) {
                        delete groups[gid];
                        currentChanged = true;
                        changed = true;
                    }
                }
            }
        }
        return changed;
    }

    public async cleanupEmptyGroupsPersist(type?: AssetType) {
        if (this.cleanupEmptyGroups(type)) {
            if (type) {
                await this.writeAssetsGroupsMetadata(type);
            } else {
                for (const t of Object.values(AssetType)) {
                    await this.writeAssetsGroupsMetadata(t);
                }
            }
        }
    }
}
