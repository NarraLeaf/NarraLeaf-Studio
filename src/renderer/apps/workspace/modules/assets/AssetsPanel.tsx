import { useMemo, useCallback, useState, useRef, useEffect, useLayoutEffect, ComponentType } from "react";
import { flushSync } from "react-dom";
import { LayoutGrid, LayoutList, RefreshCw, AlertCircle, Copy, Scissors, Clipboard, Trash, Search, X, ChevronLeft, Boxes } from "lucide-react";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { PanelComponentProps } from "../types";
import { ASSET_CATEGORY_ORDER, AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { ContextMenu } from "@/lib/components/elements/ContextMenu";
import { useAssetsContextMenu } from "./hooks/useAssetsContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { SearchBox } from "./components/SearchBox";
import { FilterSystem, type ActiveFilter } from "./components/FilterSystem";
import { ImportQueueStrip } from "./components/ImportQueueStrip";

import { useAssetData } from "./state/useAssetData";
import { useMultiSelection } from "./state/useMultiSelection";
import { useAssetSearch } from "./state/useAssetSearch";
import { useAssetFilters, filtersNeedLibrarySnapshot } from "./state/useAssetFilters";
import { useAssetLibrarySnapshot } from "../asset-overview/useAssetLibrarySnapshot";
import { useDragAndDrop, type InternalAssetDropCompletedInfo } from "./state/useDragAndDrop";
import { useClipboard } from "./state/useClipboard";
import { useAssetFocus } from "./state/useAssetFocus";
import { useAssetActions, ContextMenuTargetState } from "./state/useAssetActions";
import { useImportQueue } from "./state/useImportQueue";
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
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useTranslation } from "@/lib/i18n";
import { AssetOverviewView } from "../asset-overview/AssetOverviewView";

export type AssetViewMode = "list" | "icons" | "overview";

const VIEW_MODE_OPTIONS: { id: AssetViewMode; icon: ComponentType<any> }[] = [
    {
        id: "list",
        icon: LayoutList,
    },
    {
        id: "icons",
        icon: LayoutGrid,
    },
    {
        id: "overview",
        icon: Boxes,
    },
];

const VIEW_MODE_IDS = new Set<string>(VIEW_MODE_OPTIONS.map(option => option.id));

/** A persisted view mode from before the overview was folded in, or from a hand-edited store. */
function sanitizeViewMode(mode: string | undefined): AssetViewMode | null {
    return mode && VIEW_MODE_IDS.has(mode) ? (mode as AssetViewMode) : null;
}

interface AssetsPanelPayload {
    defaultViewMode?: AssetViewMode;
    defaultIconSize?: number;
    focusArea?: FocusArea;
    showHeader?: boolean;
}

interface AssetsPanelState {
    viewMode?: AssetViewMode;
    iconSize?: number;
    /**
     * Which sidebar sections are open. Still named `assetTypeOpenItems` on disk: the ids stored by
     * a build from before sections were categories are filtered out by
     * {@link filterKnownAssetCategoryIds}, which is exactly the "persisted UI state may lapse"
     * the plan allows.
     */
    assetTypeOpenItems?: string[];
    expandedGroupIds?: string[];
    iconGroupPathIds?: string[];
}

const DEFAULT_ASSET_CATEGORY_OPEN_ITEMS = [AssetCategory.Image];
const ASSET_CATEGORY_IDS = new Set<string>(ASSET_CATEGORY_ORDER);

function filterKnownAssetCategoryIds(ids: string[] | undefined): string[] {
    if (!Array.isArray(ids)) {
        return DEFAULT_ASSET_CATEGORY_OPEN_ITEMS;
    }
    return ids.filter(id => ASSET_CATEGORY_IDS.has(id));
}

function sanitizeStringIds(ids: string[] | undefined): string[] {
    if (!Array.isArray(ids)) {
        return [];
    }
    return ids.filter(id => typeof id === "string" && id.length > 0);
}

