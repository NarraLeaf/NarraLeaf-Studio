import { useMemo, useCallback, useState, useRef } from "react";
import {
    Image, Music, Video, FileJson, Type, File,
    FolderPlus, Upload, RefreshCw, AlertCircle
} from "lucide-react";
import { useWorkspace } from "../../context";
import { PanelComponentProps } from "../types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { ContextMenu } from "@/lib/components/elements/ContextMenu";
import { useAssetsContextMenu } from "./hooks/useAssetsContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { SearchBox } from "./components/SearchBox";
import { SearchResultsPopup } from "./components/SearchResultsPopup";
import { FilterSystem } from "./components/FilterSystem";

import { useAssetData } from "./state/useAssetData";
import { useMultiSelection } from "./state/useMultiSelection";
import { useAssetSearch, SearchResult } from "./state/useAssetSearch";
import { useAssetFilters } from "./state/useAssetFilters";
import { useDragAndDrop } from "./state/useDragAndDrop";
import { useClipboard } from "./state/useClipboard";
import { useAssetFocus } from "./state/useAssetFocus";
import { useAssetActions, ContextMenuTargetState } from "./state/useAssetActions";
import { useKeyboardShortcuts } from "./state/useKeyboardShortcuts";
import { AssetsPanelContext, useAssetsPanelContext } from './AssetsPanelContext';
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";

const ASSET_TYPE_ICONS = {
    [AssetType.Image]: Image,
    [AssetType.Audio]: Music,
    [AssetType.Video]: Video,
    [AssetType.JSON]: FileJson,
    [AssetType.Font]: Type,
    [AssetType.Other]: File,
};

const ASSET_TYPE_LABELS = {
    [AssetType.Image]: "Images",
    [AssetType.Audio]: "Audio",
    [AssetType.Video]: "Videos",
    [AssetType.JSON]: "JSON Files",
    [AssetType.Font]: "Fonts",
    [AssetType.Other]: "Other",
};

