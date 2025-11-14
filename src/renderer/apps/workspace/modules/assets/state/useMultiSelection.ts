import { useState, useCallback } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetType } from '@/lib/workspace/services/assets/assetTypes';

export interface UseMultiSelectionParams {
    assets: Record<AssetType, Asset[]>;
    groups: Record<AssetType, AssetGroup[]>;
    onSelectionChange?: (selectedItems: Set<string>) => void;
}

export function useMultiSelection({ assets, groups, onSelectionChange }: UseMultiSelectionParams) {
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [lastSelectedItem, setLastSelectedItem] = useState<string | null>(null);

    const isMultiSelectMode = selectedItems.size > 1;

    const handleItemSelect = useCallback((itemId: string, isGroup: boolean, event: React.MouseEvent) => {
        const itemKey = isGroup ? `group:${itemId}` : `asset:${itemId}`;

        let newSelection: Set<string>;

        if (event.ctrlKey || event.metaKey) {
            setSelectedItems(prev => {
                const newSet = new Set(prev);
                if (newSet.has(itemKey)) {
                    newSet.delete(itemKey);
                } else {
                    newSet.add(itemKey);
                }
                newSelection = newSet;
                return newSet;
            });
            setLastSelectedItem(itemKey);
        } else if (event.shiftKey && lastSelectedItem) {
            const orderedKeys: string[] = [];
            const traverseGroups = (grpList: AssetGroup[], assetList: Asset[], parentId?: string) => {
                grpList.filter(g => g.parentGroupId === parentId).forEach(g => {
                    orderedKeys.push(`group:${g.id}`);
                    traverseGroups(grpList, assetList, g.id);
                });
                assetList.filter(a => (a.groupId || undefined) === (parentId || undefined)).forEach(a => {
                    orderedKeys.push(`asset:${a.id}`);
                });
            };

            Object.values(AssetType).forEach(t => {
                traverseGroups(groups[t], assets[t]);
            });

            const start = orderedKeys.indexOf(lastSelectedItem);
            const end = orderedKeys.indexOf(itemKey);
            if (start !== -1 && end !== -1) {
                const [from, to] = start < end ? [start, end] : [end, start];
                const range = orderedKeys.slice(from, to + 1);
                newSelection = new Set(range);
                setSelectedItems(newSelection);
            }
        } else {
            newSelection = new Set([itemKey]);
            setSelectedItems(newSelection);
            setLastSelectedItem(itemKey);
        }

        if (onSelectionChange && newSelection!) {
            onSelectionChange(newSelection);
        }
    }, [lastSelectedItem, assets, groups, onSelectionChange]);

    const handleClearSelection = useCallback(() => {
        setSelectedItems(new Set());
        setLastSelectedItem(null);
        if (onSelectionChange) {
            onSelectionChange(new Set());
        }
    }, [onSelectionChange]);

    const handleSelectAll = useCallback((items: Array<{ id: string, isGroup: boolean }>) => {
        const allKeys = items.map(item => item.isGroup ? `group:${item.id}` : `asset:${item.id}`);
        const newSelection = new Set(allKeys);
        setSelectedItems(newSelection);
        setLastSelectedItem(null);
        if (onSelectionChange) {
            onSelectionChange(newSelection);
        }
    }, [onSelectionChange]);

    return {
        selectedItems,
        isMultiSelectMode,
        handleItemSelect,
        handleClearSelection,
        handleSelectAll,
        setSelectedItems, // Expose setter for external control if needed
    };
}