function resolveAssetGroupPathIds(pathIds: string[], groups: Record<AssetCategory, AssetGroup[]>): string[] {
    const groupById = new Map<string, AssetGroup>();
    Object.values(groups).flat().forEach(group => groupById.set(group.id, group));

    const resolved: string[] = [];
    let expectedParentId: string | undefined;
    let expectedCategory: AssetCategory | undefined;

    for (const id of pathIds) {
        const group = groupById.get(id);
        if (!group) {
            break;
        }
        if ((group.parentGroupId ?? undefined) !== expectedParentId) {
            break;
        }
        if (expectedCategory && group.category !== expectedCategory) {
            break;
        }
        expectedCategory = group.category;
        expectedParentId = group.id;
        resolved.push(group.id);
    }

    return resolved;
}

export function AssetsPanel({ panelId, payload }: PanelComponentProps<AssetsPanelPayload>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { registerActionGroup, unregisterActionGroup } = useRegistry();
    // The panel's own shortcuts. Every button and menu row here is greyed where it is rendered, but
    // a keystroke has no control to grey - and a keybinding bypasses the disabled menu row it shares
    // an action with, so Ctrl+V and Delete kept working on a frozen project.
    const freeze = useFreezeGuard();
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
    const [categoryOpenItems, setCategoryOpenItems] = useState<string[]>(DEFAULT_ASSET_CATEGORY_OPEN_ITEMS);
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
        setCategoryOpenItems(DEFAULT_ASSET_CATEGORY_OPEN_ITEMS);
        setExpandedGroups(new Set());
        setIconGroupPathIds([]);

        const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
        const saved = panelStateService.getPanelState<AssetsPanelState>(panelId);
        const savedViewMode = sanitizeViewMode(saved?.viewMode);
        if (savedViewMode) {
            setViewMode(savedViewMode);
            setHasPersistedViewMode(true);
        }
        if (typeof saved?.iconSize === "number") {
            setIconSize(saved.iconSize);
            setHasPersistedIconSize(true);
        }
        setCategoryOpenItems(filterKnownAssetCategoryIds(saved?.assetTypeOpenItems));
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
            assetTypeOpenItems: filterKnownAssetCategoryIds(categoryOpenItems),
            expandedGroupIds: Array.from(expandedGroups),
            iconGroupPathIds,
        });
    }, [categoryOpenItems, context, expandedGroups, iconGroupPathIds, iconSize, panelId, stateReady, viewMode]);

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

    const { searchQuery, activeQuery, setSearchQuery } = useAssetSearch();

    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
    // Measuring the library costs a directory walk and a reference-index flush; only pay for it
    // while something is reading the result — the overview view, or a filter asking a question the
    // asset records cannot answer on their own.
    const {
        snapshot,
        failed: snapshotFailed,
        refresh: refreshSnapshot,
        bytesByAssetId,
        referencedAssetIds,
    } = useAssetLibrarySnapshot(context, viewMode === "overview" || filtersNeedLibrarySnapshot(activeFilters));

    const { filterConfigs, handleFilterOpen, filteredAssets, filteredGroups, matchedGroupIds } =
        useAssetFilters({ assets, groups, activeFilters, query: activeQuery, bytesByAssetId, referencedAssetIds });

    /**
     * A search or a filter is narrowing the library. The views read this to stop hiding hits: the
     * tree opens every group it still shows, and the grid drops the folder walk and goes flat.
     */
    const isNarrowed = activeQuery.length > 0 || activeFilters.length > 0;

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

    // One refresh button for the whole panel. The overview reads measured numbers the asset records
    // do not carry, so on that view it has to re-walk as well — a refresh that reloaded the records
    // and left the sizes alone would look like it had done nothing.
    const handleRefresh = useCallback(() => {
        loadAssets();
        if (viewMode === "overview") {
            refreshSnapshot();
        }
    }, [loadAssets, refreshSnapshot, viewMode]);

    const { clipboard, setClipboard } = useClipboard();

    // Function to expand a group by its ID
    const expandGroup = useCallback((groupId: string) => {
        setExpandedGroups(prev => new Set(prev).add(groupId));
    }, []);

    const { importQueue, importState, dismissImportFailures } = useImportQueue();

    const {
        handleCreateGroup, handleCreateTextFile, handleCopy, handleCut, handlePaste, handleRename, handleReplaceContent, handleDelete, handleImport, handleRetryImport, handleImportToGroup, handleImportRemote,
        handleCreateMagicTags, handleApplyMagicTags
    } = useAssetActions({
        context, inputDialog, assets, groups, selectedItems, clipboard, contextMenuTarget,
        focusedItemId, onActionComplete, setClipboard, setActionLoading, expandGroup, importQueue
    });

    const handleRetryFailedImports = useCallback(() => {
        const run = importState.run;
        if (!run || importState.failures.length === 0) return;
        void handleRetryImport(run.category, importState.failures.map(failure => failure.path), run.groupId);
    }, [handleRetryImport, importState]);

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

    // F2 opens the rename dialog, which writes the new name straight to the asset record. Nothing
    // renders for the key, so the refusal goes on the handler; memoised so the binding is not
    // re-registered on every render.
    const renameShortcut = useMemo(() => freeze.run(handleRename), [freeze, handleRename]);

    useKeyboardShortcuts({
        isInitialized,
        panelId,
        onCopy: () => handleCopyRef.current(),
        onCut: () => handleCutRef.current(),
        onPaste: () => handlePasteRef.current(),
        onRename: renameShortcut,
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
        handleReplaceContent: () => handleReplaceContent(),
        handleCreateGroup, handleCreateTextFile, handleImportToGroup, handleCreateMagicTags: handleMagicTagsClick
    });

    const handleRootDrop = useCallback(
        async (event: React.DragEvent, category: AssetCategory, contextualGroup?: AssetGroup | null) => {
            const targetGroup = contextualGroup ?? null;
            if (draggedItem) {
                await handleDropOnItem(event, category, targetGroup);
            } else {
                await handleImport(category, targetGroup?.id, event.dataTransfer.files, event.dataTransfer);
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
                    shortcut: "mod+c",
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
                    shortcut: "mod+x",
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
                    shortcut: "mod+v",
                    menuRole: "paste",
                    // Paste copies assets into the library, so a frozen project refuses it. The
                    // refusal sits on the handler rather than on `disabled`: the menu row is greyed
                    // by the freeze policy already, but `mod+v` runs the action straight from the
                    // keybinding, and on a frozen project it created assets that never landed.
                    // Copy and cut above only fill the clipboard, so they are left alone.
                    onClick: freeze.run((_workspace) => handlePasteRef.current()),
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
                    // Same for Delete, which reaches the files themselves: the key runs the action
                    // without ever consulting the greyed row.
                    onClick: freeze.run((_workspace) => handleDeleteRef.current()),
                    disabled: !hasSelection || actionLoading,
                    when,
                    order: 3,
                },
            ],
        });

        return () => {
            unregisterActionGroup(groupId);
        };
    }, [context, panelId, selectedItems.size, clipboard?.assets.length, clipboard?.groups.length, actionLoading, focusArea, t, freeze]);

    useEffect(() => {
        if (showHeader) {
            setAssetsIconToolbarCenter(null);
        }
    }, [showHeader]);

    if (loading && !hasLoaded && Object.values(assets).every(arr => arr.length === 0)) {
        return <div className="p-4 flex items-center gap-2 text-fg-muted"><RefreshCw className="w-4 h-4 animate-spin" /> <span>{t("assets.loading")}</span></div>;
    }

    if (error) {
        return <div className="p-4 text-danger flex items-start gap-2"><AlertCircle className="w-4 h-4" /> <div><p>{t("assets.loadError")}</p><p className="text-xs">{error}</p></div></div>;
    }

    // While narrowing, every category holding a survivor opens: a hit inside a category the reader
    // last left collapsed is not a hit. The stored list is untouched and comes back when the search
    // is cleared.
    const effectiveOpenItems = isNarrowed
        ? ASSET_CATEGORY_ORDER.filter(category => filteredAssets[category].length > 0 || filteredGroups[category].length > 0)
        : categoryOpenItems;

    const contextValue = {
        assets, groups, filteredAssets, filteredGroups, matchedGroupIds, selectedItems, focusedItemId,
        draggedItem, dropTargetId, clipboard, isMultiSelectMode, expandedGroups,
        handleItemSelect, handleAssetClick, handleGroupFocus, showContextMenu,
        handleDragStart, handleDragEnd, handleDragOverItem, handleDropOnItem, handleImportToGroup,
        setExpandedGroups,
        isFocused: (id: string) => focusedItemId === id,
        isNarrowed,
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
                                <ViewModeToggle mode={viewMode} onChange={setViewMode} />
                                <button
                                    onClick={handleRefresh}
                                    disabled={loading}
                                    title={t("common.refresh")}
                                    aria-label={t("common.refresh")}
                                    className="p-1 rounded-md hover:bg-fill"
                                >
                                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                                </button>
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
                                        onClick={() => setIsSearchActive(true)}
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
                                    className="p-1 rounded-md hover:bg-fill shrink-0"
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
                                {/* The item count used to sit here. It was redundant (every group in the
                                    tree below already prints its own count, and the overview page prints
                                    the total) and it never gave way: `hidden sm:inline` is a VIEWPORT
                                    query, so a narrow sidebar in a wide window still paid for it. */}
                                <ViewModeToggle mode={viewMode} onChange={setViewMode} />
                                <button
                                    onClick={handleRefresh}
                                    disabled={loading}
                                    title={t("common.refresh")}
                                    aria-label={t("common.refresh")}
                                    className="p-1 rounded-md hover:bg-fill"
                                >
                                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <ImportQueueStrip
                    state={importState}
                    onRetry={handleRetryFailedImports}
                    onDismiss={dismissImportFailures}
                />

                <div className="flex-1 overflow-y-auto">
                    {viewMode === "overview" ? (
                        <AssetOverviewView snapshot={snapshot} failed={snapshotFailed} refresh={refreshSnapshot} />
                    ) : viewMode === "list" ? (
                        <AssetsListView
                            dropTargetId={dropTargetId}
                            handleRootDrop={handleRootDrop}
                            handleImport={handleImport}
                            handleImportRemote={handleImportRemote}
                            handleCreateGroup={handleCreateGroup}
                            actionLoading={actionLoading}
                            setDropTargetId={setDropTargetId}
                            openItems={effectiveOpenItems}
                            onOpenChange={(next) => setCategoryOpenItems(filterKnownAssetCategoryIds(next))}
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

const VIEW_MODE_LABEL_KEYS = {
    list: "assets.view.list",
    icons: "assets.view.icons",
    overview: "assets.view.overview",
} as const;

function ViewModeToggle({ mode, onChange }: { mode: AssetViewMode; onChange: (mode: AssetViewMode) => void }) {
    const { t } = useTranslation();
    return (
        <div className="inline-flex items-center gap-1 rounded-md border border-edge-strong bg-fill-subtle p-1">
            {VIEW_MODE_OPTIONS.map(({ id, icon: Icon }) => {
                const label = t(VIEW_MODE_LABEL_KEYS[id]);
                return (
                <button
                    key={id}
                    type="button"
                    title={label}
                    aria-pressed={mode === id}
                    onClick={() => onChange(id)}
                    className={`p-1 rounded-md ${mode === id ? "bg-primary/80 text-on-primary" : "text-fg-muted hover:bg-fill"}`}
                >
                    <Icon className="w-4 h-4" />
                </button>
                );
            })}
        </div>
    );
}
