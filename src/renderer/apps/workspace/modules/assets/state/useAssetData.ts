import { useState, useCallback, useEffect } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetType } from '@/lib/workspace/services/assets/assetTypes';
import { WorkspaceContext } from '@/lib/workspace/services/services';
import { AssetsService } from '@/lib/workspace/services/core/AssetsService';
import { Services } from '@/lib/workspace/services/services';

const createEmptyAssets = (): Record<AssetType, Asset[]> => ({
    [AssetType.Image]: [],
    [AssetType.Audio]: [],
    [AssetType.Video]: [],
    [AssetType.JSON]: [],
    [AssetType.Blueprint]: [],
    [AssetType.Font]: [],
    [AssetType.Other]: [],
});

const createEmptyGroups = (): Record<AssetType, AssetGroup[]> => ({
    [AssetType.Image]: [],
    [AssetType.Audio]: [],
    [AssetType.Video]: [],
    [AssetType.JSON]: [],
    [AssetType.Blueprint]: [],
    [AssetType.Font]: [],
    [AssetType.Other]: [],
});

interface AssetDataSnapshot {
    assets: Record<AssetType, Asset[]>;
    groups: Record<AssetType, AssetGroup[]>;
}

const assetDataCache = new Map<string, AssetDataSnapshot>();

function getCacheKey(context: WorkspaceContext | null): string | null {
    return context?.project.getConfig().projectPath ?? null;
}

function cloneAssets(assets: Record<AssetType, Asset[]>): Record<AssetType, Asset[]> {
    const next = createEmptyAssets();
    for (const type of Object.values(AssetType)) {
        next[type] = [...(assets[type] ?? [])];
    }
    return next;
}

function cloneGroups(groups: Record<AssetType, AssetGroup[]>): Record<AssetType, AssetGroup[]> {
    const next = createEmptyGroups();
    for (const type of Object.values(AssetType)) {
        next[type] = [...(groups[type] ?? [])];
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
    const [assets, setAssets] = useState<Record<AssetType, Asset[]>>(() => cachedSnapshot ? cloneAssets(cachedSnapshot.assets) : createEmptyAssets());
    const [groups, setGroups] = useState<Record<AssetType, AssetGroup[]>>(() => cachedSnapshot ? cloneGroups(cachedSnapshot.groups) : createEmptyGroups());
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
            const assetsMap = assetsService.getAssets();

            const newAssets: Record<AssetType, Asset[]> = createEmptyAssets();
            const newGroups: Record<AssetType, AssetGroup[]> = createEmptyGroups();

            for (const type of Object.values(AssetType)) {
                newAssets[type] = Object.values(assetsMap[type]);
                newGroups[type] = assetsService.getGroupAssetsManager().getGroups(type);
            }

            setAssets(newAssets);
            setGroups(newGroups);
            setHasLoaded(true);
            const nextCacheKey = getCacheKey(context);
            if (nextCacheKey) {
                assetDataCache.set(nextCacheKey, {
                    assets: cloneAssets(newAssets),
                    groups: cloneGroups(newGroups),
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
