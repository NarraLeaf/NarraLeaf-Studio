import { useState, useMemo, useCallback } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { ASSET_CATEGORY_ORDER, AssetCategory } from '@/lib/workspace/services/assets/assetTypes';
import { useTranslation } from '@/lib/i18n';
import { ASSET_SIZE_BANDS, createDefaultFilters, getUniqueTags, type ActiveFilter } from '../components/FilterSystem';
import { assetMatchesQuery, buildGroupSearchPaths } from './useAssetSearch';
import { createEmptyAssetCategoryRecord } from './assetCategoryRecord';

const createEmptyAssets = (): Record<AssetCategory, Asset[]> => createEmptyAssetCategoryRecord<Asset>();

const createEmptyGroups = (): Record<AssetCategory, AssetGroup[]> => createEmptyAssetCategoryRecord<AssetGroup>();

export interface UseAssetFiltersParams {
    assets: Record<AssetCategory, Asset[]>;
    groups: Record<AssetCategory, AssetGroup[]>;
    /**
     * Owned by the panel, not by this hook: whether the library needs measuring is decided from the
     * active filters, and that decision has to be made before this pass can be handed the numbers.
     */
    activeFilters: readonly ActiveFilter[];
    /** Trimmed, lower-cased search text; empty when nothing is being searched for. */
    query: string;
    /**
     * `assetId -> bytes on disk`, or `null` while the library has not been measured. Measuring walks
     * the project's `assets/` directory, so it is only done once something actually asks a question
     * about size or usage — see {@link filtersNeedLibrarySnapshot}.
     */
    bytesByAssetId: ReadonlyMap<string, number> | null;
    /** Ids the reference index found a site for, or `null` while the index has not been read. */
    referencedAssetIds: ReadonlySet<string> | null;
    /**
     * Assets the reference index cannot answer for. Excluded from both sides of the referenced
     * filter: "unreferenced" has to mean the index looked and found nothing, or the filter is a
     * list of deletion candidates with unknowns mixed in.
     */
    usageUnknownAssetIds?: ReadonlySet<string> | null;
}

/** Filters that cannot be answered from the asset records alone. */
export function filtersNeedLibrarySnapshot(activeFilters: readonly ActiveFilter[]): boolean {
    return activeFilters.some(filter => filter.filterId === 'size' || filter.filterId === 'referenced');
}

function matchesSizeBand(bytes: number | undefined, bandIds: readonly string[]): boolean {
    if (bandIds.length === 0) {
        return true;
    }
    // No measurement means no claim: an asset whose bytes are unknown (a remote asset, a record
    // whose content file is missing) is not asserted to be in any band.
    if (bytes === undefined) {
        return false;
    }
    return bandIds.some(id => {
        const band = ASSET_SIZE_BANDS.find(candidate => candidate.id === id);
        if (!band) {
            return false;
        }
        const min = 'min' in band ? band.min : 0;
        const max = 'max' in band ? band.max : Number.POSITIVE_INFINITY;
        return bytes >= min && bytes < max;
    });
}

/**
 * One narrowing pass over the library: the search text and every active filter, applied together.
 *
 * Search is a filter here rather than a popup over an unfiltered tree, which is what made a hit
 * inside a collapsed group unreachable. Two results come out of it: `filteredAssets`/`filteredGroups`
 * (what the tree draws, ancestors kept so the structure still resolves) and `matchedGroupIds` (the
 * groups that matched *themselves*, which is what a flat grid shows — the ancestors are scaffolding,
 * not hits).
 */
