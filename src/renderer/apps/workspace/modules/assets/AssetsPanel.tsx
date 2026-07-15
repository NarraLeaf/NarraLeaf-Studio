import { useMemo, useCallback, useState, useRef, useEffect, useLayoutEffect, ComponentType } from "react";
import { flushSync } from "react-dom";
import { LayoutGrid, LayoutList, RefreshCw, AlertCircle, Copy, Scissors, Clipboard, Trash, Search, X, ChevronLeft } from "lucide-react";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { PanelComponentProps } from "../types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
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
import { useDragAndDrop, type InternalAssetDropCompletedInfo } from "./state/useDragAndDrop";
import { useClipboard } from "./state/useClipboard";
import { useAssetFocus } from "./state/useAssetFocus";
import { useAssetActions, ContextMenuTargetState } from "./state/useAssetActions";
import { useKeyboardShortcuts } from "./state/useKeyboardShortcuts";
import { AssetsPanelContext, type AssetsIconViewToolbarCenter } from './AssetsPanelContext';
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { MagicTagDialog } from "./components/MagicTagDialog";
import { MagicTagTemplate } from "@/lib/workspace/services/core/MagicTagManager";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { AssetsListView } from "./views/AssetsListView";
import { AssetsIconView } from "./views/AssetsIconView";
import { useWorkspaceAssetDragOptional } from "@/apps/workspace/dnd/WorkspaceAssetDragProvider";
import { useTranslation } from "@/lib/i18n";

export type AssetViewMode = "list" | "icons";

