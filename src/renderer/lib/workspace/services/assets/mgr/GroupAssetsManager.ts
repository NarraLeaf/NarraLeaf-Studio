import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { FsRequestResult } from "@shared/types/os";
import { RendererError } from "@shared/utils/error";
import { FileSystemService } from "../../core/FileSystem";
import { Services, WorkspaceContext } from "../../services";
import { ASSET_CATEGORY_ORDER, ASSET_CATEGORY_TYPES, AssetCategory, AssetType, categoryOfAssetType } from "../assetTypes";
import { Asset, AssetGroup, AssetGroupMap, AssetSource, LegacyTypedAssetGroup } from "../types";
import { RequestStatus } from "@shared/types/ipcEvents";
import { AssetsService } from "../../core/AssetsService";
import type { AssetDeleteOptions } from "../assetDeleteGuard";
import { reconcileAssetOrder } from "../assetOrder";
import { legacyShardTypesFor, mergeLegacyGroupShards, normalizeAssetGroupRecords } from "../assetCategoryShards";

/** An empty group map — one record per category, in sidebar order. */
function emptyGroupMap(): AssetGroupMap {
    const map = {} as AssetGroupMap;
    for (const category of ASSET_CATEGORY_ORDER) {
        map[category] = {};
    }
    return map;
}

export class GroupAssetsManager {
    public assetsGroups: AssetGroupMap | null = null;
    private dirtyGroupCategories = new Set<AssetCategory>();

    constructor(private assetsService: AssetsService, private context: WorkspaceContext) {
    }

    async init(): Promise<this> {
        this.assetsGroups = await this.fetchAssetsGroups();

        return this;
    }

    public getGroups(category: AssetCategory): AssetGroup[] {
        this.assertGroups();
        const record = this.assetsGroups[category];
        return this.listOrderedGroups(category).map(id => record[id]);
    }

    /**
     * Group ids of `category` in the order the browser draws them — the tree's other half, walked
     * together with the assets by shift-range selection.
     */
    public listOrderedGroups(category: AssetCategory): string[] {
        this.assertGroups();
        return reconcileAssetOrder(this.assetsService.getAssetOrderManager().getGroupIds(category), this.assetsGroups[category]);
    }

    /** Every asset record filed under this category, across all of its member types. */
    private categoryAssets(category: AssetCategory): Asset<AssetType, AssetSource>[] {
        const metadata = this.assetsService.getAssetsMetadataManager().getAssets();
        return ASSET_CATEGORY_TYPES[category]
            .flatMap(type => Object.values(metadata[type])) as Asset<AssetType, AssetSource>[];
    }

    public async createGroup(
        category: AssetCategory,
        name: string,
        parentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        this.assertGroups();

        const id = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const group: AssetGroup = {
            id,
            name,
            category,
            parentGroupId,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };

        this.assetsGroups[category][id] = group;
        this.dirtyGroupCategories.add(category);

        // Save to filesystem
        const writeResult = await this.writeAssetsGroupsMetadata(category);
        if (!writeResult.ok) {
            return {
                success: false,
                error: `Failed to save group: ${writeResult.error.code} ${writeResult.error.message}`,
            };
        }

        this.assetsService.getEvents().emit("groupsUpdated", { category, groupId: id });

        return {
            success: true,
            data: group,
        };
    }

    /**
     * Every asset a delete of this group would remove: its own, plus — when the delete cascades —
     * everything in the groups below it, to any depth.
     *
     * Split out so the guard can ask the question *before* the first file is unlinked; see
     * {@link AssetsService.deleteGroup}.
     */
    public collectGroupAssets(
        category: AssetCategory,
        groupId: string,
        recursive: boolean = false,
    ): Asset<AssetType, AssetSource>[] {
        this.assertGroups();

        const groupIds = new Set<string>([groupId]);
        if (recursive) {
            const candidates = Object.values(this.assetsGroups[category]);
            // Group nesting has no depth bound, so descend until no new child appears.
            let grew = true;
            while (grew) {
                grew = false;
                for (const group of candidates) {
                    if (group.parentGroupId && groupIds.has(group.parentGroupId) && !groupIds.has(group.id)) {
                        groupIds.add(group.id);
                        grew = true;
                    }
                }
            }
        }

        return this.categoryAssets(category).filter(
            asset => asset.groupId && groupIds.has(asset.groupId)
        );
    }

