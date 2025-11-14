import { useState, useCallback } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetType } from '@/lib/workspace/services/assets/assetTypes';

export interface SearchResult {
    id: string;
    name: string;
    type: AssetType;
    isGroup: boolean;
    groupPath?: string[];
    matchReason: 'name' | 'tag' | 'description';
    matchText: string;
}

export interface UseAssetSearchParams {
    assets: Record<AssetType, Asset[]>;
    groups: Record<AssetType, AssetGroup[]>;
}

export function useAssetSearch({ assets, groups }: UseAssetSearchParams) {
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
    const [isSearchResultsVisible, setSearchResultsVisible] = useState(false);

    const performSearch = useCallback((query: string) => {
        if (!query.trim()) {
            setSearchResults([]);
            setSearchResultsVisible(false);
            return;
        }

        const results: SearchResult[] = [];
        const lowerQuery = query.toLowerCase();

        Object.values(AssetType).forEach(assetType => {
            const typeAssets = assets[assetType];
            const typeGroups = groups[assetType];

            const groupPathMap = new Map<string, string[]>();
            const buildGroupPath = (group: AssetGroup, path: string[] = []): void => {
                groupPathMap.set(group.id, [...path, group.name]);
                const childGroups = typeGroups.filter(g => g.parentGroupId === group.id);
                childGroups.forEach(child => buildGroupPath(child, [...path, group.name]));
            };
            typeGroups.filter(g => !g.parentGroupId).forEach(group => buildGroupPath(group));

            typeAssets.forEach(asset => {
                if (asset.name.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        id: asset.id, name: asset.name, type: asset.type, isGroup: false,
                        groupPath: asset.groupId ? groupPathMap.get(asset.groupId) : undefined,
                        matchReason: 'name', matchText: asset.name,
                    });
                } else if (asset.tags.some(tag => tag.toLowerCase().includes(lowerQuery))) {
                    const matchingTag = asset.tags.find(tag => tag.toLowerCase().includes(lowerQuery));
                    results.push({
                        id: asset.id, name: asset.name, type: asset.type, isGroup: false,
                        groupPath: asset.groupId ? groupPathMap.get(asset.groupId) : undefined,
                        matchReason: 'tag', matchText: matchingTag || '',
                    });
                } else if (asset.description.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        id: asset.id, name: asset.name, type: asset.type, isGroup: false,
                        groupPath: asset.groupId ? groupPathMap.get(asset.groupId) : undefined,
                        matchReason: 'description', matchText: asset.description,
                    });
                }
            });

            typeGroups.forEach(group => {
                if (group.name.toLowerCase().includes(lowerQuery)) {
                    const parentPath = group.parentGroupId ? groupPathMap.get(group.parentGroupId) : [];
                    results.push({
                        id: group.id, name: group.name, type: group.type, isGroup: true,
                        groupPath: parentPath?.length ? parentPath : undefined,
                        matchReason: 'name', matchText: group.name,
                    });
                }
            });
        });

        setSearchResults(results);
        setSearchResultsVisible(query.trim().length > 0);
    }, [assets, groups]);

    const handleSearchQueryChange = useCallback((query: string) => {
        setSearchQuery(query);
        performSearch(query);
    }, [performSearch]);

    return {
        searchQuery,
        searchResults,
        isSearchResultsVisible,
        setSearchQuery: handleSearchQueryChange,
        setSearchResultsVisible,
    };
}
