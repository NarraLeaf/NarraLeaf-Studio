import { useMemo, useCallback, useState, useRef, useEffect, ComponentType } from "react";
import { LayoutGrid, LayoutList, RefreshCw, AlertCircle, Copy, Scissors, Clipboard, Trash, Search, X } from "lucide-react";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { PanelComponentProps } from "../types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset } from "@/lib/workspace/services/assets/types";
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
import { AssetsPanelContext } from './AssetsPanelContext';
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { MagicTagDialog } from "./components/MagicTagDialog";
import { MagicTagTemplate } from "@/lib/workspace/services/core/MagicTagManager";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { AssetsListView } from "./views/AssetsListView";
import { AssetsIconView } from "./views/AssetsIconView";

export type AssetViewMode = "list" | "icons";

const VIEW_MODE_OPTIONS: { id: AssetViewMode; icon: ComponentType<any>; label: string }[] = [
    {
        id: "list",
        icon: LayoutList,
        label: "List view",
    },
    {
        id: "icons",
        icon: LayoutGrid,
        label: "Icon view",
    },
];

interface AssetsPanelPayload {
    defaultViewMode?: AssetViewMode;
    defaultIconSize?: number;
    focusArea?: FocusArea;
    showHeader?: boolean;
}

interface AssetsPanelState {
    viewMode?: AssetViewMode;
    iconSize?: number;
}