    public async deleteGroup(
        category: AssetCategory,
        groupId: string,
        recursive: boolean = false,
        options?: AssetDeleteOptions,
    ): Promise<RequestStatus<void>> {
        this.assertGroups();

        if (!this.assetsGroups![category][groupId]) {
            return {
                success: false,
                error: `Group not found: ${groupId}`,
            };
        }

        // Check for child groups
        const childGroups = Object.values(this.assetsGroups![category]).filter(
            g => g.parentGroupId === groupId
        );

        if (childGroups.length > 0 && !recursive) {
            return {
                success: false,
                error: `Group has ${childGroups.length} child group(s). Use recursive delete or move them first.`,
            };
        }

        // Check for assets in this group
        const assetsInGroup = this.categoryAssets(category).filter(
            a => a.groupId === groupId
        );

        // Delete all assets within this group instead of moving them to root.
        //
        // A refusal stops the cascade instead of being swallowed: the delete goes through
        // `AssetsService.deleteAsset`, which is where the reference guard lives, and carrying on
        // past it would drop the group record while leaving the file it refused to delete behind,
        // stranded at the root with no way back to where it was.
        for (const asset of assetsInGroup) {
            const result = await this.assetsService.deleteAsset(asset, options);
            if (!result.success) {
                return result;
            }
        }

        // Delete child groups recursively
        if (recursive) {
            for (const child of childGroups) {
                const result = await this.deleteGroup(category, child.id, true, options);
                if (!result.success) {
                    return result;
                }
            }
        }

        // Delete the group
        delete this.assetsGroups![category][groupId];
        this.dirtyGroupCategories.add(category);

        // Save changes
        await this.writeAssetsGroupsMetadata(category);
        for (const type of ASSET_CATEGORY_TYPES[category]) {
            this.assetsService.markDirty(type);
        }

        this.assetsService.getEvents().emit("groupsUpdated", { category, groupId });

        return {
            success: true,
            data: void 0,
        };
    }

    public async renameGroup(
        category: AssetCategory,
        groupId: string,
        newName: string
    ): Promise<RequestStatus<AssetGroup>> {
        this.assertGroups();

        const group = this.assetsGroups![category][groupId];
        if (!group) {
            return {
                success: false,
                error: `Group not found: ${groupId}`,
            };
        }

        group.name = newName;
        group.updatedAt = Date.now();

        await this.writeAssetsGroupsMetadata(category);
        this.dirtyGroupCategories.add(category);

        this.assetsService.getEvents().emit("groupsUpdated", { category, groupId });

        return {
            success: true,
            data: group,
        };
    }