export function useAssetFilters({ assets, groups, activeFilters, query, bytesByAssetId, referencedAssetIds, usageUnknownAssetIds }: UseAssetFiltersParams) {
    const { t } = useTranslation();
    const [refreshFiltersTrigger, setRefreshFiltersTrigger] = useState(0);

    const filterConfigs = useMemo(() => {
        const configs = createDefaultFilters(t);
        const allAssets = Object.values(assets).flat();

        const tagFilter = configs.find(c => c.id === 'tags');
        if (tagFilter) {
            tagFilter.options = getUniqueTags(allAssets);
        }

        const fileExtensionFilter = configs.find(c => c.id === 'file-extensions');
        if (fileExtensionFilter) {
            const existingExtensions = new Set<string>();
            allAssets.forEach(asset => {
                const extension = asset.ext || '';
                if (extension) existingExtensions.add(extension);
            });
            fileExtensionFilter.options = fileExtensionFilter.options.filter(option =>
                existingExtensions.has(option.value.toLowerCase().replace('.', ''))
            );
        }

        return configs;
    }, [assets, refreshFiltersTrigger, t]);

    const handleFilterOpen = useCallback(() => {
        setRefreshFiltersTrigger(prev => prev + 1);
    }, []);

    const filteredData = useMemo(() => {
        const tagFilters = activeFilters.filter(f => f.filterId === 'tags').map(f => f.optionId);
        const extensionFilters = activeFilters.filter(f => f.filterId === 'file-extensions').map(f => f.optionId);
        const typeFilters = new Set(activeFilters.filter(f => f.filterId === 'type').map(f => f.optionId));
        const sizeFilters = activeFilters.filter(f => f.filterId === 'size').map(f => f.optionId);
        const referencedFilter = activeFilters.find(f => f.filterId === 'referenced')?.optionId;

        if (activeFilters.length === 0 && !query) {
            return { assets, groups, matchedGroupIds: new Set<string>() };
        }

        const filteredAssets: Record<AssetCategory, Asset[]> = createEmptyAssets();
        const filteredGroups: Record<AssetCategory, AssetGroup[]> = createEmptyGroups();
        const matchedGroupIds = new Set<string>();

        ASSET_CATEGORY_ORDER.forEach(category => {
            const categoryAssets = assets[category];
            const categoryGroups = groups[category];
            const groupPaths = buildGroupSearchPaths(categoryGroups);

            if (typeFilters.size > 0 && !typeFilters.has(category)) {
                return;
            }

            filteredAssets[category] = categoryAssets.filter(asset => {
                if (!assetMatchesQuery(asset, query, groupPaths)) return false;

                if (tagFilters.length > 0 && !tagFilters.every(tag => asset.tags.includes(tag))) return false;

                const assetExtension = asset.ext || '';
                if (extensionFilters.length > 0 && !extensionFilters.includes(assetExtension)) return false;

                // Until the index has been read, an unanswerable question narrows nothing rather
                // than reporting every asset as unused.
                if (referencedFilter && referencedAssetIds) {
                    if (usageUnknownAssetIds?.has(asset.id)) return false;
                    const referenced = referencedAssetIds.has(asset.id);
                    if (referencedFilter === 'referenced' && !referenced) return false;
                    if (referencedFilter === 'unreferenced' && referenced) return false;
                }

                if (sizeFilters.length > 0 && bytesByAssetId && !matchesSizeBand(bytesByAssetId.get(asset.id), sizeFilters)) {
                    return false;
                }

                return true;
            });

            if (query) {
                categoryGroups.forEach(group => {
                    if (group.name.toLowerCase().includes(query)) {
                        matchedGroupIds.add(group.id);
                    }
                });
            }

            const relevantGroupIds = new Set<string>(matchedGroupIds);
            filteredAssets[category].forEach(asset => {
                if (asset.groupId) {
                    relevantGroupIds.add(asset.groupId);
                }
            });

            const addAncestors = (groupId: string) => {
                const group = categoryGroups.find(g => g.id === groupId);
                if (group?.parentGroupId && !relevantGroupIds.has(group.parentGroupId)) {
                    relevantGroupIds.add(group.parentGroupId);
                    addAncestors(group.parentGroupId);
                }
            };
            Array.from(relevantGroupIds).forEach(groupId => addAncestors(groupId));

            filteredGroups[category] = categoryGroups.filter(group => relevantGroupIds.has(group.id));
        });

        return { assets: filteredAssets, groups: filteredGroups, matchedGroupIds };
    }, [assets, groups, activeFilters, query, bytesByAssetId, referencedAssetIds, usageUnknownAssetIds]);

    return {
        filterConfigs,
        handleFilterOpen,
        filteredAssets: filteredData.assets,
        filteredGroups: filteredData.groups,
        /** Groups whose own name matched the search — the ones a flat result grid should show. */
        matchedGroupIds: filteredData.matchedGroupIds,
    };
}
