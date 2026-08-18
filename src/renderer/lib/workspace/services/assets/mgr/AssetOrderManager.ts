import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import { FsRequestResult } from "@shared/types/os";
import { FileSystemService } from "../../core/FileSystem";
import { Services, WorkspaceContext } from "../../services";
import { ASSET_CATEGORY_ORDER, AssetCategory } from "../assetTypes";
import {
  AssetOrderDocument,
  parseAssetOrderDocument,
  serializeAssetOrderDocument
} from "../assetOrder";
import { legacyShardTypesFor, mergeAssetOrderDocuments } from "../assetCategoryShards";

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

  constructor(private context: WorkspaceContext) {}

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

  public async write(
    category: AssetCategory,
    assetIds: readonly string[],
    groupIds: readonly string[]
  ): Promise<FsRequestResult<void>> {
    const document: AssetOrderDocument = { assetIds: [...assetIds], groupIds: [...groupIds] };
    this.orders[category] = document;

    const filesystemService = this.context.services.get<FileSystemService>(Services.FileSystem);
    // `write`, not `writeFileNoFollow`: the no-follow writer opens with an unconditional `lstat`
    // so it can inspect and refuse a symlink, which means it can only ever *overwrite*. This
    // file does not exist on the one open that matters most — the first open of any project that
    // predates it, i.e. every project in existence — and that write failing is not a cosmetic
    // loss: it is the open on which the author's row order is still recoverable from key order.
    // The sibling shards use `write` for the same reason. See `GroupAssetsManager`.
    const result = await filesystemService.write(
      this.context.project.resolve(ProjectNameConvention.AssetsOrderShard(category)),
      serializeAssetOrderDocument(document),
      "utf-8"
    );
    if (result.ok) {
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