export function AssetsPanel({ panelId }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const searchBoxRef = useRef<HTMLInputElement>(null);
    const inputDialog = useMemo(() => {
        if (!context) return null;
        const uiService = context.services.get<UIService>(Services.UI);
        return createInputDialog(uiService);
    }, [context]);

    const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTargetState | null>(null);
    const [actionLoading, setActionLoading] = useState(false);

    const { assets, groups, loading, error, loadAssets } = useAssetData({ context, isInitialized });

    const { focusedItemId, setFocusedItemId, handleAssetClick, handleGroupFocus, setFocusToPanel } = useAssetFocus({ context, panelId });
    
    const { selectedItems, isMultiSelectMode, handleItemSelect, handleClearSelection } = useMultiSelection({ 
        assets, 
        groups,
        onSelectionChange: (selection) => {
            if(selection.size === 1) {
                setFocusedItemId(Array.from(selection)[0]);
            }
        }
    });

    const { searchQuery, searchResults, isSearchResultsVisible, setSearchQuery, setSearchResultsVisible } = useAssetSearch({ assets, groups });

    const { filterConfigs, activeFilters, setActiveFilters, handleFilterOpen, filteredAssets, filteredGroups } = useAssetFilters({ assets, groups });
    
    const onActionComplete = useCallback(() => {
        loadAssets();
        handleClearSelection();
    }, [loadAssets, handleClearSelection]);

    const { clipboard, setClipboard } = useClipboard();

    const { 
        handleCreateGroup, handleCopy, handleCut, handlePaste, handleRename, handleDelete, handleImport, handleImportToGroup 
    } = useAssetActions({
        context, inputDialog, assets, groups, selectedItems, clipboard, contextMenuTarget,
        focusedItemId, onActionComplete, setClipboard, setActionLoading
    });

    const { 
        draggedItem, dropTargetId, dragOver, 
        setDragOver, setDropTargetId, handleDragStart, handleDragEnd, 
        handlePanelDragOver, handlePanelDragLeave, handleDragOverItem, handleDropOnItem 
    } = useDragAndDrop({ context, groups, onDropCompleted: loadAssets });

    useKeyboardShortcuts({ context, isInitialized, panelId, onCopy: handleCopy, onCut: handleCut, onPaste: handlePaste });

    const { menuState, contextMenu, showContextMenu, closeContextMenu } = useAssetsContextMenu({
        clipboard, contextMenuTarget, setContextMenuTarget, selectedItems, isMultiSelectMode,
        handleClearSelection, handleCopy, handleCut, handlePaste, handleRename, handleDelete,
        handleCreateGroup, handleImportToGroup
    });

    const handleSearchResultClick = useCallback((result: SearchResult) => {
        if (result.isGroup) {
            handleGroupFocus(result.id);
        } else {
            const asset = Object.values(assets).flat().find(a => a.id === result.id);
            if(asset) handleAssetClick(asset, false);
        }
        setSearchResultsVisible(false);
    }, [assets, handleGroupFocus, handleAssetClick, setSearchResultsVisible]);

    const handleRootDrop = useCallback(async (event: React.DragEvent, type: AssetType) => {
        if (draggedItem) {
            await handleDropOnItem(event, type, null);
        } else {
            await handleImport(type, undefined, event.dataTransfer.files);
        }
    }, [draggedItem, handleDropOnItem, handleImport]);

    if (loading && Object.values(assets).every(arr => arr.length === 0)) {
        return <div className="p-4 flex items-center gap-2 text-gray-400"><RefreshCw className="w-4 h-4 animate-spin" /> <span>Loading assets...</span></div>;
    }

    if (error) {
        return <div className="p-4 text-red-400 flex items-start gap-2"><AlertCircle className="w-4 h-4" /> <div><p>Failed to load assets</p><p className="text-xs">{error}</p></div></div>;
    }

    const contextValue = {
        assets, groups, filteredAssets, filteredGroups, selectedItems, focusedItemId, 
        draggedItem, dropTargetId, clipboard, isMultiSelectMode,
        handleItemSelect, handleAssetClick, handleGroupFocus, showContextMenu,
        handleDragStart, handleDragEnd, handleDragOverItem, handleDropOnItem,
        isFocused: (id: string) => focusedItemId === id,
    };

    return (
        <AssetsPanelContext.Provider value={contextValue}>
            <div
                className={`h-full flex flex-col ${dragOver ? 'bg-primary/10' : ''}`}
                onDragOver={handlePanelDragOver}
                onDragLeave={handlePanelDragLeave}
                onClick={setFocusToPanel}
            >
                <div className="px-3 py-2 border-b border-white/10 space-y-2">
                    <SearchBox ref={searchBoxRef} value={searchQuery} onChange={setSearchQuery} className="w-full" placeholder="Search assets..." />
                    <FilterSystem filters={filterConfigs} activeFilters={activeFilters} onFiltersChange={setActiveFilters} onFilterOpen={handleFilterOpen} />
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-gray-400">{Object.values(filteredAssets).flat().length} items</span>
                        <button onClick={loadAssets} disabled={loading} className="p-1 rounded hover:bg-white/10"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto">
                    <Accordion defaultOpen={[AssetType.Image]} multiple={true}>
                        {Object.values(AssetType).map((type) => {
                            const TypeIcon = ASSET_TYPE_ICONS[type];
                            const typeAssets = filteredAssets[type];
                            const typeGroups = filteredGroups[type];

                            return (
                                <AccordionItem
                                    key={type}
                                    id={type}
                                    icon={<TypeIcon className="w-4 h-4" />}
                                    title={`${ASSET_TYPE_LABELS[type]} (${typeAssets.length})`}
                                    actions={
                                        actionLoading ? (
                                            <RefreshCw className="w-3 h-3 animate-spin text-white" />
                                        ) : (
                                            <>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleImport(type);
                                                    }}
                                                    className="p-1 hover:text-primary"
                                                    title="Import"
                                                >
                                                    <Upload className="w-3 h-3" />
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleCreateGroup(type);
                                                    }}
                                                    className="p-1 hover:text-primary"
                                                    title="New Group"
                                                >
                                                    <FolderPlus className="w-3 h-3" />
                                                </button>
                                            </>
                                        )
                                    }
                                >
                                    <div
                                        onDrop={(e) => handleRootDrop(e, type)}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (draggedItem?.type === type) setDropTargetId(`root:${type}`);
                                        }}
                                        onContextMenu={(e) => showContextMenu(e, type, null, false)}
                                    >
                                        {typeAssets.length === 0 && typeGroups.length === 0 ? (
                                            <div className="p-4 text-center text-xs text-gray-500">No {ASSET_TYPE_LABELS[type].toLowerCase()} yet</div>
                                        ) : (
                                            <div className="py-1">
                                                {typeGroups.filter(g => !g.parentGroupId).map(group => <GroupItem key={group.id} group={group} type={type} level={0} />)}
                                                {typeAssets.filter(a => !a.groupId).map(asset => <AssetItem key={asset.id} asset={asset} type={type} level={0} />)}
                                            </div>
                                        )}
                                    </div>
                                </AccordionItem>
                            );
                        })}
                    </Accordion>
                </div>
                
                <SearchResultsPopup results={searchResults} visible={isSearchResultsVisible} onResultClick={handleSearchResultClick} onClose={() => setSearchResultsVisible(false)} searchQuery={searchQuery} anchorRef={searchBoxRef} />
                <ContextMenu items={contextMenu} position={menuState.position} visible={menuState.visible} onClose={closeContextMenu} />
            </div>
        </AssetsPanelContext.Provider>
    );
}

