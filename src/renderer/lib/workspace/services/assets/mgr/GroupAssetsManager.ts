import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { FsRequestResult } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import { FileSystemService } from "../../core/FileSystem";
import { Services, WorkspaceContext } from "../../services";
import { AssetType } from "../assetTypes";
import { Asset, AssetGroup, AssetGroupMap } from "../types";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetsService } from "../../core/AssetsService";

export class GroupAssetsManager {
    public assetsGroups: AssetGroupMap | null = null;
    private dirtyGroupTypes = new Set<AssetType>();

    constructor(private assetsService: AssetsService, private context: WorkspaceContext) {
    }

    async init(): Promise<this> {
        this.assetsGroups = await this.fetchAssetsGroups();

        return this;
    }

    public getGroups<T extends AssetType>(type: T): AssetGroup[] {
        this.assertGroups();
        const groups = Object.values(this.assetsGroups[type]);
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

        (this.assetsGroups[type] as Record<string, AssetGroup>)[id] = group;
        this.dirtyGroupTypes.add(type);
        
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
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        const assetsInGroup = Object.values(metadata[type]).filter(
            a => a.groupId === groupId
        );

        // Delete all assets within this group instead of moving them to root
        for (const asset of assetsInGroup) {
            // Ensure we await each deletion to keep metadata consistent
            await this.assetsService.getLocalAssetsManager().deleteAsset(asset);
        }

        // Delete child groups recursively
        if (recursive) {
            for (const child of childGroups) {
                await this.deleteGroup(type, child.id, true);
            }
        }

        // Delete the group
        delete this.assetsGroups![type][groupId];
        this.dirtyGroupTypes.add(type);

        // Save changes
        await this.writeAssetsGroupsMetadata(type);
        this.assetsService.markDirty(type);

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
        this.dirtyGroupTypes.add(type);

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
        this.dirtyGroupTypes.add(type);

        return {
            success: true,
            data: group,
        };
    }

    public async moveAssetToGroup<T extends AssetType>(
        asset: Asset<T>,
        groupId?: string
    ): Promise<RequestStatus<void>> {
        this.assertGroups();

        // Verify group exists if provided
        if (groupId && !this.assetsGroups![asset.type][groupId]) {
            return {
                success: false,
                error: `Group not found: ${groupId}`,
            };
        }

        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        const existingAsset = metadata[asset.type][asset.id];
        if (!existingAsset) {
            return {
                success: false,
                error: `Asset not found: ${asset.id}`,
            };
        }

        existingAsset.groupId = groupId;
        this.assetsService.markDirty(asset.type);

        // Emit update event so UI can react
        this.assetsService.getEvents().emit("updated", existingAsset);

        return {
            success: true,
            data: void 0,
        };
    }

    private async writeAssetsGroupsMetadata(type: AssetType): Promise<FsRequestResult<void>> {
        this.assertGroups();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data = JSON.stringify(this.assetsGroups[type]);

        return await filesystemService.write(
            this.getContext().project.resolve(ProjectNameConvention.AssetsGroupsShard(type)), 
            data, 
            "utf-8"
        );
    }

    private assertGroups(): asserts this is this & { assetsGroups: AssetGroupMap } {
        if (!this.assetsGroups) {
            throw new RendererError("Assets groups not initialized");
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

    /**
     * Check if a group has neither child groups nor assets.
     */
    private isGroupEmpty<T extends AssetType>(type: T, gid: string): boolean {
        const groups = this.assetsGroups![type];
        const group = groups[gid];
        if (!group) return false;
        const hasChildGroup = Object.values(groups).some(g => g.parentGroupId === gid);
        if (hasChildGroup) return false;
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        const hasAssets = Object.values(metadata[type]).some(a => a.groupId === gid);
        return !hasAssets;
    }

    /**
     * Walk up the parent chain and remove groups that become empty after deleting a child group.
     */
    private async removeEmptyParentGroups<T extends AssetType>(type: T, parentGroupId?: string): Promise<void> {
        while (parentGroupId) {
            if (!this.isGroupEmpty(type, parentGroupId)) break;
            const parent = this.assetsGroups![type][parentGroupId];
            delete this.assetsGroups![type][parentGroupId];
            // Move up the chain
            parentGroupId = parent.parentGroupId;
        }
        if (parentGroupId === undefined) {
            // We may have deleted some groups, ensure metadata flushed
            await this.writeAssetsGroupsMetadata(type);
        }
    }

    private getContext(): WorkspaceContext {
        return this.context;
    }
}