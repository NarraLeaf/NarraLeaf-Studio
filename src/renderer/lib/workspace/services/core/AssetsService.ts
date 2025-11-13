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
import { RequestStatus } from "@shared/types/ipcEvents";
import { getInterface } from "@/lib/app/bridge";
import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { basename, dirname } from "@shared/utils/path";
import { EventEmitter } from "../ui/EventEmitter";

interface AssetsEvents {
    deleted: Asset;
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

    /**
     * Event emitter for asset-level changes (added, deleted, updated)
     */
    private readonly events = new EventEmitter<AssetsEvents>();

    /**
     * Get event emitter so UI layer can subscribe
     */
    public getEvents(): EventEmitter<AssetsEvents> {
        return this.events;
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

        const writeResult = await this.writeAssetsMetadata(type);
        if (!writeResult.ok) {
            return {
                success: false,
                error: `Failed to write assets metadata: ${`[${writeResult.error.code}] ${writeResult.error.message}`}`,
            };
        }

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
                throw new RendererError(`Failed to read assets metadata shard: ${shardPath}`);
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

        if (assetsInGroup.length > 0) {
            // Move assets to root (no group)
            for (const asset of assetsInGroup) {
                asset.groupId = undefined;
            }
        }

        // Delete child groups recursively
        if (recursive) {
            for (const child of childGroups) {
                await this.deleteGroup(type, child.id, true);
            }
        }

        // Delete the group
        delete this.assetsGroups![type][groupId];

        // Save changes
        await this.writeAssetsGroupsMetadata(type);
        await this.writeAssetsMetadata(type);

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
        await this.writeAssetsMetadata(asset.type);

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
        await this.writeAssetsMetadata(asset.type);

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
        await this.writeAssetsMetadata(asset.type);

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
        await this.writeAssetsMetadata(asset.type);

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
        await this.writeAssetsMetadata(asset.type);

        // Emit deletion event so UI can react
        this.events.emit("deleted", asset);

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
        const writeResult = await this.writeAssetsMetadata(asset.type);
        if (!writeResult.ok) {
            return { success: false, error: `Failed to write metadata: ${writeResult.error.message}` };
        }

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

        const writeResult = await this.writeAssetsMetadata(type);
        if (!writeResult.ok) {
            return {
                success: false,
                error: `Failed to write assets metadata: ${writeResult.error.code} ${writeResult.error.message}`,
            };
        }

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

        const fileExt = path.split('.').pop()?.toLowerCase() || '';
        
        // Check if file extension is in the allowed list for this asset type
        const allowedExtensions = AssetExtensions[type];
        if (!allowedExtensions.includes(fileExt)) {
            return {
                success: false,
                error: `File extension .${fileExt} is not allowed for ${type} assets. Allowed extensions: ${allowedExtensions.join(', ')}`,
            };
        }

        let detectedFormat: string | null = null;

        // Detect format based on asset type
        switch (type) {
            case AssetType.Image:
                detectedFormat = this.detectImageFormat(buffer);
                break;
            case AssetType.Audio:
                detectedFormat = this.detectAudioFormat(buffer);
                break;
            case AssetType.Video:
                detectedFormat = this.detectVideoFormat(buffer);
                break;
            case AssetType.Font:
                detectedFormat = this.detectFontFormat(buffer);
                break;
            case AssetType.JSON:
                // JSON validation through parsing
                try {
                    const text = new TextDecoder().decode(buffer);
                    JSON.parse(text);
                    return { success: true, data: void 0 };
                } catch {
                    return {
                        success: false,
                        error: 'Invalid JSON file',
                    };
                }
            case AssetType.Other:
                // No validation for other types (extension check is sufficient)
                return { success: true, data: void 0 };
        }

        // If format was detected, verify it matches the file extension
        if (detectedFormat && detectedFormat !== 'unknown') {
            const formatMatches = this.checkFormatMatch(type, fileExt, detectedFormat);
            if (!formatMatches) {
                return {
                    success: false,
                    error: `File format mismatch: file extension is .${fileExt.toUpperCase()} but file content indicates ${detectedFormat.toUpperCase()} format. The file may be corrupted or misnamed.`,
                };
            }
        }

        return { success: true, data: void 0 };
    }

    private detectImageFormat(buffer: Uint8Array): string | null {
        if (buffer.length < 4) return null;

        // JPEG
        if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
            return 'jpeg';
        }