function GroupItem({ group, type, level }: { group: AssetGroup; type: AssetType; level: number }) {
    const { filteredAssets, filteredGroups, selectedItems, draggedItem, dropTargetId, handleItemSelect, handleGroupFocus, showContextMenu, handleDragStart, handleDragEnd, handleDragOverItem, handleDropOnItem, isFocused } = useAssetsPanelContext();
    const [isOpen, setIsOpen] = useState(false);

    const childGroups = filteredGroups[type].filter(g => g.parentGroupId === group.id);
    const groupAssets = filteredAssets[type].filter(a => a.groupId === group.id);
    const isDragging = !!draggedItem && draggedItem.isGroup && draggedItem.item.id === group.id;
    const isDropTarget = dropTargetId === `group:${group.id}`;
    const isSelected = selectedItems.has(`group:${group.id}`);

    return (
        <div>
            <div
                draggable
                className={`flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-gray-600/30 ${isSelected ? 'bg-primary/20' : ''} ${isFocused(`group:${group.id}`) ? 'bg-gray-600/10' : ''} ${isDragging ? 'opacity-50' : ''} ${isDropTarget ? 'bg-primary/20' : ''}`}
                style={{ paddingLeft: `${20 + level * 12}px` }}
                onClick={(e) => { handleItemSelect(group.id, true, e); handleGroupFocus(group.id); setIsOpen(!isOpen); }}
                onContextMenu={(e) => showContextMenu(e, type, group, true)}
                onDragStart={(e) => handleDragStart(e, type, group, true)}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => handleDragOverItem(e, `group:${group.id}`)}
                onDrop={(e) => handleDropOnItem(e, type, group)}
            >
                <FolderPlus className="w-4 h-4 text-primary" />
                <span className="text-sm">{group.name}</span>
                <span className="text-xs text-gray-500">({groupAssets.length + childGroups.length})</span>
            </div>

            {isOpen && (
                <div>
                    {childGroups.map(child => <GroupItem key={child.id} group={child} type={type} level={level + 1} />)}
                    {groupAssets.map(asset => <AssetItem key={asset.id} asset={asset} type={type} level={level + 1} />)}
                </div>
            )}
        </div>
    );
}

function AssetItem({ asset, type, level }: { asset: Asset; type: AssetType; level: number }) {
    const { selectedItems, clipboard, draggedItem, handleItemSelect, handleAssetClick, showContextMenu, handleDragStart, handleDragEnd, isFocused, isMultiSelectMode } = useAssetsPanelContext();
    const Icon = ASSET_TYPE_ICONS[asset.type];
    const isSelected = selectedItems.has(`asset:${asset.id}`);
    const isDragging = !!draggedItem && !draggedItem.isGroup && draggedItem.item.id === asset.id;

    return (
        <div
            draggable
            className={`flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-gray-600/30 ${isSelected ? 'bg-primary/20' : ''} ${isFocused(`asset:${asset.id}`) ? 'bg-gray-600/10' : ''} ${clipboard?.type === 'cut' && clipboard.assets.some(a => a.id === asset.id) ? 'opacity-40' : ''} ${isDragging ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${20 + level * 12}px` }}
            onClick={(e) => { handleItemSelect(asset.id, false, e); handleAssetClick(asset, isMultiSelectMode); }}
            onContextMenu={(e) => showContextMenu(e, type, asset, false)}
            onDragStart={(e) => handleDragStart(e, type, asset, false)}
            onDragEnd={handleDragEnd}
        >
            <Icon className="w-4 h-4 text-gray-400" />
            <span className="text-sm flex-1 truncate">{asset.name}</span>
            {asset.tags.length > 0 && <span className="text-xs text-gray-500">+{asset.tags.length}</span>}
        </div>
    );
}