const VIEW_MODE_OPTIONS: { id: AssetViewMode; icon: ComponentType<any> }[] = [
    {
        id: "list",
        icon: LayoutList,
    },
    {
        id: "icons",
        icon: LayoutGrid,
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
    assetTypeOpenItems?: string[];
    expandedGroupIds?: string[];
    iconGroupPathIds?: string[];
}

const DEFAULT_ASSET_TYPE_OPEN_ITEMS = [AssetType.Image];
const ASSET_TYPE_IDS = new Set<string>(Object.values(AssetType));

function filterKnownAssetTypeIds(ids: string[] | undefined): string[] {
    if (!Array.isArray(ids)) {
        return DEFAULT_ASSET_TYPE_OPEN_ITEMS;
    }
    return ids.filter(id => ASSET_TYPE_IDS.has(id));
}

function sanitizeStringIds(ids: string[] | undefined): string[] {
    if (!Array.isArray(ids)) {
        return [];
    }
    return ids.filter(id => typeof id === "string" && id.length > 0);
}

function resolveAssetGroupPathIds(pathIds: string[], groups: Record<AssetType, AssetGroup[]>): string[] {
    const groupById = new Map<string, AssetGroup>();
    Object.values(groups).flat().forEach(group => groupById.set(group.id, group));

    const resolved: string[] = [];
    let expectedParentId: string | undefined;
    let expectedType: AssetType | undefined;

    for (const id of pathIds) {
        const group = groupById.get(id);
        if (!group) {
            break;
        }
        if ((group.parentGroupId ?? undefined) !== expectedParentId) {
            break;
        }
        if (expectedType && group.type !== expectedType) {
            break;
        }
        expectedType = group.type;
        expectedParentId = group.id;
        resolved.push(group.id);
    }

    return resolved;
}

export function AssetsPanel({ panelId, payload }: PanelComponentProps<AssetsPanelPayload>) {
    const { t, tn } = useTranslation();
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
    const [assetsIconToolbarCenter, setAssetsIconToolbarCenter] = useState<AssetsIconViewToolbarCenter | null>(null);

    const defaultViewMode = payload?.defaultViewMode ?? "list";
    const defaultIconSize = payload?.defaultIconSize ?? 140;
    const focusArea = payload?.focusArea ?? FocusArea.LeftPanel;
    const showHeader = payload?.showHeader ?? true;
    const [viewMode, setViewMode] = useState<AssetViewMode>(defaultViewMode);
    const [iconSize, setIconSize] = useState<number>(defaultIconSize);
    const [assetTypeOpenItems, setAssetTypeOpenItems] = useState<string[]>(DEFAULT_ASSET_TYPE_OPEN_ITEMS);
    const [iconGroupPathIds, setIconGroupPathIds] = useState<string[]>([]);
    const [stateReady, setStateReady] = useState(false);
    const [disableAccordionAnimation, setDisableAccordionAnimation] = useState(true);
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

    useLayoutEffect(() => {
        if (!context) return;
        setStateReady(false);
        setDisableAccordionAnimation(true);
        setHasPersistedViewMode(false);
        setHasPersistedIconSize(false);
        setAssetTypeOpenItems(DEFAULT_ASSET_TYPE_OPEN_ITEMS);
        setExpandedGroups(new Set());
        setIconGroupPathIds([]);

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
        setAssetTypeOpenItems(filterKnownAssetTypeIds(saved?.assetTypeOpenItems));
        if (Array.isArray(saved?.expandedGroupIds)) {
            setExpandedGroups(new Set(sanitizeStringIds(saved.expandedGroupIds)));
        }
        setIconGroupPathIds(sanitizeStringIds(saved?.iconGroupPathIds));
        setStateReady(true);
    }, [context, panelId]);

    useEffect(() => {
        if (!context || !stateReady) return;
        const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
        panelStateService.setPanelState<AssetsPanelState>(panelId, {
            viewMode,
            iconSize,
            assetTypeOpenItems: filterKnownAssetTypeIds(assetTypeOpenItems),
            expandedGroupIds: Array.from(expandedGroups),
            iconGroupPathIds,
        });
    }, [assetTypeOpenItems, context, expandedGroups, iconGroupPathIds, iconSize, panelId, stateReady, viewMode]);

    useEffect(() => {
        if (!stateReady) return;
        const frame = requestAnimationFrame(() => setDisableAccordionAnimation(false));
        return () => cancelAnimationFrame(frame);
    }, [stateReady, panelId]);

    const { assets, groups, loading, hasLoaded, error, loadAssets } = useAssetData({ context, isInitialized });

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

    useEffect(() => {
        if (!hasLoaded) return;
        const knownGroupIds = new Set(Object.values(groups).flat().map(group => group.id));
        setExpandedGroups(prev => {
            const next = new Set(Array.from(prev).filter(id => knownGroupIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
        setIconGroupPathIds(prev => {
            const next = resolveAssetGroupPathIds(prev, groups);
            return next.length === prev.length ? prev : next;
        });
    }, [groups, hasLoaded]);
    
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

    const workspaceDrag = useWorkspaceAssetDragOptional();

    const handleAssetsPanelDropCompleted = useCallback(
        (info?: InternalAssetDropCompletedInfo) => {
            if (info) {
                const movedAny =
                    (info.movedAssetIds?.length ?? 0) > 0 || (info.movedGroupIds?.length ?? 0) > 0;
                if (movedAny) {
                    // Commit clipboard prune before async loadAssets so cut styling cannot flash stale state.
                    flushSync(() => {
                        setClipboard((prev) => {
                            if (!prev || prev.type !== "cut") {
                                return prev;
                            }
                            const movedA = new Set(info.movedAssetIds);
                            const movedG = new Set(info.movedGroupIds);
                            const nextAssets = prev.assets.filter((a) => !movedA.has(a.id));
                            const nextGroups = prev.groups.filter((g) => !movedG.has(g.id));
                            if (nextAssets.length === 0 && nextGroups.length === 0) {
                                return null;
                            }
                            return { ...prev, assets: nextAssets, groups: nextGroups };
                        });
                    });
                }
            }
            void loadAssets();
        },
        [loadAssets, setClipboard]
    );

    const { 
        draggedItem, dropTargetId, dragOver, 
        setDragOver, setDropTargetId, handleDragStart, handleDragEnd, 
        handlePanelDragOver, handlePanelDragLeave, handleDragOverItem, handleDropOnItem 
    } = useDragAndDrop({
        context,
        groups,
        onDropCompleted: handleAssetsPanelDropCompleted,
        selectedItems,
        filteredGroups,
        filteredAssets,
        panelId,
        onWorkspaceDragSessionStart: workspaceDrag?.beginSession,
        onWorkspaceDragSessionEnd: workspaceDrag?.endSession,
    });

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

    const handleRootDrop = useCallback(
        async (event: React.DragEvent, type: AssetType, contextualGroup?: AssetGroup | null) => {
            const targetGroup = contextualGroup ?? null;
            if (draggedItem) {
                await handleDropOnItem(event, type, targetGroup);
            } else {
                await handleImport(type, targetGroup?.id, event.dataTransfer.files, event.dataTransfer);
            }
            setDragOver(false);
            setDropTargetId(null);
        },
        [draggedItem, handleDropOnItem, handleImport]
    );

    useEffect(() => {
        if (!context) return;

        const groupId = "narraleaf-studio:assets-edit";
        const hasSelection = selectedItems.size > 0;
        const hasClipboardContent = !!clipboard && (clipboard.assets.length > 0 || clipboard.groups.length > 0);
        const when = (focus: { area: FocusArea; targetId?: string }) => focus.area === focusArea && focus.targetId === panelId;

        registerActionGroup({
            id: groupId,
            label: t("common.edit"),
            order: 20,
            // These are this panel's versions of the standard editing commands, so on macOS they
            // belong under the system Edit menu rather than in a second menu also called Edit.
            menuSlot: "edit",
            actions: [
                {
                    id: `${groupId}-copy`,
                    label: t("common.copy"),
                    icon: <Copy className="w-4 h-4" />,
                    tooltip: t("assets.actions.copyTooltip"),
                    shortcut: "ctrl+c",
                    menuRole: "copy",
                    onClick: (_workspace) => handleCopyRef.current(),
                    disabled: !hasSelection || actionLoading,
                    when,
                    order: 0,
                },
                {
                    id: `${groupId}-cut`,
                    label: t("common.cut"),
                    icon: <Scissors className="w-4 h-4" />,
                    tooltip: t("assets.actions.cutTooltip"),
                    shortcut: "ctrl+x",
                    menuRole: "cut",
                    onClick: (_workspace) => handleCutRef.current(),
                    disabled: !hasSelection || actionLoading,
                    when,
                    order: 1,
                },
                {
                    id: `${groupId}-paste`,
                    label: t("common.paste"),
                    icon: <Clipboard className="w-4 h-4" />,
                    tooltip: t("assets.actions.pasteTooltip"),
                    shortcut: "ctrl+v",
                    menuRole: "paste",
                    onClick: (_workspace) => handlePasteRef.current(),
                    disabled: !hasClipboardContent || actionLoading,
                    when,
                    order: 2,
                },
                {
                    id: `${groupId}-delete`,
                    label: t("common.delete"),
                    icon: <Trash className="w-4 h-4" />,
                    tooltip: t("assets.actions.deleteTooltip"),
                    shortcut: "delete",
                    menuRole: "delete",
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
    }, [context, panelId, selectedItems.size, clipboard?.assets.length, clipboard?.groups.length, actionLoading, focusArea, t]);

    useEffect(() => {
        if (showHeader) {
            setAssetsIconToolbarCenter(null);
        }
    }, [showHeader]);

    if (loading && !hasLoaded && Object.values(assets).every(arr => arr.length === 0)) {
        return <div className="p-4 flex items-center gap-2 text-fg-muted"><RefreshCw className="w-4 h-4 animate-spin" /> <span>{t("assets.loading")}</span></div>;
    }

    if (error) {
        return <div className="p-4 text-red-400 flex items-start gap-2"><AlertCircle className="w-4 h-4" /> <div><p>{t("assets.loadError")}</p><p className="text-xs">{error}</p></div></div>;
    }

    const contextValue = {
        assets, groups, filteredAssets, filteredGroups, selectedItems, focusedItemId, 
        draggedItem, dropTargetId, clipboard, isMultiSelectMode, expandedGroups,
        handleItemSelect, handleAssetClick, handleGroupFocus, showContextMenu,
        handleDragStart, handleDragEnd, handleDragOverItem, handleDropOnItem, handleImportToGroup,
        setExpandedGroups,
        isFocused: (id: string) => focusedItemId === id,
        compactToolbar: !showHeader,
        setAssetsIconToolbarCenter,
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
                    <div className="px-3 py-2 border-b border-edge space-y-2">
                        <SearchBox ref={searchBoxRef} value={searchQuery} onChange={setSearchQuery} className="w-full" placeholder={t("assets.searchPlaceholder")} />
                        <div className="flex items-center justify-between">
                            <FilterSystem filters={filterConfigs} activeFilters={activeFilters} onFiltersChange={setActiveFilters} onFilterOpen={handleFilterOpen} />
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-fg-muted">{tn("assets.itemCount", Object.values(filteredAssets).flat().length)}</span>
                                <ViewModeToggle mode={viewMode} onChange={setViewMode} />
                                <button onClick={loadAssets} disabled={loading} className="p-1 rounded hover:bg-fill"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div
                        className={
                            isSearchActive
                                ? "px-3 py-2 border-b border-edge flex items-center gap-2 overflow-hidden"
                                : assetsIconToolbarCenter
                                  ? "px-3 py-2 border-b border-edge grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 overflow-hidden"
                                  : "px-3 py-2 border-b border-edge flex items-center justify-between gap-2 overflow-hidden"
                        }
                    >
                        <div
                            className={
                                isSearchActive
                                    ? "flex items-center gap-2 flex-1 min-w-0"
                                    : assetsIconToolbarCenter
                                      ? "flex items-center gap-2 min-w-0 justify-self-start"
                                      : "flex items-center gap-2 min-w-0 flex-1"
                            }
                        >
                            {isSearchActive ? (
                                <>
                                    <SearchBox
                                        ref={searchBoxRef}
                                        value={searchQuery}
                                        onChange={setSearchQuery}
                                        className="flex-1 min-w-0"
                                        placeholder={t("assets.searchPlaceholder")}
                                    />
                                    <button
                                        onClick={() => {
                                            setIsSearchActive(false);
                                            setSearchQuery("");
                                            setSearchResultsVisible(false);
                                        }}
                                        className="h-9 w-9 flex items-center justify-center rounded-md border border-edge-strong bg-fill-subtle text-fg-muted hover:bg-fill"
                                        title={t("assets.closeSearch")}
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </>
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
                                                : "border-edge-strong bg-fill-subtle text-fg-muted hover:bg-fill"
                                        }`}
                                        title={t("assets.searchTooltip")}
                                    >
                                        <Search className="w-4 h-4" />
                                    </button>
                                </>
                            )}
                        </div>
                        {!isSearchActive && assetsIconToolbarCenter && (
                            <div className="flex items-center justify-center gap-1 min-w-0 max-w-[min(280px,45vw)] px-1 justify-self-center">
                                <button
                                    type="button"
                                    onClick={assetsIconToolbarCenter.onBack}
                                    className="p-1 rounded hover:bg-fill shrink-0"
                                    title={t("assets.backToParent")}
                                >
                                    <ChevronLeft className="w-4 h-4" />
                                </button>
                                <span className="text-sm font-semibold truncate text-center">{assetsIconToolbarCenter.title}</span>
                            </div>
                        )}
                        {!isSearchActive && (
                            <div
                                className={
                                    assetsIconToolbarCenter
                                        ? "flex items-center gap-2 shrink-0 justify-self-end"
                                        : "flex items-center gap-2 shrink-0"
                                }
                            >
                                <span className="text-2xs text-fg-subtle hidden sm:inline">{tn("assets.itemCount", Object.values(filteredAssets).flat().length)}</span>
                                <ViewModeToggle mode={viewMode} onChange={setViewMode} />
                                <button onClick={loadAssets} disabled={loading} className="p-1 rounded hover:bg-fill"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /></button>
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
                            openItems={assetTypeOpenItems}
                            onOpenChange={(next) => setAssetTypeOpenItems(filterKnownAssetTypeIds(next))}
                            disableAnimation={disableAccordionAnimation}
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
                            groupPathIds={iconGroupPathIds}
                            onGroupPathChange={(next) => setIconGroupPathIds(resolveAssetGroupPathIds(next, groups))}
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
    const { t } = useTranslation();
    return (
        <div className="inline-flex items-center gap-1 rounded-md border border-edge-strong bg-fill-subtle p-1">
            {VIEW_MODE_OPTIONS.map(({ id, icon: Icon }) => {
                const label = id === "list" ? t("assets.view.list") : t("assets.view.icons");
                return (
                <button
                    key={id}
                    type="button"
                    title={label}
                    aria-pressed={mode === id}
                    onClick={() => onChange(id)}
                    className={`p-1 rounded ${mode === id ? "bg-primary/80 text-white" : "text-fg-muted hover:bg-fill"}`}
                >
                    <Icon className="w-4 h-4" />
                </button>
                );
            })}
        </div>
    );
}
