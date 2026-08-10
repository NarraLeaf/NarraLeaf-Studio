import { AssetCategory } from '@/lib/workspace/services/assets/assetTypes';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import type { MediaAssetSupportRecord } from '@/lib/workspace/services/media/mediaAssetSupport';
import { createContext, useContext } from 'react';
import { ClipboardState } from './state/useClipboard';
import { DraggedItemState } from './state/useDragAndDrop';

/** Breadcrumb shown in the panel toolbar center when the assets panel uses a compact (bottom) toolbar. */
export interface AssetsIconViewToolbarCenter {
    title: string;
    onBack: () => void;
}

interface AssetsPanelContextType {
    /**
     * Keyed by sidebar section. The assets inside still carry their own `type`; what a section, a
     * folder and a drop target belong to is the category.
     */
    assets: Record<AssetCategory, Asset[]>;
    groups: Record<AssetCategory, AssetGroup[]>;
    filteredAssets: Record<AssetCategory, Asset[]>;
    filteredGroups: Record<AssetCategory, AssetGroup[]>;
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
    showContextMenu: (e: React.MouseEvent, category: AssetCategory, item: Asset | AssetGroup | null, isGroup: boolean) => void;
    handleDragStart?: (e: React.DragEvent, category: AssetCategory, item: Asset | AssetGroup, isGroup: boolean) => void;
    handleDragEnd?: () => void;
    handleDragOverItem?: (e: React.DragEvent, targetId: string) => void;
    handleDropOnItem?: (e: React.DragEvent, targetCategory: AssetCategory, targetGroup: AssetGroup | null) => void;
    handleImportToGroup: (category: AssetCategory, groupId?: string, files?: FileList, dataTransfer?: DataTransfer) => void;
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
    /** Takes an updater as well, so a view can leave the breadcrumb alone when nothing about it moved. */
    setAssetsIconToolbarCenter: React.Dispatch<React.SetStateAction<AssetsIconViewToolbarCenter | null>>;

    /**
     * Assets that will not play as they are, keyed by asset id.
     *
     * Only assets with something wrong appear, so a lookup that misses means "nothing to say" -
     * which is also the honest answer before the first scan has finished and on a host that cannot
     * check at all. Keyed by id rather than by `Asset`, because the library edits its records in
     * place and a reference to one never changes.
     */
    mediaSupport: ReadonlyMap<string, MediaAssetSupportRecord>;
    /** Opens the conversion for one asset. Refused for anything the scan did not mark. */
    handleConvertMedia: (asset: Asset) => void;
}

export const AssetsPanelContext = createContext<AssetsPanelContextType | null>(null);

export function useAssetsPanelContext() {
    const context = useContext(AssetsPanelContext);
    if (!context) {
        throw new Error('useAssetsPanelContext must be used within an AssetsPanelContextProvider');
    }
    return context;
}
