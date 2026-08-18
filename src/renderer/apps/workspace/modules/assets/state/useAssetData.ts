import { useState, useCallback, useEffect } from "react";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import {
  ASSET_CATEGORY_ORDER,
  ASSET_CATEGORY_TYPES,
  AssetCategory
} from "@/lib/workspace/services/assets/assetTypes";
import { WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { createEmptyAssetCategoryRecord } from "./assetCategoryRecord";

const createEmptyAssets = (): Record<AssetCategory, Asset[]> =>
  createEmptyAssetCategoryRecord<Asset>();

const createEmptyGroups = (): Record<AssetCategory, AssetGroup[]> =>
  createEmptyAssetCategoryRecord<AssetGroup>();

interface AssetDataSnapshot {
  assets: Record<AssetCategory, Asset[]>;
  groups: Record<AssetCategory, AssetGroup[]>;
}

const assetDataCache = new Map<string, AssetDataSnapshot>();

function getCacheKey(context: WorkspaceContext | null): string | null {
  return context?.project.getConfig().projectPath ?? null;
}

function cloneAssets(assets: Record<AssetCategory, Asset[]>): Record<AssetCategory, Asset[]> {
  const next = createEmptyAssets();
  for (const category of ASSET_CATEGORY_ORDER) {
    next[category] = [...(assets[category] ?? [])];
  }
  return next;
}

function cloneGroups(
  groups: Record<AssetCategory, AssetGroup[]>
): Record<AssetCategory, AssetGroup[]> {
  const next = createEmptyGroups();
  for (const category of ASSET_CATEGORY_ORDER) {
    next[category] = [...(groups[category] ?? [])];
  }
  return next;
}

export interface UseAssetDataParams {
  context: WorkspaceContext | null;
  isInitialized: boolean;
}

export function useAssetData({ context, isInitialized }: UseAssetDataParams) {
  const cacheKey = getCacheKey(context);
  const cachedSnapshot = cacheKey ? assetDataCache.get(cacheKey) : undefined;
  const [assets, setAssets] = useState<Record<AssetCategory, Asset[]>>(() =>
    cachedSnapshot ? cloneAssets(cachedSnapshot.assets) : createEmptyAssets()
  );
  const [groups, setGroups] = useState<Record<AssetCategory, AssetGroup[]>>(() =>
    cachedSnapshot ? cloneGroups(cachedSnapshot.groups) : createEmptyGroups()
  );
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(Boolean(cachedSnapshot));
  const [error, setError] = useState<string | null>(null);

  const loadAssets = useCallback(async () => {
    if (!context) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const assetsService = context.services.get<AssetsService>(Services.Assets);

      const newAssets: Record<AssetCategory, Asset[]> = createEmptyAssets();
      const newGroups: Record<AssetCategory, AssetGroup[]> = createEmptyGroups();

      for (const category of ASSET_CATEGORY_ORDER) {
        // Explicit order, not `Object.values`: this list is what the grid draws and what
        // shift-range selection slices, so once shards are written with sorted keys a
        // range would cover a different set of rows than the author has on screen. A
        // section's rows are its member types' rows, concatenated in member order.
        newAssets[category] = ASSET_CATEGORY_TYPES[category].flatMap(
          (type) => assetsService.getOrderedAssets(type) as Asset[]
        );
        newGroups[category] = assetsService.getGroupAssetsManager().getGroups(category);
      }

      setAssets(newAssets);
      setGroups(newGroups);
      setHasLoaded(true);
      const nextCacheKey = getCacheKey(context);
      if (nextCacheKey) {
        assetDataCache.set(nextCacheKey, {
          assets: cloneAssets(newAssets),
          groups: cloneGroups(newGroups)
        });
      }
    } catch (err) {
      console.error("Failed to load assets:", err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [context]);

  useEffect(() => {
    if (!cacheKey) {
      setAssets(createEmptyAssets());
      setGroups(createEmptyGroups());
      setHasLoaded(false);
      return;
    }

    const snapshot = assetDataCache.get(cacheKey);
    if (!snapshot) {
      setAssets(createEmptyAssets());
      setGroups(createEmptyGroups());
      setHasLoaded(false);
      return;
    }

    setAssets(cloneAssets(snapshot.assets));
    setGroups(cloneGroups(snapshot.groups));
    setHasLoaded(true);
  }, [cacheKey]);

  useEffect(() => {
    if (isInitialized) {
      loadAssets();
    }
  }, [isInitialized, loadAssets]);

  useEffect(() => {
    if (!context || !isInitialized) {
      return;
    }

    const assetsService = context.services.get<AssetsService>(Services.Assets);

    const unsubscribeAssetUpdate = assetsService.getEvents().on("updated", () => {
      loadAssets();
    });
    const unsubscribeAssetDelete = assetsService.getEvents().on("deleted", () => {
      loadAssets();
    });
    const unsubscribeGroupsUpdate = assetsService.getEvents().on("groupsUpdated", () => {
      loadAssets();
    });

    return () => {
      unsubscribeAssetUpdate();
      unsubscribeAssetDelete();
      unsubscribeGroupsUpdate();
    };
  }, [context, isInitialized, loadAssets]);

  return { assets, groups, loading, hasLoaded, error, loadAssets };
}
