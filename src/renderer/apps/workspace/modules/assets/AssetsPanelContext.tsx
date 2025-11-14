import { AssetType } from '@/lib/workspace/services/assets/assetTypes';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { createContext, useContext } from 'react';
import { ClipboardState } from './state/useClipboard';
import { DraggedItemState } from './state/useDragAndDrop';

interface AssetsPanelContextType {
    assets: Record<AssetType, Asset[]>;
    groups: Record<AssetType, AssetGroup[]>;
    filteredAssets: Record<AssetType, Asset[]>;
    filteredGroups: Record<AssetType, AssetGroup[]>;

    // State
    selectedItems: Set<string>;
    focusedItemId: string | null;
    draggedItem: DraggedItemState | null;
    dropTargetId: string | null;
    clipboard: ClipboardState | null;
    isMultiSelectMode: boolean;

    // Handlers
    handleItemSelect: (itemId: string, isGroup: boolean, event: React.MouseEvent) => void;
    handleAssetClick: (asset: Asset, isMultiSelectMode: boolean) => void;
    handleGroupFocus: (groupId: string) => void;
    showContextMenu: (e: React.MouseEvent, type: AssetType, item: Asset | AssetGroup | null, isGroup: boolean) => void;
    handleDragStart: (e: React.DragEvent, type: AssetType, item: Asset | AssetGroup, isGroup: boolean) => void;
    handleDragEnd: () => void;
    handleDragOverItem: (e: React.DragEvent, targetId: string) => void;
    handleDropOnItem: (e: React.DragEvent, targetType: AssetType, targetGroup: AssetGroup | null) => void;
    isFocused: (id: string) => boolean;
}

export const AssetsPanelContext = createContext<AssetsPanelContextType | null>(null);

export function useAssetsPanelContext() {
    const context = useContext(AssetsPanelContext);
    if (!context) {
        throw new Error('useAssetsPanelContext must be used within an AssetsPanelContextProvider');
    }
    return context;
}
