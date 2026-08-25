import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { FsRequestResult } from "@shared/types/os";
import { FileSystemService } from "../../core/FileSystem";
import { Services, WorkspaceContext } from "../../services";
import { ASSET_CATEGORY_ORDER, AssetCategory } from "../assetTypes";
import {
    AssetOrderDocument,
    parseAssetOrderDocument,
    serializeAssetOrderDocument,
} from "../assetOrder";
import { legacyShardTypesFor, mergeAssetOrderDocuments } from "../assetCategoryShards";

/** Whether two order documents list the same rows in the same places. */
function sameOrder(left: AssetOrderDocument, right: AssetOrderDocument): boolean {
    return sameIds(left.assetIds, right.assetIds) && sameIds(left.groupIds, right.groupIds);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((id, index) => id === right[index]);
}

function emptyOrders(): Record<AssetCategory, AssetOrderDocument> {
    const orders = {} as Record<AssetCategory, AssetOrderDocument>;
    for (const category of ASSET_CATEGORY_ORDER) {
        orders[category] = { assetIds: [], groupIds: [] };
    }
    return orders;
}

/**
 * Owns `assets/assets.order.<category>.json` — see {@link AssetOrderDocument} for what it is for.
 *
 * Initialized before the two shard managers so each can ask for the order that belongs to it. It
 * deliberately creates nothing on read: a project without the file is not broken, it is simply a
 * project from before the file existed, and it must load exactly as it always did.
 *
 * A category whose file is absent falls back to the type-named order files it was merged from
 * (`media` ← `audio`+`video`, `data` ← `json`+`blueprint`), concatenated in member order. Those are
 * hints, not membership: {@link import("../assetOrder").reconcileAssetOrder} appends anything they
 * do not mention, so the worst a stale merge can do is put a row in the wrong place.
 */
export class AssetOrderManager {
    private orders: Record<AssetCategory, AssetOrderDocument> = emptyOrders();
    /** Categories with no readable order file, i.e. the ones this open has to write. */
    private readonly missingCategories = new Set<AssetCategory>();

    constructor(private context: WorkspaceContext) {
    }

    async init(): Promise<this> {
        this.orders = emptyOrders();
        this.missingCategories.clear();

        const filesystemService = this.context.services.get<FileSystemService>(Services.FileSystem);
        for (const category of ASSET_CATEGORY_ORDER) {
            const path = this.context.project.resolve(ProjectNameConvention.AssetsOrderShard(category));
            const result = await filesystemService.readJSON<unknown>(path);
            if (result.ok) {
                this.orders[category] = parseAssetOrderDocument(result.data);
            } else {
                // Absent or unparseable: no opinion about order, except whatever the type-named
                // files this category was merged from still remember. The shards' own key order
                // stands in for the rest, which is what every build before this file shipped
                // already showed the author.
                this.orders[category] = await this.readLegacyOrders(category);
                this.missingCategories.add(category);
            }
        }

        return this;
    }

    public getAssetIds(category: AssetCategory): readonly string[] {
        return this.orders[category].assetIds;
    }

    public getGroupIds(category: AssetCategory): readonly string[] {
        return this.orders[category].groupIds;
    }

    /** Categories whose order file has to be written for the first time on this open. */
    public listMissingCategories(): AssetCategory[] {
        return Array.from(this.missingCategories);
    }

    /**
     * Record one category's row order, unless it is already the order on disk.
     *
     * ⚠ **The early return is not an optimization, and removing it breaks a live session.**
     * `AssetsService.markDirty` queues this file beside the metadata shard on every record edit,
     * because adding or removing an asset moves the order too - but renaming one does not, and
     * neither does filing it in a folder. A session leaves the metadata shard writable and this file
     * refused, and a refused write is announced to the author as work that was not saved: without
     * this, every rename inside a session would raise "could not save" about a file whose content had
     * not changed. Nothing in the session vocabulary adds a row, removes one or renames a folder, so
     * inside one this branch is taken every time.
     *
     * Outside a session it is worth having anyway: this file is rewritten on every asset mutation and
     * most of those leave the order exactly as it was.
     *
     * The comparison is against what this manager last read or wrote, which is what is on disk - and
     * a category whose file could not be read is never skipped, because "the same as what I hold" is
     * not "the same as what is there" when there is nothing there.
     */
    public async write(category: AssetCategory, assetIds: readonly string[], groupIds: readonly string[]): Promise<FsRequestResult<void>> {
        const document: AssetOrderDocument = { assetIds: [...assetIds], groupIds: [...groupIds] };
        if (!this.missingCategories.has(category) && sameOrder(this.orders[category], document)) {
            return { ok: true, data: void 0 };
        }
        this.orders[category] = document;

        const filesystemService = this.context.services.get<FileSystemService>(Services.FileSystem);
        // `writeFileNoFollowOrCreate`, not `write`. This used to say `write` because the only
        // no-grant writer that carried the rejection contract, `writeFileNoFollow`, opens with an
        // unconditional `lstat` and so can only ever *overwrite* - and this file does not exist on
        // the one open that matters most, the first open of any project that predates it. That
        // reason is gone: `writeFileNoFollowOrCreate` creates as well as replaces, both branches
        // atomically. So this write drops the grant round trip and the protocol `PUT`, and gains the
        // refusal of a symlinked or hard-linked shard. The sibling shards moved with it - see
        // `GroupAssetsManager`.
        const result = await filesystemService.writeFileNoFollowOrCreate(
            this.context.project.resolve(ProjectNameConvention.AssetsOrderShard(category)),
            serializeAssetOrderDocument(document),
            "utf-8",
        );
        // `ok` alone is not "on disk". A frozen workspace, or one whose working tree is being
        // re-read, answers `ok` with `refused` having written nothing (see `FsRequestResult`), and
        // this set means precisely "the file is not there yet". Forgetting a category on a refusal
        // is a lie about the disk that costs the author's row order: the recovery from key order is
        // only available until some later open rewrites the shard sorted.
        if (result.ok && result.refused !== true) {
            this.missingCategories.delete(category);
        }
        return result;
    }

    /** The type-named order files behind a category, read in member order. Absent files say nothing. */
    private async readLegacyOrders(category: AssetCategory): Promise<AssetOrderDocument> {
        const legacyTypes = legacyShardTypesFor(category);
        if (legacyTypes.length === 0) {
            return { assetIds: [], groupIds: [] };
        }

        const filesystemService = this.context.services.get<FileSystemService>(Services.FileSystem);
        const documents: AssetOrderDocument[] = [];
        for (const type of legacyTypes) {
            const path = this.context.project.resolve(["assets", `assets.order.${type}.json`]);
            const result = await filesystemService.readJSON<unknown>(path);
            if (result.ok) {
                documents.push(parseAssetOrderDocument(result.data));
            }
        }

        return mergeAssetOrderDocuments(documents);
    }
}