        // PNG
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
            return 'png';
        }

        // GIF
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
            return 'gif';
        }

        // WebP
        if (buffer.length >= 12) {
            const riffStr = String.fromCharCode(...buffer.subarray(0, 4));
            const webpStr = String.fromCharCode(...buffer.subarray(8, 12));
            if (riffStr === 'RIFF' && webpStr === 'WEBP') {
                return 'webp';
            }
        }

        // BMP
        if (buffer[0] === 0x42 && buffer[1] === 0x4D) {
            return 'bmp';
        }

        // TIFF
        if ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2A && buffer[3] === 0x00) ||
            (buffer[0] === 0x4D && buffer[1] === 0x4D && buffer[2] === 0x00 && buffer[3] === 0x2A)) {
            return 'tiff';
        }

        return 'unknown';
    }

    private detectAudioFormat(buffer: Uint8Array): string | null {
        if (buffer.length < 12) return null;

        // MP3
        if (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) {
            return 'mp3';
        }
        if (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0) {
            return 'mp3';
        }

        // WAV
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x57 && buffer[9] === 0x41 && buffer[10] === 0x56 && buffer[11] === 0x45) {
            return 'wav';
        }

        // OGG
        if (buffer[0] === 0x4F && buffer[1] === 0x67 && buffer[2] === 0x67 && buffer[3] === 0x53) {
            return 'ogg';
        }

        // FLAC
        if (buffer[0] === 0x66 && buffer[1] === 0x4C && buffer[2] === 0x61 && buffer[3] === 0x43) {
            return 'flac';
        }

        // M4A/AAC
        if (buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && 
            buffer[6] === 0x79 && buffer[7] === 0x70) {
            return 'm4a';
        }

        return 'unknown';
    }

    private detectVideoFormat(buffer: Uint8Array): string | null {
        if (buffer.length < 12) return null;

        // MP4/M4V
        if (buffer.length >= 8 && buffer[4] === 0x66 && buffer[5] === 0x74 && 
            buffer[6] === 0x79 && buffer[7] === 0x70) {
            if (buffer.length >= 12) {
                const brand = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
                if (brand === 'M4V ' || brand === 'M4VH' || brand === 'M4VP') {
                    return 'm4v';
                }
                if (brand === 'qt  ') {
                    return 'mov';
                }
            }
            return 'mp4';
        }

        // WebM/MKV
        if (buffer[0] === 0x1A && buffer[1] === 0x45 && buffer[2] === 0xDF && buffer[3] === 0xA3) {
            return 'webm'; // Could also be mkv, but webm is more common in web contexts
        }

        // AVI
        if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
            buffer[8] === 0x41 && buffer[9] === 0x56 && buffer[10] === 0x49 && buffer[11] === 0x20) {
            return 'avi';
        }

        return 'unknown';
    }

    private detectFontFormat(buffer: Uint8Array): string | null {
        if (buffer.length < 4) return null;

        // TTF
        if (buffer[0] === 0x00 && buffer[1] === 0x01 && buffer[2] === 0x00 && buffer[3] === 0x00) {
            return 'ttf';
        }

        // OTF
        if (buffer[0] === 0x4F && buffer[1] === 0x54 && buffer[2] === 0x54 && buffer[3] === 0x4F) {
            return 'otf';
        }

        // WOFF
        if (buffer[0] === 0x77 && buffer[1] === 0x4F && buffer[2] === 0x46 && buffer[3] === 0x46) {
            return 'woff';
        }

        // WOFF2
        if (buffer[0] === 0x77 && buffer[1] === 0x4F && buffer[2] === 0x46 && buffer[3] === 0x32) {
            return 'woff2';
        }

        // EOT
        if (buffer.length >= 36 && buffer[34] === 0x4C && buffer[35] === 0x50) {
            return 'eot';
        }

        return 'unknown';
    }

    private checkFormatMatch(type: AssetType, extension: string, detectedFormat: string): boolean {
        const formatMaps: Record<AssetType, Record<string, string[]>> = {
            [AssetType.Image]: {
                'jpeg': ['jpg', 'jpeg', 'jpe', 'jfif'],
                'png': ['png'],
                'gif': ['gif'],
                'webp': ['webp'],
                'bmp': ['bmp', 'dib'],
                'tiff': ['tiff', 'tif'],
            },
            [AssetType.Audio]: {
                'mp3': ['mp3', 'mpeg'],
                'wav': ['wav', 'wave'],
                'ogg': ['ogg', 'oga'],
                'flac': ['flac'],
                'm4a': ['m4a', 'aac', 'mp4'],
            },
            [AssetType.Video]: {
                'mp4': ['mp4', 'm4v'],
                'm4v': ['m4v', 'mp4'],
                'webm': ['webm', 'mkv'],
                'avi': ['avi'],
                'mov': ['mov', 'qt'],
            },
            [AssetType.Font]: {
                'ttf': ['ttf'],
                'otf': ['otf'],
                'woff': ['woff'],
                'woff2': ['woff2'],
                'eot': ['eot'],
            },
            [AssetType.JSON]: {},
            [AssetType.Other]: {},
        };

        const formatMap = formatMaps[type];
        for (const [format, extensions] of Object.entries(formatMap)) {
            if (extensions.includes(detectedFormat) && extensions.includes(extension)) {
                return true;
            }
        }

        return false;
    }
}