    public async moveGroupToParent(
        category: AssetCategory,
        groupId: string,
        newParentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        this.assertGroups();

        const group = this.assetsGroups![category][groupId];
        if (!group) {
            return {
                success: false,
                error: `Group not found: ${groupId}`,
            };
        }

        // Verify new parent group exists if provided
        if (newParentGroupId && !this.assetsGroups![category][newParentGroupId]) {
            return {
                success: false,
                error: `Parent group not found: ${newParentGroupId}`,
            };
        }

        group.parentGroupId = newParentGroupId;
        group.updatedAt = Date.now();

        await this.writeAssetsGroupsMetadata(category);
        this.dirtyGroupCategories.add(category);

        this.assetsService.getEvents().emit("groupsUpdated", { category, groupId });

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

        // Verify group exists if provided. The category is the asset's own, which is what refuses a
        // cross-category move: an mp3 may join any folder under Media, and no folder anywhere else.
        const category = categoryOfAssetType(asset.type);
        if (groupId && !this.assetsGroups![category][groupId]) {
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

    /**
     * Duplicate a group recursively, including all child groups and assets.
     * Returns the newly created group.
     */
    public async duplicateGroup(
        category: AssetCategory,
        groupId: string,
        newParentGroupId?: string
    ): Promise<RequestStatus<AssetGroup>> {
        this.assertGroups();

        const originalGroup = this.assetsGroups![category][groupId];
        if (!originalGroup) {
            return {
                success: false,
                error: `Group not found: ${groupId}`,
            };
        }

        // Create new group with the same name (with " Copy" suffix)
        const newGroupResult = await this.createGroup(category, `${originalGroup.name} Copy`, newParentGroupId);
        if (!newGroupResult.success || !newGroupResult.data) {
            return newGroupResult;
        }
        const newGroup = newGroupResult.data;

        // Duplicate all assets in this group
        const assetsInGroup = this.categoryAssets(category).filter(
            a => a.groupId === groupId
        );

        for (const asset of assetsInGroup) {
            const dupResult = await this.assetsService.duplicateAsset(asset);
            if (dupResult.success && dupResult.data) {
                await this.moveAssetToGroup(dupResult.data, newGroup.id);
            }
        }

        // Recursively duplicate child groups
        const childGroups = Object.values(this.assetsGroups![category]).filter(
            g => g.parentGroupId === groupId
        );

        for (const childGroup of childGroups) {
            await this.duplicateGroup(category, childGroup.id, newGroup.id);
        }

        return {
            success: true,
            data: newGroup,
        };
    }

    private async writeAssetsGroupsMetadata(category: AssetCategory): Promise<FsRequestResult<void>> {
        this.assertGroups();

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const data = JSON.stringify(this.assetsGroups[category]);

        // The row order lives in a sibling file, not in this one, so an older Studio keeps reading
        // this shard byte-for-byte as it always has.
        this.assetsService.markOrderDirty(category);

        return await filesystemService.write(
            this.getContext().project.resolve(ProjectNameConvention.AssetsGroupsShard(category)),
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
        const data: AssetGroupMap = emptyGroupMap();

        for (const category of ASSET_CATEGORY_ORDER) {
            const shardPath = this.getContext().project.resolve(ProjectNameConvention.AssetsGroupsShard(category));
            const shardResult = await filesystemService.readJSON<Record<string, LegacyTypedAssetGroup>>(shardPath);
            if (shardResult.ok) {
                // Key order stands as the group order until the sibling order file says otherwise;
                // for a project that predates that file it *is* the order, and this parse is where
                // it still exists.
                Object.assign(data[category], normalizeAssetGroupRecords(shardResult.data, category));
            } else {
                throw new RendererError(`Failed to read assets groups shard: ${shardPath}`);
            }
        }

        return data;
    }

    /**
     * Make sure every category has a shard, folding the type-named ones up on the open that finds
     * a category shard missing.
     *
     * The merge is the whole reason this cannot simply write `{}` for an absent file any more: a
     * project whose folders live in `assets.groups.audio.json` would open with every audio asset
     * un-filed, and re-filing a library by hand is not something an author can be asked to do. The
     * old shards are read, never written and never deleted.
     */
    private async initAssetsGroups(): Promise<void> {
        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const files = ASSET_CATEGORY_ORDER.map(category => ({
            category,
            path: this.getContext().project.resolve(ProjectNameConvention.AssetsGroupsShard(category)),
        }));

        const tasks = files.map(async file => {
            const existsResult = await filesystemService.isFileExists(file.path);
            if (!existsResult.ok || !existsResult.data) {
                const merged = await this.readLegacyGroupShards(file.category);
                return filesystemService.write(file.path, JSON.stringify(merged), "utf-8");
            }
            return { ok: true, data: void 0 } satisfies FsRequestResult<void, true>;
        });
        const results = await Promise.all(tasks);
        const failedIndex = results.findIndex(result => !result.ok);
        if (failedIndex >= 0) {
            const failed = results[failedIndex];
            const file = files[failedIndex];
            if (!failed.ok) {
                throw new RendererError(
                    `Failed to initialize assets groups shard (${file.category}): ${file.path}: ${failed.error.code} ${failed.error.message}`
                );
            }
        }
    }

    /** The type-named shards behind a category, read in member order. Absent files contribute nothing. */
    private async readLegacyGroupShards(category: AssetCategory): Promise<Record<string, AssetGroup>> {
        const legacyTypes = legacyShardTypesFor(category);
        if (legacyTypes.length === 0) {
            return {};
        }

        const filesystemService = this.getContext().services.get<FileSystemService>(Services.FileSystem);
        const shards: { type: AssetType; records: Record<string, LegacyTypedAssetGroup> | null }[] = [];
        for (const type of legacyTypes) {
            // `AssetsGroupsShard` now takes a category; the legacy files are named after a type, and
            // those two id spaces overlap only where the migration is a no-op. Built here rather than
            // through the convention so the convention stops naming files nothing writes any more.
            const path = this.getContext().project.resolve(["assets", `assets.groups.${type}.json`]);
            const result = await filesystemService.readJSON<Record<string, LegacyTypedAssetGroup>>(path);
            shards.push({ type, records: result.ok ? result.data : null });
        }

        return mergeLegacyGroupShards(category, shards);
    }

    /**
     * Check if a group has neither child groups nor assets.
     */
    private isGroupEmpty(category: AssetCategory, gid: string): boolean {
        const groups = this.assetsGroups![category];
        const group = groups[gid];
        if (!group) return false;
        const hasChildGroup = Object.values(groups).some(g => g.parentGroupId === gid);
        if (hasChildGroup) return false;
        const hasAssets = this.categoryAssets(category).some(a => a.groupId === gid);
        return !hasAssets;
    }

    /**
     * Walk up the parent chain and remove groups that become empty after deleting a child group.
     */
    private async removeEmptyParentGroups(category: AssetCategory, parentGroupId?: string): Promise<void> {
        while (parentGroupId) {
            if (!this.isGroupEmpty(category, parentGroupId)) break;
            const parent = this.assetsGroups![category][parentGroupId];
            delete this.assetsGroups![category][parentGroupId];
            // Move up the chain
            parentGroupId = parent.parentGroupId;
        }
        if (parentGroupId === undefined) {
            // We may have deleted some groups, ensure metadata flushed
            await this.writeAssetsGroupsMetadata(category);
        }
    }

    private getContext(): WorkspaceContext {
        return this.context;
    }
}