export function AssetsPanel({ panelId, payload }: PanelComponentProps<AssetsPanelPayload>) {
    const { context, isInitialized } = useWorkspace();
    const { registerActionGroup, unregisterActionGroup } = useRegistry();
    const searchBoxRef = useRef<HTMLInputElement>(null);
    const inputDialog = useMemo(() => {
        if (!context) return null;
        const uiService = context.services.get<UIService>(Services.UI);
        return createInputDialog(uiService);
    }, [context]);

    const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTargetState | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    
    // Magic Tags state
    const [magicTagDialogVisible, setMagicTagDialogVisible] = useState(false);
    const [magicTagTemplate, setMagicTagTemplate] = useState<MagicTagTemplate | null>(null);
    const [magicTagAssets, setMagicTagAssets] = useState<Asset[]>([]);
    const [isSearchActive, setIsSearchActive] = useState(false);

    const defaultViewMode = payload?.defaultViewMode ?? "list";
    const defaultIconSize = payload?.defaultIconSize ?? 140;
    const focusArea = payload?.focusArea ?? FocusArea.LeftPanel;
    const showHeader = payload?.showHeader ?? true;
    const [viewMode, setViewMode] = useState<AssetViewMode>(defaultViewMode);
    const [iconSize, setIconSize] = useState<number>(defaultIconSize);
    const [stateReady, setStateReady] = useState(false);
    const [hasPersistedViewMode, setHasPersistedViewMode] = useState(false);
    const [hasPersistedIconSize, setHasPersistedIconSize] = useState(false);

    useEffect(() => {
        if (!hasPersistedViewMode) {
            setViewMode(defaultViewMode);
        }
    }, [defaultViewMode, hasPersistedViewMode]);

    useEffect(() => {
        if (!hasPersistedIconSize) {
            setIconSize(defaultIconSize);
        }
    }, [defaultIconSize, hasPersistedIconSize]);

    useEffect(() => {
        if (!context) return;
        setStateReady(false);
        setHasPersistedViewMode(false);
        setHasPersistedIconSize(false);

        const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
        const saved = panelStateService.getPanelState<AssetsPanelState>(panelId);
        if (saved?.viewMode) {
            setViewMode(saved.viewMode);
            setHasPersistedViewMode(true);
        }
        if (typeof saved?.iconSize === "number") {
            setIconSize(saved.iconSize);
            setHasPersistedIconSize(true);
        }
        setStateReady(true);
    }, [context, panelId]);

    useEffect(() => {
        if (!context || !stateReady) return;
        const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
        panelStateService.setPanelState<AssetsPanelState>(panelId, { viewMode, iconSize });
    }, [context, panelId, viewMode, iconSize, stateReady]);

    const { assets, groups, loading, error, loadAssets } = useAssetData({ context, isInitialized });

    const { focusedItemId, setFocusedItemId, handleAssetClick, handleGroupFocus, setFocusToPanel } = useAssetFocus({ context, panelId, focusArea });
    
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

    // Function to expand a group by its ID
    const expandGroup = useCallback((groupId: string) => {
        setExpandedGroups(prev => new Set(prev).add(groupId));
    }, []);

    const {
        handleCreateGroup, handleCopy, handleCut, handlePaste, handleRename, handleDelete, handleImport, handleImportToGroup, handleImportRemote,
        handleCreateMagicTags, handleApplyMagicTags
    } = useAssetActions({
        context, inputDialog, assets, groups, selectedItems, clipboard, contextMenuTarget,
        focusedItemId, onActionComplete, setClipboard, setActionLoading, expandGroup
    });

    // Use refs to store latest function references to avoid stale closures in action group
    const handleCopyRef = useRef(handleCopy);
    const handleCutRef = useRef(handleCut);
    const handlePasteRef = useRef(handlePaste);
    const handleDeleteRef = useRef(handleDelete);

    // Update refs when functions change
    handleCopyRef.current = handleCopy;
    handleCutRef.current = handleCut;
    handlePasteRef.current = handlePaste;
    handleDeleteRef.current = handleDelete;

    // Magic Tags handler
    const handleMagicTagsClick = useCallback(async () => {
        const result = await handleCreateMagicTags();
        if (result) {
            setMagicTagTemplate(result.template);
            setMagicTagAssets(result.assets);
            setMagicTagDialogVisible(true);
        }
    }, [handleCreateMagicTags]);

    const handleMagicTagsApply = useCallback(async (categoryMapping: Record<number, string>) => {
        if (!magicTagTemplate) return;
        await handleApplyMagicTags(magicTagAssets, magicTagTemplate, categoryMapping);
        setMagicTagDialogVisible(false);
        setMagicTagTemplate(null);
        setMagicTagAssets([]);
    }, [magicTagTemplate, magicTagAssets, handleApplyMagicTags]);

    const handleMagicTagsClose = useCallback(() => {
        setMagicTagDialogVisible(false);
        setMagicTagTemplate(null);
        setMagicTagAssets([]);
    }, []);

    const { 
        draggedItem, dropTargetId, dragOver, 
        setDragOver, setDropTargetId, handleDragStart, handleDragEnd, 
        handlePanelDragOver, handlePanelDragLeave, handleDragOverItem, handleDropOnItem 
    } = useDragAndDrop({ context, groups, onDropCompleted: loadAssets });

    useKeyboardShortcuts({
        isInitialized,
        panelId,
        onCopy: () => handleCopyRef.current(),
        onCut: () => handleCutRef.current(),
        onPaste: () => handlePasteRef.current(),
        onRename: handleRename,
        registerClipboardShortcuts: false, // already provided by action shortcuts
    });

    const { menuState, contextMenu, showContextMenu, closeContextMenu } = useAssetsContextMenu({
        clipboard, contextMenuTarget, setContextMenuTarget, selectedItems, isMultiSelectMode,
        handleClearSelection,
        handleCopy: () => handleCopyRef.current(),
        handleCut: () => handleCutRef.current(),
        handlePaste: () => handlePasteRef.current(),
        handleDelete: () => handleDeleteRef.current(),
        handleRename,
        handleCreateGroup, handleImportToGroup, handleCreateMagicTags: handleMagicTagsClick
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
            await handleImport(type, undefined, event.dataTransfer.files, event.dataTransfer);
        }
        setDragOver(false);
        setDropTargetId(null);
    }, [draggedItem, handleDropOnItem, handleImport]);

    useEffect(() => {
        if (!context) return;

        const groupId = "narraleaf-studio:assets-edit";
        const hasSelection = selectedItems.size > 0;
        const hasClipboardContent = !!clipboard && (clipboard.assets.length > 0 || clipboard.groups.length > 0);
        const when = (focus: { area: FocusArea; targetId?: string }) => focus.area === focusArea && focus.targetId === panelId;

        registerActionGroup({
            id: groupId,
            label: "Edit",
            order: 20,
            actions: [
                {
                    id: `${groupId}-copy`,
                    label: "Copy",
                    icon: <Copy className="w-4 h-4" />,
                    tooltip: "Copy selected assets or groups",
                    shortcut: "ctrl+c",
                    onClick: (_workspace) => handleCopyRef.current(),
                    disabled: !hasSelection || actionLoading,
                    when,
                    order: 0,
                },
                {
                    id: `${groupId}-cut`,
                    label: "Cut",
                    icon: <Scissors className="w-4 h-4" />,
                    tooltip: "Cut selected assets or groups",
                    shortcut: "ctrl+x",
                    onClick: (_workspace) => handleCutRef.current(),
                    disabled: !hasSelection || actionLoading,
                    when,
                    order: 1,
                },
                {
                    id: `${groupId}-paste`,
                    label: "Paste",
                    icon: <Clipboard className="w-4 h-4" />,
                    tooltip: "Paste assets or groups",
                    shortcut: "ctrl+v",
                    onClick: (_workspace) => handlePasteRef.current(),
                    disabled: !hasClipboardContent || actionLoading,
                    when,
                    order: 2,
                },
                {
                    id: `${groupId}-delete`,
                    label: "Delete",
                    icon: <Trash className="w-4 h-4" />,
                    tooltip: "Delete selected assets or groups",
                    shortcut: "delete",
                    onClick: (_workspace) => handleDeleteRef.current(),
                    disabled: !hasSelection || actionLoading,
                    when,
                    order: 3,
                },
            ],
        });

        return () => {
            unregisterActionGroup(groupId);
        };
    }, [context, panelId, selectedItems.size, clipboard?.assets.length, clipboard?.groups.length, actionLoading, focusArea]);

    if (loading && Object.values(assets).every(arr => arr.length === 0)) {
        return <div className="p-4 flex items-center gap-2 text-gray-400"><RefreshCw className="w-4 h-4 animate-spin" /> <span>Loading assets...</span></div>;
    }

    if (error) {
        return <div className="p-4 text-red-400 flex items-start gap-2"><AlertCircle className="w-4 h-4" /> <div><p>Failed to load assets</p><p className="text-xs">{error}</p></div></div>;
    }

    const contextValue = {
        assets, groups, filteredAssets, filteredGroups, selectedItems, focusedItemId, 
        draggedItem, dropTargetId, clipboard, isMultiSelectMode, expandedGroups,
        handleItemSelect, handleAssetClick, handleGroupFocus, showContextMenu,
        handleDragStart, handleDragEnd, handleDragOverItem, handleDropOnItem, handleImportToGroup,
        setExpandedGroups,
        isFocused: (id: string) => focusedItemId === id,
    };

    return (
        <AssetsPanelContext.Provider value={contextValue}>
            <div
                className="h-full flex flex-col"
                onDragOver={handlePanelDragOver}
                onDragLeave={handlePanelDragLeave}
                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
                onClick={setFocusToPanel}
            >
                {showHeader ? (
                    <div className="px-3 py-2 border-b border-white/10 space-y-2">
                        <SearchBox ref={searchBoxRef} value={searchQuery} onChange={setSearchQuery} className="w-full" placeholder="Search assets..." />
                        <div className="flex items-center justify-between">
                            <FilterSystem filters={filterConfigs} activeFilters={activeFilters} onFiltersChange={setActiveFilters} onFilterOpen={handleFilterOpen} />
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-gray-400">{Object.values(filteredAssets).flat().length} items</span>
                                <ViewModeToggle mode={viewMode} onChange={setViewMode} />
                                <button onClick={loadAssets} disabled={loading} className="p-1 rounded hover:bg-white/10"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2 overflow-hidden">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                            {isSearchActive ? (
                                <div className="flex items-center gap-2 flex-1 min-w-0">
                                    <SearchBox
                                        ref={searchBoxRef}
                                        value={searchQuery}
                                        onChange={setSearchQuery}
                                        className="flex-1 min-w-0"
                                        placeholder="Search assets..."
                                    />
                                    <button
                                        onClick={() => {
                                            setIsSearchActive(false);
                                            setSearchQuery("");
                                            setSearchResultsVisible(false);
                                        }}
                                        className="h-9 w-9 flex items-center justify-center rounded-md border border-white/20 bg-white/5 text-gray-400 hover:bg-white/10"
                                        title="Close search"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ) : (
                                <>
                                    <FilterSystem
                                        className="flex-shrink-0"
                                        filters={filterConfigs}
                                        activeFilters={activeFilters}
                                        onFiltersChange={setActiveFilters}
                                        onFilterOpen={handleFilterOpen}
                                    />
                                    <button
                                        onClick={() => {
                                            setIsSearchActive(true);
                                            if (searchQuery.trim()) {
                                                setSearchResultsVisible(true);
                                            }
                                        }}
                                        className={`h-9 w-9 flex items-center justify-center rounded-md border transition-colors ${
                                            searchQuery
                                                ? "border-primary bg-primary/10 text-primary"
                                                : "border-white/20 bg-white/5 text-gray-400 hover:bg-white/10"
                                        }`}
                                        title="Search assets"
                                    >
                                        <Search className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                        </div>
                        {!isSearchActive && (
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="text-[10px] text-gray-500 hidden sm:inline">{Object.values(filteredAssets).flat().length} items</span>
                                <ViewModeToggle mode={viewMode} onChange={setViewMode} />
                                <button onClick={loadAssets} disabled={loading} className="p-1 rounded hover:bg-white/10"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
                            </div>
                        )}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto">
                    {viewMode === "list" ? (
                        <AssetsListView
                            dropTargetId={dropTargetId}
                            handleRootDrop={handleRootDrop}
                            handleImport={handleImport}
                            handleImportRemote={handleImportRemote}
                            handleCreateGroup={handleCreateGroup}
                            actionLoading={actionLoading}
                            setDropTargetId={setDropTargetId}
                        />
                    ) : (
                        <AssetsIconView
                            dropTargetId={dropTargetId}
                            handleRootDrop={handleRootDrop}
                            actionLoading={actionLoading}
                            setDropTargetId={setDropTargetId}
                            handleImport={handleImport}
                            handleImportRemote={handleImportRemote}
                            handleCreateGroup={handleCreateGroup}
                            iconSize={iconSize}
                            onIconSizeChange={setIconSize}
                        />
                    )}
                </div>
                
                <SearchResultsPopup results={searchResults} visible={isSearchResultsVisible} onResultClick={handleSearchResultClick} onClose={() => setSearchResultsVisible(false)} searchQuery={searchQuery} anchorRef={searchBoxRef} />
                <ContextMenu items={contextMenu} position={menuState.position} visible={menuState.visible} onClose={closeContextMenu} />
                <MagicTagDialog 
                    visible={magicTagDialogVisible}
                    assets={magicTagAssets}
                    template={magicTagTemplate}
                    onClose={handleMagicTagsClose}
                    onApply={handleMagicTagsApply}
                />
            </div>
        </AssetsPanelContext.Provider>
    );
}

function ViewModeToggle({ mode, onChange }: { mode: AssetViewMode; onChange: (mode: AssetViewMode) => void }) {
    return (
        <div className="inline-flex items-center gap-1 rounded-md border border-white/20 bg-white/5 p-1">
            {VIEW_MODE_OPTIONS.map(({ id, icon: Icon, label }) => (
                <button
                    key={id}
                    type="button"
                    title={label}
                    aria-pressed={mode === id}
                    onClick={() => onChange(id)}
                    className={`p-1 rounded ${mode === id ? "bg-primary/80 text-white" : "text-gray-400 hover:bg-white/10"}`}
                >
                    <Icon className="w-4 h-4" />
                </button>
            ))}
        </div>
    );
}
