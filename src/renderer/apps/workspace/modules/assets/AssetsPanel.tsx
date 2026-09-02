import { useMemo, useCallback, useState, useRef, useEffect, useLayoutEffect, ComponentType } from "react";
import { flushSync } from "react-dom";
import { LayoutGrid, LayoutList, RefreshCw, AlertCircle, Copy, Scissors, Clipboard, Trash, Search, X, ChevronLeft, Boxes } from "lucide-react";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { PanelComponentProps } from "../types";
import { ASSET_CATEGORY_ORDER, AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup, AssetSource } from "@/lib/workspace/services/assets/types";
import { ContextMenu, useContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useAssetsContextMenu } from "./hooks/useAssetsContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { SearchBox } from "./components/SearchBox";
import { FilterSystem, type ActiveFilter } from "./components/FilterSystem";
import { ImportQueueStrip } from "./components/ImportQueueStrip";
import { ModelImportWizard } from "./components/ModelImportWizard";
import { MediaImportDialog } from "./components/MediaImportDialog";
import { MediaConvertAssetDialog } from "./components/MediaConvertAssetDialog";
import { useMediaAssetSupport } from "./state/useMediaAssetSupport";
import { useUnreadableAssetCategories } from "./state/useUnreadableAssetCategories";

import { useAssetData } from "./state/useAssetData";
import { useAssetSets, type ResolvedAssetSet } from "./state/useAssetSets";
import { useAssetSetNaming } from "./state/useAssetSetNaming";
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
import { AssetsPanelContext, type AssetSetRevealState, type AssetsIconViewToolbarCenter } from './AssetsPanelContext';
import { ASSET_SET_REVEAL_EVENT, consumeAssetSetReveal, type AssetSetRevealRequest } from "./assetSetReveal";
import { planAssetSetReveal } from "./state/assetSetRevealPlan";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { MagicTagDialog } from "./components/MagicTagDialog";
import { AssetSetWizard } from "./components/AssetSetWizard";
import { MagicTagTemplate } from "@/lib/workspace/services/core/MagicTagManager";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { AssetsListView } from "./views/AssetsListView";
import { AssetsIconView } from "./views/AssetsIconView";
import { assetSelectionKey, type AssetActionTarget } from "./state/assetActionTargets";
import { AssetSetService } from "@/lib/workspace/services/assets/AssetSetService";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { ReferenceService } from "@/lib/workspace/services/references/ReferenceService";
import { assetSetSubtree, type AssetSet } from "@shared/types/assetSet";
import { freezeContextMenuRows } from "@/apps/workspace/components/ui/freezeGuard";
import { useWorkspaceAssetDragOptional } from "@/apps/workspace/dnd/WorkspaceAssetDragProvider";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { assetLibraryFreezeScope, assetSetFreezeScope, useAssetClaims, useAssetTransfers } from "./assetLiveSession";
import { useTranslation } from "@/lib/i18n";
import { AssetOverviewView } from "../asset-overview/AssetOverviewView";
import { BLUEPRINT_SCRIPTS_SECTION_ID, BlueprintScriptsSection } from "./views/BlueprintScriptsSection";

export type AssetViewMode = "list" | "icons" | "overview";

/** How many places naming a set are spelled out before the rest are counted. Matches the delete warning. */
const ASSET_SET_REFERENCE_PREVIEW_LIMIT = 5;

/** How long a jumped-to set's row stays marked. Long enough to find, short enough not to read as state. */
const ASSET_SET_REVEAL_MARK_MS = 2200;

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
     * {@link filterKnownAssetCategoryIds} - persisted UI state is deliberately allowed to
     * lapse this way.
     */
    assetTypeOpenItems?: string[];
    expandedGroupIds?: string[];
    expandedAssetSetIds?: string[];
    iconGroupPathIds?: string[];
}

const DEFAULT_ASSET_CATEGORY_OPEN_ITEMS = [AssetCategory.Image];
/**
 * Which accordion ids may be remembered as open.
 *
 * The asset categories, plus the scripts section - which is not a category and never will be. A
 * script is not in the asset library: it has no id, no metadata shard and no place in an asset set,
 * because the disk owns `scripts/` and Studio only reads it. What it shares with a category is the
 * place an author looks for the project's files, which is why it sits in this panel and nowhere in
 * `AssetCategory`.
 */
