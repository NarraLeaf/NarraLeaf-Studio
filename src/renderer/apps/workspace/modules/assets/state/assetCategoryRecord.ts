import { ASSET_CATEGORY_ORDER, AssetCategory } from "@/lib/workspace/services/assets/assetTypes";

/**
 * An empty `category -> list` record, in sidebar order.
 *
 * The panel keys its rows by {@link AssetCategory} and not by `AssetType`, because a category is
 * what a section, a folder and a drop target belong to. The assets inside still carry their own
 * `type`, which is what the row icon, the inspector and every service call read.
 */
export function createEmptyAssetCategoryRecord<T>(): Record<AssetCategory, T[]> {
  const record = {} as Record<AssetCategory, T[]>;
  for (const category of ASSET_CATEGORY_ORDER) {
    record[category] = [];
  }
  return record;
}
