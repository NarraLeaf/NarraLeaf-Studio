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
import { AssetsMetadataManager } from "../assets/mgr/AssetsMetadataManager";
import { GroupAssetsManager } from "../assets/mgr/GroupAssetsManager";
import { LocalAssetsManager } from "../assets/mgr/LocalAssetsManager";
import { OtherService } from "../assets/OtherService";
import { Asset, AssetGroup, AssetsMap, AssetSource } from "../assets/types";
import { VideoService } from "../assets/VideoService";
import { Service } from "../Service";
import { IAssetService, Services, WorkspaceContext } from "../services";
import { EventEmitter } from "../ui/EventEmitter";
import { FileSystemService } from "./FileSystem";
import { ProjectService } from "./ProjectService";

interface AssetsEvents {
    deleted: Asset;
    updated: Asset;
}

export class AssetsService extends Service<AssetsService> implements IAssetService {
    private assetsMetadataManager: AssetsMetadataManager | null = null;
    private localAssetsManager: LocalAssetsManager | null = null;
    private groupAssetsManager: GroupAssetsManager | null = null;
    public imageService: ImageService | null = null;
    public audioService: AudioService | null = null;
    public videoService: VideoService | null = null;
    public jsonService: JSONService | null = null;
    public fontService: FontService | null = null;
    public otherService: OtherService | null = null;
    public fileFormatValidator: FileFormatValidator | null = null;

    /**
     * Event emitter for asset-level changes (added, deleted, updated)
     */
    private readonly events = new EventEmitter<AssetsEvents>();

    /**
     * Transaction batching support
     */
    private batchDepth = 0;
    private dirtyTypes = new Set<AssetType>();

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
        
        this.assetsMetadataManager = await new AssetsMetadataManager(this, ctx).init();
        this.groupAssetsManager = await new GroupAssetsManager(this, ctx).init();
        this.localAssetsManager = await new LocalAssetsManager(this, ctx).init();
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

    public exists<T extends AssetType>(asset: Asset<T>): boolean {
        return this.getAssetsMetadataManager().exists(asset);
    }

    public async fetch<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<AssetData<T>>> {
        return this.getLocalAssetsManager().fetch(asset);
    }

    public async importLocalAssets<T extends AssetType>(type: T): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        return this.getLocalAssetsManager().importLocalAssets(type);
    }

    private async writeAssetsMetadata(type: AssetType): Promise<FsRequestResult<void>> {
        const metadata = this.getAssetsMetadataManager().getAssets();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data = JSON.stringify(metadata[type]);

        return await filesystemService.write(this.getContext().project.resolve(ProjectNameConvention.AssetsMetadataShard(type)), data, "utf-8");
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

    public async renameAsset<T extends AssetType>(
        asset: Asset<T>,
        newName: string
    ): Promise<RequestStatus<void>> {
        return this.getAssetsMetadataManager().renameAsset(asset, newName);
    }

    // Asset operations
    public async deleteAsset<T extends AssetType>(
        asset: Asset<T>
    ): Promise<RequestStatus<void>> {
        return this.getLocalAssetsManager().deleteAsset(asset);
    }

    /**
     * Duplicate an existing asset, returning the new asset metadata.
     */
    public async duplicateAsset<T extends AssetType>(asset: Asset<T>): Promise<RequestStatus<Asset<T, AssetSource.Local>>> {
        return this.getLocalAssetsManager().duplicateAsset(asset);
    }

    public async importFromPaths<T extends AssetType>(
        type: T,
        paths: string[]
    ): Promise<RequestStatus<RequestStatus<Asset<T, AssetSource.Local>>[]>> {
        return this.getLocalAssetsManager().importFromPaths(type, paths);
    }
}