const ASSET_CATEGORY_IDS = new Set<string>([...ASSET_CATEGORY_ORDER, BLUEPRINT_SCRIPTS_SECTION_ID]);

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
    /**
     * The asset library's own guard.
     *
     * Two guards rather than one, and the line between them is not "what a session can carry" any
     * more - it carries the whole library, files included. It is **which document**: everything that
     * writes the library reads this one, and the asset SETS beside it are a different document with
     * no verbs of its own, so their controls keep {@link freeze} and grey under any freeze at all.
     */
    const libraryFreeze = useFreezeGuard(assetLibraryFreezeScope());
    /**
     * The asset sets' own guard.
     *
     * A third guard rather than a widening of {@link libraryFreeze}, because the sets are a third
     * document: they were frozen under any freeze at all while they had no verbs, and a session
     * carries them now. See `assetSetFreezeScope` for why it names the library as well.
     */
    const setFreeze = useFreezeGuard(assetSetFreezeScope());
    // One subscription for every row. Empty outside a live session.
    const assetClaims = useAssetClaims();
    const assetTransfers = useAssetTransfers();

    /**
     * Stop a file that is still arriving, and take its record with it.
     *
     * Straight to the service and with no confirmation, for the reason `cancelTransfers` gives:
     * nothing an author made is being thrown away, and the row it acts on is one the menu only
     * offers this on while its file is in the air.
     */
    const handleCancelTransfer = useCallback((assetId: string) => {
        context?.services.get<AssetsService>(Services.Assets).cancelTransfers([assetId]);
    }, [context]);
    const searchBoxRef = useRef<HTMLInputElement>(null);
    /**
     * The panel's scroller.
     *
     * Handed to the tree, which windows each section's rows against it. The grid scrolls inside
     * itself and does not need it.
     *
     * State rather than a ref: the scroller is an ancestor of the sections that read it, and React
     * attaches an ancestor's ref *after* its descendants' layout effects have run - so a ref would
     * still be null on the commit where each section's virtualiser first looks for it, and nothing
     * would tell it to look again. The tree drew nothing at all until some unrelated re-render
     * happened to come along.
     */
    const [listScrollElement, setListScrollElement] = useState<HTMLDivElement | null>(null);
    const inputDialog = useMemo(() => {
        if (!context) return null;
        const uiService = context.services.get<UIService>(Services.UI);
        return createInputDialog(uiService);
    }, [context]);
    // How the context menu's developer section says an identifier reached the clipboard.
    const notifyFromMenu = useMemo(() => {
        if (!context) return undefined;
        const uiService = context.services.get<UIService>(Services.UI);
        return (message: string, type: "success" | "error") => uiService.showNotification(message, type);
    }, [context]);

    const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTargetState | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [expandedAssetSets, setExpandedAssetSets] = useState<Set<string>>(new Set());
    
    // Magic Tags state
    const [magicTagDialogVisible, setMagicTagDialogVisible] = useState(false);
    /**
     * The selection the set wizard is open on, or null when it is closed.
     *
     * The folder rides along: a set is drawn where it was made, and by the time the dialog closes the
     * author may have clicked somewhere else entirely.
     */
    const [assetSetWizardAssets, setAssetSetWizardAssets] = useState<{
        assets: Asset[];
        /** The section a set made in a folder belongs to. Read off the files when there are any. */
        category?: AssetCategory;
        groupId?: string;
        parent?: { set: AssetSet; value: string };
    } | null>(null);
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
        if (Array.isArray(saved?.expandedAssetSetIds)) {
            setExpandedAssetSets(new Set(sanitizeStringIds(saved.expandedAssetSetIds)));
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
            expandedAssetSetIds: Array.from(expandedAssetSets),
            iconGroupPathIds,
        });
    }, [categoryOpenItems, context, expandedAssetSets, expandedGroups, iconGroupPathIds, iconSize, panelId, stateReady, viewMode]);

    useEffect(() => {
        if (!stateReady) return;
        const frame = requestAnimationFrame(() => setDisableAccordionAnimation(false));
        return () => cancelAnimationFrame(frame);
    }, [stateReady, panelId]);

    const { assets, groups, loading, hasLoaded, error, loadAssets } = useAssetData({ context, isInitialized });

    const { focusedItemId, setFocusedItemId, handleAssetClick, handleAssetOpen, handleGroupFocus, setFocusToPanel } = useAssetFocus({ context, panelId, focusArea });
    
    // No library is handed in: what a shift range covers is the rows the view below is drawing, and
    // the view publishes those through `publishRowOrder`.
    const { selectedItems, isMultiSelectMode, handleItemSelect, handleClearSelection, publishRowOrder } = useMultiSelection({
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
        usageUnknownAssetIds,
    } = useAssetLibrarySnapshot(context, viewMode === "overview" || filtersNeedLibrarySnapshot(activeFilters));

    const { filterConfigs, handleFilterOpen, filteredAssets, filteredGroups, matchedGroupIds } =
        useAssetFilters({ assets, groups, activeFilters, query: activeQuery, bytesByAssetId, referencedAssetIds, usageUnknownAssetIds });

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

    // Stable across renders on purpose. The icon grid hangs its "back out of this folder" handler off
    // this, and publishes that handler to the compact toolbar from an effect. A fresh arrow here made
    // the handler new on every render, so the effect re-ran and re-published on every render - which
    // rendered again. Entering a folder in the bottom dock looped until React gave up.
    const handleIconGroupPathChange = useCallback((next: string[]) => {
        setIconGroupPathIds(resolveAssetGroupPathIds(next, groups));
    }, [groups]);

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
        handleCreateGroup, handleCreateTextFile, handleCopy, handleCut, handlePaste, handleRename, handleReplaceContent, handleDelete, handleExport, handleImport, handleRetryImport, handleImportToGroup, handleImportRemote,
        handleCreateMagicTags, handleApplyMagicTags,
        modelImportRequest, completeModelImport, cancelModelImport,
        mediaImportRequest, completeMediaImport, cancelMediaImport,
        mediaConvertRequest, handleConvertMedia, finishMediaConvert, cancelMediaConvert
    } = useAssetActions({
        context, inputDialog, assets, groups, selectedItems, clipboard, contextMenuTarget,
        focusedItemId, onActionComplete, setClipboard, setActionLoading, expandGroup, importQueue
    });


    // --- Asset sets -------------------------------------------------------------------------
    // Sets are read here rather than in `useAssetData` because they are not library rows: they are a
    // declaration measured against the library, and the measurement wants the library this panel is
    // already holding.
    const {
        sets: assetSetDeclarations,
        resolved: resolvedAssetSets,
        byCategory: assetSets,
        topLevelByCategory: rootAssetSets,
        memberAssetIds,
        findSet,
    } = useAssetSets({ context, isInitialized, assets });
    const assetSetNaming = useAssetSetNaming({ context, isInitialized });
    const {
        menuState: setMenuState,
        showMenu: showSetMenu,
        hideMenu: hideSetMenu,
    } = useContextMenu();
    /** The set a menu is open on, and the value it was opened at when it was opened on one. */
    const [setMenuTarget, setSetMenuTarget] = useState<{ entry: ResolvedAssetSet; value?: string } | null>(null);

    const handleAssetSetSelect = useCallback((entry: ResolvedAssetSet) => {
        if (!context) return;
        // The set itself goes into the selection, not a copy of its measurement: the inspector reads
        // the service for what to draw, so a stale snapshot in the selection would be a second answer
        // to "what are this set's axes" that only updates when the row is clicked again.
        context.services.get<UIService>(Services.UI).getStore()
            .setSelection({ type: "assetSet", data: entry.set });
    }, [context]);

    /* --- Landing a jump on a set ------------------------------------------------------------ */

    /**
     * The set a jump asked for, held until the library has loaded enough to say where it is.
     *
     * The request arrives on mount - revealing a hidden panel is what mounts it - and at that moment
     * the library is still being read, so nothing can be opened yet.
     */
    const [pendingRevealSetId, setPendingRevealSetId] = useState<string | null>(null);
    const [assetSetReveal, setAssetSetReveal] = useState<AssetSetRevealState | null>(null);
    const revealNonce = useRef(0);

    useEffect(() => {
        const requested = consumeAssetSetReveal(panelId);
        if (requested) {
            setPendingRevealSetId(requested);
        }
        const onRequest = (event: Event) => {
            const detail = (event as CustomEvent<AssetSetRevealRequest>).detail;
            if (detail?.panelId !== panelId) {
                return;
            }
            // Spend the slot as well: this panel was already mounted, so the copy left for the next
            // mount would open folders in a panel the author opens later for something else.
            consumeAssetSetReveal(panelId);
            setPendingRevealSetId(detail.setId);
        };
        window.addEventListener(ASSET_SET_REVEAL_EVENT, onRequest);
        return () => window.removeEventListener(ASSET_SET_REVEAL_EVENT, onRequest);
    }, [panelId]);

    useEffect(() => {
        if (!pendingRevealSetId || !hasLoaded) {
            return;
        }
        // One attempt, against a loaded library. A set that is not there went away between the click
        // and this render, and holding the request would open folders under the author later.
        setPendingRevealSetId(null);
        const plan = planAssetSetReveal({
            setId: pendingRevealSetId,
            placements: resolvedAssetSets,
            groups: Object.values(groups).flat(),
        });
        if (!plan) {
            return;
        }
        setCategoryOpenItems(prev => (prev.includes(plan.category) ? prev : [...prev, plan.category]));
        setExpandedGroups(prev => {
            const next = new Set(prev);
            plan.groupPathIds.forEach(id => next.add(id));
            return next;
        });
        setExpandedAssetSets(prev => {
            const next = new Set(prev);
            plan.ancestorSetIds.forEach(id => next.add(id));
            return next;
        });
        // The grid shows one folder at a time, so it has to be standing in the right one. Harmless
        // while the tree is showing, which reads folders from `expandedGroups` instead.
        setIconGroupPathIds(plan.groupPathIds);
        // The overview is the one view with no row to land on. Nothing else about the author's view
        // is touched - a tree stays a tree, a grid stays a grid.
        setViewMode(prev => (prev === "overview" ? "list" : prev));
        const entry = findSet(pendingRevealSetId);
        if (entry) {
            handleAssetSetSelect(entry);
        }
        revealNonce.current += 1;
        setAssetSetReveal({
            setId: pendingRevealSetId,
            ancestorSetIds: plan.ancestorSetIds,
            nonce: revealNonce.current,
        });
    }, [findSet, groups, handleAssetSetSelect, hasLoaded, pendingRevealSetId, resolvedAssetSets]);

    /**
     * The mark goes away on its own: it says "here", and a ring that stays says "wrong" - the same
     * bargain the settings highlight makes.
     */
    useEffect(() => {
        if (!assetSetReveal) {
            return;
        }
        const timer = window.setTimeout(() => setAssetSetReveal(null), ASSET_SET_REVEAL_MARK_MS);
        return () => window.clearTimeout(timer);
    }, [assetSetReveal]);

    const showAssetSetContextMenu = useCallback((event: React.MouseEvent, entry: ResolvedAssetSet) => {
        event.preventDefault();
        event.stopPropagation();
        setSetMenuTarget({ entry });
        showSetMenu(event);
    }, [showSetMenu]);

    const showAssetSetValueContextMenu = useCallback((
        event: React.MouseEvent,
        entry: ResolvedAssetSet,
        value: string,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        setSetMenuTarget({ entry, value });
        showSetMenu(event);
    }, [showSetMenu]);

    const closeAssetSetContextMenu = useCallback(() => {
        setSetMenuTarget(null);
        hideSetMenu();
    }, [hideSetMenu]);

    /**
     * The rows a new set would be made of: the marked assets, or the focused one when nothing is
     * marked. The same resolution the other asset actions make, so "New Set" acts on what the author
     * can see is chosen.
     */
    const selectedAssetsForSet = useMemo(() => {
        const keys = selectedItems.size > 0
            ? selectedItems
            : new Set(focusedItemId && focusedItemId.startsWith("asset:") ? [focusedItemId] : []);
        const all = ASSET_CATEGORY_ORDER.flatMap(category => assets[category]);
        return all.filter(asset => keys.has(assetSelectionKey(asset.id, false)));
    }, [assets, selectedItems, focusedItemId]);

    // Two rules, both read here so the menu row and the action cannot disagree about whether it is
    // offered. One type only, because a set resolves within a type and a mixed selection has no
    // answer; and at least two rows, because the axes are the tag categories the chosen files
    // *disagree* on - one file agrees with itself about everything and would declare no axes at all.
    const canCreateAssetSet = selectedAssetsForSet.length >= 2
        && selectedAssetsForSet.every(asset => asset.type === selectedAssetsForSet[0].type);

    /**
     * Open the wizard on the marked rows.
     *
     * The rows are handed over as a snapshot rather than read live: the wizard measures the library
     * against the tags it is about to write, and a selection that moved under it would be measuring
     * one set of files while naming another.
     */
    const handleCreateAssetSet = useCallback(async () => {
        if (!canCreateAssetSet) return;
        // The folder the marked files are in, when they agree on one. They are what the author was
        // looking at, so it is the folder they made the set in.
        const groups = new Set(selectedAssetsForSet.map(asset => asset.groupId ?? ""));
        const groupId = groups.size === 1 ? [...groups][0] : "";
        setAssetSetWizardAssets({ assets: [...selectedAssetsForSet], ...(groupId ? { groupId } : {}) });
    }, [canCreateAssetSet, selectedAssetsForSet]);

    /**
     * Make a set out of the marked files and hang it at one value of another set.
     *
     * The files are the marked ones, as they are for any other set - the value is what the menu was
     * opened at, and it is the only thing this adds.
     */
    const handleCreateSubAssetSet = useCallback((parent: { set: AssetSet; value: string }) => {
        if (!canCreateAssetSet) return;
        setAssetSetWizardAssets({
            assets: [...selectedAssetsForSet],
            ...(parent.set.groupId ? { groupId: parent.set.groupId } : {}),
            parent,
        });
    }, [canCreateAssetSet, selectedAssetsForSet]);

    /**
     * Make a set in a folder, with nothing marked.
     *
     * The other way in starts from files and reads the set off them; this one starts from the place,
     * the way New Folder does, and the files are chosen in the dialog. Same dialog either way - a
     * second one would be a second answer to what a set is.
     */
    const handleCreateAssetSetIn = useCallback((category: AssetCategory, groupId?: string) => {
        setAssetSetWizardAssets({ assets: [], category, ...(groupId ? { groupId } : {}) });
    }, []);

    /**
     * Every file the rows drawn inside a set answer with, the nested sets included.
     *
     * What a command aimed at the row acts on. A sub-set is drawn inside its parent and nowhere
     * else, so its files are part of what the author sees inside the row they are commanding.
     */
    const assetSetSubtreeAssets = useCallback((entry: ResolvedAssetSet): Asset[] => {
        const subtree = new Set(assetSetSubtree(entry.set, assetSetDeclarations).map(set => set.id));
        const ids = new Set<string>();
        for (const candidate of resolvedAssetSets) {
            if (!subtree.has(candidate.set.id)) {
                continue;
            }
            for (const cell of candidate.contents.cells) {
                for (const id of cell.assetIds) {
                    ids.add(id);
                }
            }
        }
        return assets[entry.category].filter(asset => ids.has(asset.id));
    }, [assetSetDeclarations, assets, resolvedAssetSets]);

    /**
     * The files this set answers with itself.
     *
     * A value answered by a sub-set is that sub-set's, and its files carry this set's coordinate too
     * - so reading the cells without dropping those would take a nested set's contents along.
     */
    const assetSetOwnAssets = useCallback((entry: ResolvedAssetSet): Asset[] => {
        const ids = new Set(entry.contents.cells
            .filter(cell => cell.childSetIds.length === 0)
            .flatMap(cell => cell.assetIds));
        return assets[entry.category].filter(asset => ids.has(asset.id));
    }, [assets]);

    /** File the given assets in a folder, or at the section root when it is absent. */
    const fileAssetsInGroup = useCallback(async (targets: readonly Asset[], groupId?: string) => {
        const moving = targets.filter(asset => (asset.groupId ?? undefined) !== (groupId ?? undefined));
        if (moving.length === 0 || !context) {
            return;
        }
        const assetsService = context.services.get<AssetsService>(Services.Assets);
        // One call rather than a loop: filing a selection is one gesture, and inside a live session
        // the service turns it into one operation per shard - which is what makes it one press to
        // take back rather than one per row.
        await assetsService.moveAssetsToGroup(moving, groupId);
        void loadAssets();
    }, [context, loadAssets]);

    /**
     * Drop a set in another folder.
     *
     * The files move with it. They are drawn inside the set and nowhere else, so a member left
     * behind is filed somewhere the author cannot see it - and would surface in that old folder the
     * moment the set stopped holding it.
     */
    const handleAssetSetDrop = useCallback(async (
        setId: string,
        targetCategory: AssetCategory,
        targetGroupId?: string,
    ) => {
        if (!context) return;
        const entry = findSet(setId);
        if (!entry || entry.category !== targetCategory) {
            return;
        }
        const service = context.services.get<AssetSetService>(Services.AssetSets);
        if (!service.moveSetToGroup(setId, targetGroupId)) {
            return;
        }
        await fileAssetsInGroup(assetSetSubtreeAssets(entry), targetGroupId);
    }, [assetSetSubtreeAssets, context, fileAssetsInGroup, findSet]);

    /** The ids of a set and the sets drawn inside it, which go together whichever way it is removed. */
    const assetSetSubtreeIds = useCallback((entry: ResolvedAssetSet): string[] => (
        assetSetSubtree(entry.set, assetSetDeclarations).map(set => set.id)
    ), [assetSetDeclarations]);

    /**
     * Ask before a set stops existing, when something still names it.
     *
     * The rows a set is used from name the *set*, not the file behind it, so they are broken by both
     * of the ways it can go - and the library's own delete check cannot see it: that one reads the
     * index, which records a set reference as a reference to the members it resolves to, and those
     * members are exactly what dissolve keeps and what a set with no files never had.
     *
     * Warn, do not block, the way the library's delete does: sometimes the row is about to be
     * rewritten anyway. Answers true when there is nothing to say.
     */
    const confirmAssetSetRemoval = useCallback(async (
        entry: ResolvedAssetSet,
        action: string,
    ): Promise<boolean> => {
        if (!context) return false;
        const referenceService = context.services.get<ReferenceService>(Services.Reference);
        const found = await referenceService.findAssetSetReferences(assetSetSubtreeIds(entry));
        const references = [...found.values()].flat();
        if (references.length === 0) {
            return true;
        }
        const shown = references.slice(0, ASSET_SET_REFERENCE_PREVIEW_LIMIT).map(reference => {
            // The detail line already ends with the label for a story reference (`Story > Scene` /
            // `Scene`), so naming both would print the scene twice.
            const where = reference.detail?.endsWith(reference.label)
                ? reference.detail
                : [reference.detail, reference.label].filter(Boolean).join(" › ");
            return `  ${where}${reference.field ? ` (${reference.field})` : ""}`;
        });
        const remaining = references.length - shown.length;
        if (remaining > 0) {
            shown.push(`  ${t("assets.delete.moreReferences", { count: remaining })}`);
        }
        return context.services.get<UIService>(Services.UI).showDestructiveConfirm(
            t("assets.sets.inUseTitle", { name: entry.set.name }),
            `${t("assets.sets.inUseMessage")}\n\n${shown.join("\n")}`,
            action,
        );
    }, [assetSetSubtreeIds, context, t]);

    /**
     * Drop the set and keep the files.
     *
     * They are filed where the set was, which is where the author was looking at them: a member kept
     * whatever folder it was imported into while the set was drawing it, and leaving it there would
     * scatter the contents of a set across the library the moment it stopped holding them.
     *
     * No confirmation. It writes no bytes and it is one step on the project's undo stack.
     */
    const handleDissolveAssetSet = useCallback(async (entry: ResolvedAssetSet) => {
        if (!context) return;
        if (!(await confirmAssetSetRemoval(entry, t("assets.sets.menu.dissolve")))) {
            return;
        }
        await fileAssetsInGroup(assetSetOwnAssets(entry), entry.set.groupId);
        context.services.get<AssetSetService>(Services.AssetSets).dissolveSet(entry.set.id);
    }, [assetSetOwnAssets, confirmAssetSetRemoval, context, fileAssetsInGroup, t]);

    /**
     * Delete the set and the files it holds, the way deleting a folder takes its contents.
     *
     * The files go through the library's own delete - the reference check, the warning about what
     * still points at them, and the confirmation. The declaration is dropped only once that has run,
     * so cancelling leaves the set exactly as it was.
     */
    const handleDeleteAssetSet = useCallback(async (entry: ResolvedAssetSet) => {
        if (!context) return;
        if (!(await confirmAssetSetRemoval(entry, t("assets.delete.action")))) {
            return;
        }
        const targets: AssetActionTarget[] = assetSetSubtreeAssets(entry)
            .map(asset => ({ isGroup: false, category: entry.category, item: asset }));
        if (targets.length > 0
            && !(await handleDelete(targets, { confirmMessage: t("assets.sets.deleteConfirmMessage") }))) {
            return;
        }
        context.services.get<AssetSetService>(Services.AssetSets).deleteSetSubtree(entry.set.id);
    }, [assetSetSubtreeAssets, confirmAssetSetRemoval, context, handleDelete, t]);

    /** The sub-set command as the asset menu reaches it: by set id and value, not by record. */
    const handleCreateAssetSetAt = useCallback((setId: string, value: string) => {
        const entry = findSet(setId);
        if (entry) {
            handleCreateSubAssetSet({ set: entry.set, value });
        }
    }, [findSet, handleCreateSubAssetSet]);

    const assetSetContextMenu: ContextMenuDef = useMemo(() => {
        if (!setMenuTarget) {
            return [];
        }
        const service = context?.services.get<AssetSetService>(Services.AssetSets) ?? null;
        const { entry, value } = setMenuTarget;
        // On one value of a set, the only thing to offer is the set that hangs there. Rename and
        // delete belong to the set itself, which is the row above.
        if (value !== undefined) {
            return freezeContextMenuRows([
                {
                    id: "new-sub-set",
                    label: t("assets.sets.menu.createSub"),
                    disabled: !canCreateAssetSet,
                    onClick: () => {
                        closeAssetSetContextMenu();
                        handleCreateSubAssetSet({ set: entry.set, value });
                    },
                },
            ], setFreeze.frozen, new Set<string>(), setFreeze.reason);
        }
        return freezeContextMenuRows([
            {
                id: "rename-set",
                label: t("common.rename"),
                onClick: async () => {
                    closeAssetSetContextMenu();
                    const name = await inputDialog?.showRenameDialog(entry.set.name, t("assets.sets.itemType"));
                    if (name) {
                        service?.renameSet(entry.set.id, name);
                    }
                },
            },
            {
                id: "dissolve-set",
                label: t("assets.sets.menu.dissolve"),
                onClick: () => {
                    // No confirmation: no bytes are written, the files stay, and it is one step on
                    // the project's undo stack like every other edit to a set.
                    closeAssetSetContextMenu();
                    void handleDissolveAssetSet(entry);
                },
            },
            {
                id: "delete-set",
                label: t("common.delete"),
                onClick: () => {
                    closeAssetSetContextMenu();
                    void handleDeleteAssetSet(entry);
                },
            },
        ], setFreeze.frozen, new Set<string>(), setFreeze.reason);
    }, [
        setMenuTarget,
        canCreateAssetSet,
        context,
        t,
        inputDialog,
        closeAssetSetContextMenu,
        setFreeze,
        handleCreateSubAssetSet,
        handleDeleteAssetSet,
        handleDissolveAssetSet,
    ]);

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
    const handleExportRef = useRef(handleExport);

    // Update refs when functions change
    handleCopyRef.current = handleCopy;
    handleCutRef.current = handleCut;
    handlePasteRef.current = handlePaste;
    handleDeleteRef.current = handleDelete;
    handleExportRef.current = handleExport;

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
        draggedItem, draggedAssetSet, dropTargetId, dragOver, 
        setDragOver, setDropTargetId, handleDragStart, handleAssetSetDragStart, handleDragEnd, 
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
        onAssetSetDrop: handleAssetSetDrop,
    });

    // F2 opens the rename dialog, which writes the new name straight to the asset record. Nothing
    // renders for the key, so the refusal goes on the handler; memoised so the binding is not
    // re-registered on every render.
    const renameShortcut = useMemo(() => libraryFreeze.run(handleRename), [libraryFreeze, handleRename]);

    useKeyboardShortcuts({
        isInitialized,
        panelId,
        onCopy: () => handleCopyRef.current(),
        onCut: () => handleCutRef.current(),
        onPaste: () => handlePasteRef.current(),
        onRename: renameShortcut,
        registerClipboardShortcuts: false, // already provided by action shortcuts
    });

    /**
     * Which assets will not play as they are. Read by both views to draw their mark, and by the
     * menu to decide whether to offer the conversion.
     *
     * Keyed by asset id and never by `Asset` identity: the library edits its records in place, so a
     * reference to one lives forever and would never look changed.
     */
    const mediaSupport = useMediaAssetSupport();

    /**
     * The sections whose metadata file could not be read. Both views draw a line in place of the
     * rows for one of these, because otherwise it is indistinguishable from a category with
     * nothing in it - and it is the opposite of that.
     */
    const unreadableCategories = useUnreadableAssetCategories();

    const canConvertMedia = useMemo(() => {
        const item = contextMenuTarget?.item;
        if (!item || contextMenuTarget?.isGroup) {
            return false;
        }
        const asset = item as Asset;
        if (asset.source !== AssetSource.Local) {
            return false;
        }
        return mediaSupport.get(asset.id)?.state === "convertible";
    }, [contextMenuTarget, mediaSupport]);

    const { menuState, contextMenu, showContextMenu, closeContextMenu } = useAssetsContextMenu({
        clipboard, contextMenuTarget, setContextMenuTarget, selectedItems, isMultiSelectMode,
        handleClearSelection,
        handleCopy: () => handleCopyRef.current(),
        handleCut: () => handleCutRef.current(),
        handlePaste: () => handlePasteRef.current(),
        handleDelete: async () => { await handleDeleteRef.current(); },
        handleExport: () => handleExportRef.current(),
        handleRename,
        handleReplaceContent: () => handleReplaceContent(),
        handleConvertMedia: () => handleConvertMedia(),
        canConvertMedia,
        handleCreateGroup, handleCreateTextFile, handleImportToGroup, handleCreateMagicTags: handleMagicTagsClick,
        handleCreateAssetSet, canCreateAssetSet, handleCreateAssetSetIn, handleCreateAssetSetAt,
        notify: notifyFromMenu,
        assetTransfers,
        handleCancelTransfer,
    });

    const handleRootDrop = useCallback(
        async (event: React.DragEvent, category: AssetCategory, contextualGroup?: AssetGroup | null) => {
            const targetGroup = contextualGroup ?? null;
            if (draggedItem || draggedAssetSet) {
                await handleDropOnItem(event, category, targetGroup);
            } else {
                await handleImport(category, targetGroup?.id, event.dataTransfer.files, event.dataTransfer);
            }
            setDragOver(false);
            setDropTargetId(null);
        },
        [draggedAssetSet, draggedItem, handleDropOnItem, handleImport]
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
            // Behind the history menu's own 20, which is what puts Undo and Redo at the top of the
            // Edit menu these two now share. Equal orders left the two of them swapping places
            // whenever the history menu re-registered, which is every undo.
            order: 21,
            // These are this panel's versions of the standard editing commands, so they belong under
            // the standard editing items rather than in a second menu also called Edit - on the
            // macOS menu bar, and in the title bar, which folds this slot the same way
            // (`foldActionGroupsByMenuSlot`).
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
                    onClick: libraryFreeze.run((_workspace) => handlePasteRef.current()),
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
                    onClick: libraryFreeze.run((_workspace) => handleDeleteRef.current()),
                    disabled: !hasSelection || actionLoading,
                    when,
                    order: 3,
                },
            ],
        });

        return () => {
            unregisterActionGroup(groupId);
        };
    }, [context, panelId, selectedItems.size, clipboard?.assets.length, clipboard?.groups.length, actionLoading, focusArea, t, freeze, libraryFreeze]);

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
        assets, groups, assetSets, filteredAssets, filteredGroups, matchedGroupIds, selectedItems, focusedItemId,
        draggedItem, draggedAssetSet, dropTargetId, clipboard, isMultiSelectMode, expandedGroups,
        expandedAssetSets, setExpandedAssetSets, assetSetReveal, assetSetNaming, rootAssetSets, memberAssetIds,
        handleItemSelect, publishRowOrder, handleAssetClick, handleAssetOpen, handleGroupFocus, showContextMenu,
        handleAssetSetSelect, showAssetSetContextMenu, showAssetSetValueContextMenu,
        handleDragStart, handleAssetSetDragStart, handleDragEnd, handleDragOverItem, handleDropOnItem, handleImportToGroup,
        setExpandedGroups,
        isFocused: (id: string) => focusedItemId === id,
        isNarrowed,
        compactToolbar: !showHeader,
        setAssetsIconToolbarCenter,
        mediaSupport,
        unreadableCategories,
        handleConvertMedia,
        assetClaims,
        assetTransfers,
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
                                    data-tip={t("common.refresh")}
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
                                        data-tip={t("assets.closeSearch")} aria-label={t("assets.closeSearch")}
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
                                        data-tip={t("assets.searchTooltip")} aria-label={t("assets.searchTooltip")}
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
                                    data-tip={t("assets.backToParent")} aria-label={t("assets.backToParent")}
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
                                    data-tip={t("common.refresh")}
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

                <div ref={setListScrollElement} className="flex-1 overflow-y-auto">
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
                            scrollElement={listScrollElement}
                            trailingSection={
                                <BlueprintScriptsSection open={effectiveOpenItems.includes(BLUEPRINT_SCRIPTS_SECTION_ID)} />
                            }
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
                            onGroupPathChange={handleIconGroupPathChange}
                        />
                    )}
                </div>
                
                <ContextMenu items={contextMenu} position={menuState.position} visible={menuState.visible} onClose={closeContextMenu} />
                {/* A second menu rather than a fourth branch in the asset menu: a set shares none of
                    that menu's rows (it holds no bytes to copy, export or replace), and only one of
                    the two can be open at a time. */}
                <ContextMenu items={assetSetContextMenu} position={setMenuState.position} visible={setMenuState.visible} onClose={closeAssetSetContextMenu} />
                <ModelImportWizard
                    visible={modelImportRequest !== null}
                    onClose={cancelModelImport}
                    onImport={(selection) => void completeModelImport(selection)}
                />
                {/* Mounted only while there is something to ask about, so a run's conversion state
                    cannot survive into the next import. */}
                {mediaImportRequest && (
                    <MediaImportDialog
                        plan={mediaImportRequest.plan}
                        onCancel={cancelMediaImport}
                        onResolve={(resolution) => void completeMediaImport(resolution)}
                    />
                )}
                {/* Mounted only while there is an asset to convert, for the same reason as the
                    import dialog above: half its state describes a conversion in flight. */}
                {mediaConvertRequest && (
                    <MediaConvertAssetDialog
                        asset={mediaConvertRequest.asset}
                        record={mediaConvertRequest.record}
                        onClose={cancelMediaConvert}
                        onConverted={finishMediaConvert}
                    />
                )}
                <MagicTagDialog
                    visible={magicTagDialogVisible}
                    assets={magicTagAssets}
                    template={magicTagTemplate}
                    onClose={handleMagicTagsClose}
                    onApply={handleMagicTagsApply}
                />
                {assetSetWizardAssets && (
                    <AssetSetWizard
                        assets={assetSetWizardAssets.assets}
                        {...(assetSetWizardAssets.category ? { category: assetSetWizardAssets.category } : {})}
                        {...(assetSetWizardAssets.groupId ? { groupId: assetSetWizardAssets.groupId } : {})}
                        {...(assetSetWizardAssets.parent ? { parent: assetSetWizardAssets.parent } : {})}
                        onClose={() => setAssetSetWizardAssets(null)}
                    />
                )}
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
                    data-tip={label} aria-label={label}
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
