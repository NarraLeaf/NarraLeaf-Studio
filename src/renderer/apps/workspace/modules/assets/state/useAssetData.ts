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
    [AssetType.Font]: [],
    [AssetType.Other]: [],
});

const createEmptyGroups = (): Record<AssetType, AssetGroup[]> => ({
    [AssetType.Image]: [],
    [AssetType.Audio]: [],
    [AssetType.Video]: [],
    [AssetType.JSON]: [],
    [AssetType.Font]: [],
    [AssetType.Other]: [],
});

export interface UseAssetDataParams {
    context: WorkspaceContext | null;
    isInitialized: boolean;
}

export function useAssetData({ context, isInitialized }: UseAssetDataParams) {
    const [assets, setAssets] = useState<Record<AssetType, Asset[]>>(createEmptyAssets);
    const [groups, setGroups] = useState<Record<AssetType, AssetGroup[]>>(createEmptyGroups);
    const [loading, setLoading] = useState(false);
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
                newGroups[type] = assetsService.getGroups(type);
            }

            setAssets(newAssets);
            setGroups(newGroups);
        } catch (err) {
            console.error("Failed to load assets:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [context]);

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

        return () => {
            unsubscribeAssetUpdate();
        };
    }, [context, isInitialized, loadAssets]);

    return { assets, groups, loading, error, loadAssets };
}
