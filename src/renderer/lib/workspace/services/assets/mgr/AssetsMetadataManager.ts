import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { FsRequestResult } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import { FileSystemService } from "../../core/FileSystem";
import { Services, WorkspaceContext } from "../../services";
import { AssetType } from "../assetTypes";
import { Asset, AssetSource, AssetsMap } from "../types";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetsService } from "../../core/AssetsService";

export class AssetsMetadataManager {
    public assetsMetadata: AssetsMap | null = null;
    
    constructor(private assetsService: AssetsService, private context: WorkspaceContext) {
    }

    public getAssets(): AssetsMap {
        if (!this.assetsMetadata) {
            throw new RendererError("Assets metadata not initialized");
        }
        return this.assetsMetadata;
    }

    public list<T extends AssetType>(type: T): string[] {
        return Object.keys(this.getAssets()[type]);
    }

    public exists<T extends AssetType>(asset: Asset<T, AssetSource>): boolean {
        return this.getAssets()[asset.type][asset.id] !== undefined;
    }

    async init(): Promise<this> {
        this.assetsMetadata = await this.fetchAssetsMetadata();
        return this;
    }

    public async updateAssetTags<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        tags: string[]
    ): Promise<RequestStatus<void>> {
        const metadata = this.getAssets();
        const existingAsset = metadata[asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.tags = tags;
        this.assetsService.markDirty(asset.type);

        // Emit update event so UI can react
        this.assetsService.getEvents().emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    public async updateAssetDescription<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        description: string
    ): Promise<RequestStatus<void>> {
        const metadata = this.getAssets();
        const existingAsset = metadata[asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.description = description;
        this.assetsService.markDirty(asset.type);

        // Emit update event so UI can react
        this.assetsService.getEvents().emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    public async renameAsset<T extends AssetType>(
        asset: Asset<T, AssetSource>,
        newName: string
    ): Promise<RequestStatus<void>> {
        const metadata = this.getAssets();
        const existingAsset = metadata[asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.name = newName;

        // Update extension if the new name has a different extension
        const nameParts = newName.toLowerCase().split('.');
        const newExtension = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
        if (newExtension !== (existingAsset.ext || '')) {
            existingAsset.ext = newExtension || undefined;
        }

        this.assetsService.markDirty(asset.type);

        // Emit update event so UI can react
        this.assetsService.getEvents().emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    private async initAssetsMetadata(): Promise<void> {
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const files = [
            AssetType.Image,
            AssetType.Audio,
            AssetType.Video,
            AssetType.JSON,
            AssetType.Blueprint,
            AssetType.Font,
            AssetType.Other,
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

    private async fetchAssetsMetadata(): Promise<AssetsMap> {
        // Initialize assets metadata
        await this.initAssetsMetadata();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data: AssetsMap = {
            [AssetType.Image]: {},
            [AssetType.Audio]: {},
            [AssetType.Video]: {},
            [AssetType.JSON]: {},
            [AssetType.Blueprint]: {},
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

        // Migration: ensure all assets have ext field set
        this.migrateAssetExtensions(data);

        return data;
    }

    private migrateAssetExtensions(data: AssetsMap): void {
        let hasChanges = false;

        for (const type of Object.values(AssetType)) {
            for (const asset of Object.values(data[type])) {
                if (asset && asset.ext === undefined) {
                    // Extract extension from filename
                    const nameParts = asset.name.toLowerCase().split('.');
                    const extension = nameParts.length > 1 ? nameParts[nameParts.length - 1] : '';
                    asset.ext = extension || undefined;
                    hasChanges = true;
                }
            }
        }

        // Mark all types as dirty if we made changes so they get saved
        if (hasChanges) {
            for (const type of Object.values(AssetType)) {
                this.assetsService.markDirty(type);
            }
        }
    }

    private getContext(): WorkspaceContext {
        return this.context;
    }
}
