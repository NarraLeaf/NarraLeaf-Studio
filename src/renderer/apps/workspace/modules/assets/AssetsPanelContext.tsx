import { AssetType } from '@/lib/workspace/services/assets/assetTypes';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { createContext, useContext } from 'react';
import { ClipboardState } from './state/useClipboard';
import { DraggedItemState } from './state/useDragAndDrop';

/** Breadcrumb shown in the panel toolbar center when the assets panel uses a compact (bottom) toolbar. */
export interface AssetsIconViewToolbarCenter {
    title: string;
    onBack: () => void;
}

interface AssetsPanelContextType {
    assets: Record<AssetType, Asset[]>;
    groups: Record<AssetType, AssetGroup[]>;
    filteredAssets: Record<AssetType, Asset[]>;
    filteredGroups: Record<AssetType, AssetGroup[]>;
    /**
     * Groups whose own name matched the search. `filteredGroups` also carries the ancestors needed
     * to draw a tree; those are scaffolding, and a flat result grid must not present them as hits.
     */
    matchedGroupIds: ReadonlySet<string>;

    // State
    selectedItems: Set<string>;
    focusedItemId: string | null;
    draggedItem?: DraggedItemState | null;
    dropTargetId?: string | null;
    clipboard: ClipboardState | null;
    isMultiSelectMode: boolean;
    expandedGroups: Set<string>;
    setExpandedGroups: React.Dispatch<React.SetStateAction<Set<string>>>;

    // Handlers
    handleItemSelect: (itemId: string, isGroup: boolean, event: React.MouseEvent) => void;
    handleAssetClick: (asset: Asset, isMultiSelectMode: boolean) => void;
    handleGroupFocus: (groupId: string) => void;
    showContextMenu: (e: React.MouseEvent, type: AssetType, item: Asset | AssetGroup | null, isGroup: boolean) => void;
    handleDragStart?: (e: React.DragEvent, type: AssetType, item: Asset | AssetGroup, isGroup: boolean) => void;
    handleDragEnd?: () => void;
    handleDragOverItem?: (e: React.DragEvent, targetId: string) => void;
    handleDropOnItem?: (e: React.DragEvent, targetType: AssetType, targetGroup: AssetGroup | null) => void;
    handleImportToGroup: (type: AssetType, groupId?: string, files?: FileList, dataTransfer?: DataTransfer) => void;
    isFocused: (id: string) => boolean;

    /**
     * True when a search or a filter is currently narrowing `filteredAssets` / `filteredGroups`.
     *
     * The views read this to stop hiding hits behind folders: a match filed inside a collapsed group
     * has to be on screen, so the tree force-opens and the grid goes flat while this is set.
     */
    isNarrowed: boolean;

    /** True when the panel uses the compact toolbar (e.g. bottom dock). Icon view can merge group navigation there. */
    compactToolbar: boolean;
    setAssetsIconToolbarCenter: (state: AssetsIconViewToolbarCenter | null) => void;
}

export const AssetsPanelContext = createContext<AssetsPanelContextType | null>(null);

export function useAssetsPanelContext() {
    const context = useContext(AssetsPanelContext);
    if (!context) {
        throw new Error('useAssetsPanelContext must be used within an AssetsPanelContextProvider');
    }
    return context;
}
