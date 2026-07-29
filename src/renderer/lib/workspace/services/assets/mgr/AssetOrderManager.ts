import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { FsRequestResult } from "@shared/types/os";
import { FileSystemService } from "../../core/FileSystem";
import { Services, WorkspaceContext } from "../../services";
import { AssetType } from "../assetTypes";
import {
    AssetOrderDocument,
    parseAssetOrderDocument,
    serializeAssetOrderDocument,
} from "../assetOrder";

function emptyOrders(): Record<AssetType, AssetOrderDocument> {
    return {
        [AssetType.Image]: { assetIds: [], groupIds: [] },
        [AssetType.Audio]: { assetIds: [], groupIds: [] },
        [AssetType.Video]: { assetIds: [], groupIds: [] },
        [AssetType.JSON]: { assetIds: [], groupIds: [] },
        [AssetType.Blueprint]: { assetIds: [], groupIds: [] },
        [AssetType.Font]: { assetIds: [], groupIds: [] },
        [AssetType.Model]: { assetIds: [], groupIds: [] },
        [AssetType.Other]: { assetIds: [], groupIds: [] },
    };
}

/**
 * Owns `assets/assets.order.<type>.json` — see {@link AssetOrderDocument} for what it is for.
 *
 * Initialized before the two shard managers so each can ask for the order that belongs to it. It
 * deliberately creates nothing on read: a project without the file is not broken, it is simply a
 * project from before the file existed, and it must load exactly as it always did.
 */
export class AssetOrderManager {
    private orders: Record<AssetType, AssetOrderDocument> = emptyOrders();
    /** Types with no readable order file, i.e. the ones this open has to write. */
    private readonly missingTypes = new Set<AssetType>();

    constructor(private context: WorkspaceContext) {
    }

    async init(): Promise<this> {
        this.orders = emptyOrders();
        this.missingTypes.clear();

        const filesystemService = this.context.services.get<FileSystemService>(Services.FileSystem);
        for (const type of Object.values(AssetType)) {
            const path = this.context.project.resolve(ProjectNameConvention.AssetsOrderShard(type));
            const result = await filesystemService.readJSON<unknown>(path);
            if (result.ok) {
                this.orders[type] = parseAssetOrderDocument(result.data);
            } else {
                // Absent or unparseable: no opinion about order. The shard's own key order stands in,
                // which is what every build before this file shipped already showed the author.
                this.missingTypes.add(type);
            }
        }

        return this;
    }

    public getAssetIds(type: AssetType): readonly string[] {
        return this.orders[type].assetIds;
    }

    public getGroupIds(type: AssetType): readonly string[] {
        return this.orders[type].groupIds;
    }

    /** Types whose order file has to be written for the first time on this open. */
    public listMissingTypes(): AssetType[] {
        return Array.from(this.missingTypes);
    }

    public async write(type: AssetType, assetIds: readonly string[], groupIds: readonly string[]): Promise<FsRequestResult<void>> {
        const document: AssetOrderDocument = { assetIds: [...assetIds], groupIds: [...groupIds] };
        this.orders[type] = document;

        const filesystemService = this.context.services.get<FileSystemService>(Services.FileSystem);
        // `write`, not `writeFileNoFollow`: the no-follow writer opens with an unconditional `lstat`
        // so it can inspect and refuse a symlink, which means it can only ever *overwrite*. This
        // file does not exist on the one open that matters most — the first open of any project that
        // predates it, i.e. every project in existence — and that write failing is not a cosmetic
        // loss: it is the open on which the author's row order is still recoverable from key order.
        // The sibling shards use `write` for the same reason. See `GroupAssetsManager`.
        const result = await filesystemService.write(
            this.context.project.resolve(ProjectNameConvention.AssetsOrderShard(type)),
            serializeAssetOrderDocument(document),
            "utf-8",
        );
        if (result.ok) {
            this.missingTypes.delete(type);
        }
        return result;
    }
}
