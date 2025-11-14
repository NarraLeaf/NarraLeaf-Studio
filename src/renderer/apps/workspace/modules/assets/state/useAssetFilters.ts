import { useState, useMemo, useCallback } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetType } from '@/lib/workspace/services/assets/assetTypes';
import { createDefaultFilters, getUniqueTags } from '../components/FilterSystem';

const createEmptyAssets = (): Record<AssetType, Asset[]> => ({
    [AssetType.Image]: [], [AssetType.Audio]: [], [AssetType.Video]: [],
    [AssetType.JSON]: [], [AssetType.Font]: [], [AssetType.Other]: [],
});

const createEmptyGroups = (): Record<AssetType, AssetGroup[]> => ({
    [AssetType.Image]: [], [AssetType.Audio]: [], [AssetType.Video]: [],
    [AssetType.JSON]: [], [AssetType.Font]: [], [AssetType.Other]: [],
});

export interface UseAssetFiltersParams {
    assets: Record<AssetType, Asset[]>;
    groups: Record<AssetType, AssetGroup[]>;
}

export function useAssetFilters({ assets, groups }: UseAssetFiltersParams) {
    const [activeFilters, setActiveFilters] = useState<any[]>([]);
    const [refreshFiltersTrigger, setRefreshFiltersTrigger] = useState(0);

    const filterConfigs = useMemo(() => {
        const configs = createDefaultFilters();
        const allAssets = Object.values(assets).flat();
        
        const tagFilter = configs.find(c => c.id === 'tags');
        if (tagFilter) {
            tagFilter.options = getUniqueTags(allAssets);
        }

        const fileExtensionFilter = configs.find(c => c.id === 'file-extensions');
        if (fileExtensionFilter) {
            const existingExtensions = new Set<string>();
            allAssets.forEach(asset => {
                const extension = asset.name.toLowerCase().split('.').pop();
                if (extension) existingExtensions.add(extension);
            });
            fileExtensionFilter.options = fileExtensionFilter.options.filter(option =>
                existingExtensions.has(option.value.toLowerCase().replace('.', ''))
            );
        }

        return configs;
    }, [assets, refreshFiltersTrigger]);

    const handleFilterOpen = useCallback(() => {
        setRefreshFiltersTrigger(prev => prev + 1);
    }, []);

    const filteredData = useMemo(() => {
        if (activeFilters.length === 0) {
            return { assets, groups };
        }

        const filteredAssets: Record<AssetType, Asset[]> = createEmptyAssets();
        const filteredGroups: Record<AssetType, AssetGroup[]> = createEmptyGroups();

        const tagFilters = activeFilters.filter(f => f.filterId === 'tags').map(f => f.optionId);
        const extensionFilters = activeFilters.filter(f => f.filterId === 'file-extensions').map(f => f.optionId);

        Object.values(AssetType).forEach(assetType => {
            const typeAssets = assets[assetType];
            const typeGroups = groups[assetType];

            filteredAssets[assetType] = typeAssets.filter(asset => {
                if (tagFilters.length > 0 && !tagFilters.some(tag => asset.tags.includes(tag))) return false;
                
                const assetExtension = asset.name.toLowerCase().split('.').pop();
                if (extensionFilters.length > 0 && assetExtension && !extensionFilters.includes(assetExtension)) return false;

                return true;
            });

            const assetGroupIds = new Set(filteredAssets[assetType].map(a => a.groupId).filter(Boolean));
            const relevantGroupIds = new Set(assetGroupIds);
            
            const addAncestors = (groupId: string) => {
                const group = typeGroups.find(g => g.id === groupId);
                if (group?.parentGroupId) {
                    relevantGroupIds.add(group.parentGroupId);
                    addAncestors(group.parentGroupId);
                }
            };
            assetGroupIds.forEach(groupId => addAncestors(groupId as string));

            filteredGroups[assetType] = typeGroups.filter(group => relevantGroupIds.has(group.id));
        });

        return { assets: filteredAssets, groups: filteredGroups };
    }, [assets, groups, activeFilters]);

    return {
        filterConfigs,
        activeFilters,
        setActiveFilters,
        handleFilterOpen,
        filteredAssets: filteredData.assets,
        filteredGroups: filteredData.groups,
    };
}
