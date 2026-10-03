import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, FolderPlus, LayoutGrid, Link, List, Upload, AlertCircle } from "lucide-react";
import type { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetGroup } from "@/lib/workspace/services/assets/types";
import { Button } from "@/lib/components/elements/Button";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { TooltipGroup } from "@/lib/tooltip";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { formatAssetSetCoordinateReading, readAssetSetCoordinate } from "@shared/types/assetSetLabels";
import type { AssetSetCell } from "@shared/types/assetSet";
import {
    EditorSidebarResizeHandle,
    editorSidebarCssWidth,
    useEditorSidebarWidth,
} from "@/apps/workspace/components/ui/EditorSidebar";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { assetLibraryFreezeScope } from "../assetLiveSession";
import { SearchBox } from "../components/SearchBox";
import { FilterSystem, type ActiveFilter, type FilterConfig } from "../components/FilterSystem";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { formatByteSize } from "../../asset-overview/assetOverviewModel";
import {
    assetBrowserItemBytes,
    assetBrowserItemFormat,
    assetBrowserItemUsage,
    assetBrowserLocationItems,
    assetBrowserResultItems,
    assetBrowserRowOrder,
    groupPath,
    nextAssetBrowserSort,
    parentAssetBrowserLocation,
    sortAssetBrowserItems,
    type AssetBrowserItem,
    type AssetBrowserLocation,
    type AssetBrowserMeasures,
    type AssetBrowserSort,
    type AssetBrowserSortKey,
} from "./assetBrowserModel";
import { BrowserFolderTree } from "./BrowserFolderTree";
import { BrowserGrid } from "./BrowserGrid";
import { BrowserDetails } from "./BrowserDetails";
import { useBrowserDropTarget } from "./useBrowserItemGestures";

export type AssetBrowserViewMode = "grid" | "details";

/** The narrowest tray that still draws the folder tree beside the contents. */
const TREE_MIN_TRAY_WIDTH_PX = 520;

/** Tile sizes Ctrl+wheel moves between. Smaller than the sidebar's grid: the tray is short. */
export const ASSET_BROWSER_TILE_SIZE = { min: 64, max: 192, step: 8, default: 96 } as const;

export interface AssetBrowserViewProps {
    location: AssetBrowserLocation;
    /** Go somewhere. Also ends a search: the results are not filed under any place. */
    onNavigate: (location: AssetBrowserLocation) => void;
    view: AssetBrowserViewMode;
    onViewChange: (view: AssetBrowserViewMode) => void;
    tileSize: number;
    onTileSizeChange: (size: number) => void;
    sort: AssetBrowserSort;
    onSortChange: (sort: AssetBrowserSort) => void;
    openCategories: ReadonlySet<AssetCategory>;
    onToggleCategory: (category: AssetCategory) => void;
    searchQuery: string;
    onSearchQueryChange: (query: string) => void;
    /** The query as the library narrows by it: trimmed and lower-cased. */
    activeQuery: string;
    filterConfigs: FilterConfig[];
    activeFilters: ActiveFilter[];
    onFiltersChange: (filters: ActiveFilter[]) => void;
    onFilterOpen: () => void;
    measures: AssetBrowserMeasures;
    handleImport: (category: AssetCategory, groupId?: string) => void;
    handleImportRemote: (category: AssetCategory, groupId?: string) => void;
    /** Why downloading is off, or absent when it is on. */
    remoteImportBlockedReason?: string;
    handleCreateGroup: (category: AssetCategory, parentGroupId?: string) => void;
    /** Files from the desktop, into a place. */
    handleImportFiles: (category: AssetCategory, groupId: string | undefined, files: FileList, dataTransfer: DataTransfer) => void;
    /** The menu for empty space inside a place. */
    showPlaceContextMenu: (event: React.MouseEvent, category: AssetCategory, groupId?: string) => void;
    onClearSelection: () => void;
    onSelectKeys: (keys: readonly string[]) => void;
}

/**
 * The bottom tray's asset browser.
 *
 * Wide and short, so it does what the sidebar's tall column cannot: a tree of places down the left,
 * and the contents of one place beside it with room for a row of pictures or a table of what each
 * file is. The path above the contents names the place, and Import and New Group put what they make
 * there - which is the place the author is looking at, by construction.
 *
 * Everything the library does to a row - the menus, the shortcuts, the drags into editors and onto
 * folders, the freeze, a live session's marks - is the panel's and is shared with the sidebar; only
 * the shape is this view's.
 */
export function AssetBrowserView({
    location,
    onNavigate,
    view,
    onViewChange,
    tileSize,
    onTileSizeChange,
    sort,
    onSortChange,
    openCategories,
    onToggleCategory,
    searchQuery,
    onSearchQueryChange,
    activeQuery,
    filterConfigs,
    activeFilters,
    onFiltersChange,
    onFilterOpen,
    measures,
    handleImport,
    handleImportRemote,
    remoteImportBlockedReason,
    handleCreateGroup,
    handleImportFiles,
    showPlaceContextMenu,
    onClearSelection,
    onSelectKeys,
}: AssetBrowserViewProps) {
    const { t, tn } = useTranslation();
    const freeze = useFreezeGuard(assetLibraryFreezeScope());
    const {
        assets,
        groups,
        assetSets,
        rootAssetSets,
        memberAssetIds,
        filteredAssets,
        filteredGroups,
        matchedGroupIds,
        isNarrowed,
        assetSetNaming,
        selectedItems,
        publishRowOrder,
        handleAssetOpen,
        handleDropOnItem,
        unreadableCategories,
        assetSetReveal,
    } = useAssetsPanelContext();
    const treeWidth = useEditorSidebarWidth("assetBrowserFolders");

    /**
     * Whether there is room for the tree beside the contents.
     *
     * Below this the tray is a laptop window with both sidebars open, and a tree at its minimum
     * width would leave the contents a column one tile wide. The path above the contents still says
     * where they are and still goes anywhere up the way; double-clicking still goes down.
     */
    const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
    const [showTree, setShowTree] = useState(true);
    useEffect(() => {
        if (!rootElement || typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(() => {
            const width = rootElement.getBoundingClientRect().width;
            // Zero is a hidden tray, which has no width to judge by.
            if (width > 0) {
                setShowTree(width >= TREE_MIN_TRAY_WIDTH_PX);
            }
        });
        observer.observe(rootElement);
        return () => observer.disconnect();
    }, [rootElement]);

    /* --- Where the author is ----------------------------------------------------------------- */

    const locationKey = `${location.category}/${location.groupId ?? ""}`;
    /**
     * The sets walked into from this place, outermost first.
     *
     * Held here rather than in the panel's saved state: a folder is where an author leaves the
     * tray, a set is somewhere they step into and back out of. Keyed by the place, so going anywhere
     * else leaves every set behind.
     */
    const [setTrail, setSetTrail] = useState<{ key: string; ids: string[] }>({ key: locationKey, ids: [] });
    const setTrailIds = setTrail.key === locationKey ? setTrail.ids : [];
    const setPath = useMemo(() => {
        const byId = new Map(assetSets[location.category].map(entry => [entry.set.id, entry]));
        const path: ResolvedAssetSet[] = [];
        for (const id of setTrailIds) {
            const entry = byId.get(id);
            if (!entry) {
                break;
            }
            path.push(entry);
        }
        return path;
    }, [assetSets, location.category, setTrailIds]);
    const insideSet = setPath.length > 0 ? setPath[setPath.length - 1] : null;

    // A jump landing on a set: the panel has moved to its folder, and stepping into whatever encloses
    // the set is this view's part. Keyed on the request, so following the same reference twice works.
    const revealNonce = assetSetReveal?.nonce ?? null;
    useEffect(() => {
        if (revealNonce === null || !assetSetReveal) {
            return;
        }
        setSetTrail({ key: locationKey, ids: [...assetSetReveal.ancestorSetIds] });
        // The request is the event; the place it names is the one this render already holds.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealNonce]);

    const folderPath = useMemo(
        () => groupPath(location.groupId, groups[location.category]),
        [groups, location.category, location.groupId],
    );
    const currentGroup: AssetGroup | null = folderPath.length > 0 ? folderPath[folderPath.length - 1] : null;

    const enterGroup = useCallback((category: AssetCategory, group: AssetGroup) => {
        onNavigate({ category, groupId: group.id });
    }, [onNavigate]);

    const enterSet = useCallback((entry: ResolvedAssetSet) => {
        if (isNarrowed) {
            // A set among the results: go to where it is filed, then into it.
            const key = `${entry.category}/${entry.set.groupId ?? ""}`;
            onNavigate({ category: entry.category, ...(entry.set.groupId ? { groupId: entry.set.groupId } : {}) });
            setSetTrail({ key, ids: [entry.set.id] });
            return;
        }
        setSetTrail({ key: locationKey, ids: [...setTrailIds, entry.set.id] });
    }, [isNarrowed, locationKey, onNavigate, setTrailIds]);

    const parentLocation = parentAssetBrowserLocation(location, groups);
    const canGoUp = !isNarrowed && (setPath.length > 0 || parentLocation !== null);
    const goUp = useCallback(() => {
        if (isNarrowed) {
            return;
        }
        if (setTrailIds.length > 0) {
            setSetTrail({ key: locationKey, ids: setTrailIds.slice(0, -1) });
            return;
        }
        if (parentLocation) {
            onNavigate(parentLocation);
        }
    }, [isNarrowed, locationKey, onNavigate, parentLocation, setTrailIds]);

    /* --- What is here ------------------------------------------------------------------------ */

    const describeCell = useCallback((set: ResolvedAssetSet, cell: AssetSetCell) => (
        formatAssetSetCoordinateReading(readAssetSetCoordinate(set.set, cell.coordinate, assetSetNaming))
    ), [assetSetNaming]);

    const items = useMemo(() => {
        const library = { assets, groups, assetSets, rootAssetSets, memberAssetIds };
        const raw = isNarrowed
            ? assetBrowserResultItems({ filteredAssets, filteredGroups, matchedGroupIds, library, query: activeQuery })
            : assetBrowserLocationItems(location, setPath, library, describeCell);
        return sortAssetBrowserItems(raw, sort, measures);
    }, [
        activeQuery, assetSets, assets, describeCell, filteredAssets, filteredGroups, groups, isNarrowed, location,
        matchedGroupIds, measures, memberAssetIds, rootAssetSets, setPath, sort,
    ]);

    const rowOrder = useMemo(() => assetBrowserRowOrder(items), [items]);
    useLayoutEffect(() => {
        publishRowOrder(rowOrder);
        return () => publishRowOrder([]);
    }, [publishRowOrder, rowOrder]);

    /* --- Dropping on places ------------------------------------------------------------------ */

    const dropOnPlace = useCallback((
        event: React.DragEvent,
        kind: "move" | "files",
        category: AssetCategory,
        group: AssetGroup | null,
    ) => {
        if (kind === "move") {
            void handleDropOnItem?.(event, category, group);
        } else {
            handleImportFiles(category, group?.id, event.dataTransfer.files, event.dataTransfer);
        }
    }, [handleDropOnItem, handleImportFiles]);

    const canMakeHere = !isNarrowed && !insideSet;
    const placeDrop = useBrowserDropTarget(
        canMakeHere ? location.category : null,
        (event, kind) => dropOnPlace(event, kind, location.category, currentGroup),
    );

    /* --- Keys, wheel and the empty space ----------------------------------------------------- */

    const openSelection = useCallback(() => {
        if (selectedItems.size !== 1) {
            return;
        }
        const key = [...selectedItems][0];
        const item = items.find(entry =>
            (entry.kind === "group" && key === "group:" + entry.group.id)
            || (entry.kind === "asset" && key === "asset:" + entry.asset.id));
        if (item?.kind === "group") {
            enterGroup(item.category, item.group);
        } else if (item?.kind === "asset") {
            handleAssetOpen(item.asset);
        }
    }, [enterGroup, handleAssetOpen, items, selectedItems]);

    const onContentKeyDown = (event: React.KeyboardEvent) => {
        const mod = event.ctrlKey || event.metaKey;
        if (event.key === "Backspace" || (event.altKey && event.key === "ArrowUp")) {
            event.preventDefault();
            event.stopPropagation();
            goUp();
        } else if (event.key === "Enter") {
            event.preventDefault();
            openSelection();
        } else if (mod && event.key.toLowerCase() === "a") {
            event.preventDefault();
            event.stopPropagation();
            onSelectKeys(rowOrder);
        }
    };

    const onContentWheel = (event: React.WheelEvent) => {
        if (!event.ctrlKey || view !== "grid") {
            return;
        }
        event.preventDefault();
        const direction = event.deltaY > 0 ? -1 : 1;
        const next = Math.min(
            ASSET_BROWSER_TILE_SIZE.max,
            Math.max(ASSET_BROWSER_TILE_SIZE.min, tileSize + direction * ASSET_BROWSER_TILE_SIZE.step),
        );
        if (next !== tileSize) {
            onTileSizeChange(next);
        }
    };

    const isOnItem = (target: EventTarget) =>
        target instanceof Element && !!target.closest("[data-asset-browser-item], [role=columnheader]");

    /* --- Drawing ----------------------------------------------------------------------------- */

    const unreadable = !isNarrowed && unreadableCategories.has(location.category);
    const placeGroupId = currentGroup?.id;

    let content: React.ReactNode;
    if (items.length === 0) {
        content = isNarrowed ? (
            <div className="flex h-full items-center justify-center px-4 text-xs text-fg-subtle">
                {t("assets.list.emptyFiltered")}
            </div>
        ) : unreadable || insideSet ? null : (
            // An empty place offers the thing that fills it.
            <div className="flex h-full items-center justify-center">
                <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => handleImport(location.category, placeGroupId)}
                    {...freeze.writes(false, undefined)}
                >
                    <Upload className="h-3.5 w-3.5" />
                    {t("assets.menu.importAssets")}
                </Button>
            </div>
        );
    } else if (view === "details") {
        content = (
            <BrowserDetails
                items={items}
                measures={measures}
                sort={sort}
                onSortChange={(key: AssetBrowserSortKey) => onSortChange(nextAssetBrowserSort(sort, key))}
                showLocation={isNarrowed}
                insideSet={insideSet}
                onEnterGroup={enterGroup}
                onEnterSet={enterSet}
                onDropOnGroup={dropOnPlace}
            />
        );
    } else {
        content = (
            <BrowserGrid
                items={items}
                tileSize={tileSize}
                measures={measures}
                insideSet={insideSet}
                onEnterGroup={enterGroup}
                onEnterSet={enterSet}
                onDropOnGroup={dropOnPlace}
            />
        );
    }

    return (
        <div ref={setRootElement} className="flex h-full min-h-0 flex-col">
            {/* Wraps rather than crushing the path: in a tray too narrow for one row, the buttons go
                to a second one and the place stays readable. */}
            <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-edge px-2 py-1">
                {isNarrowed ? (
                    <span className="min-w-32 flex-1 truncate px-1 text-xs text-fg-muted">
                        {tn("assets.browser.results", items.length)}
                    </span>
                ) : (
                    <div className="flex min-w-32 flex-1 items-center gap-1">
                        <ToolbarButton
                            size="sm"
                            className="shrink-0"
                            onClick={goUp}
                            disabled={!canGoUp}
                            aria-label={t("assets.backToParent")}
                            data-tip={t("assets.backToParent")}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </ToolbarButton>
                        <BrowserPath
                            location={location}
                            folderPath={folderPath}
                            setPath={setPath}
                            onNavigate={onNavigate}
                            onLeaveSets={depth => setSetTrail({ key: locationKey, ids: setTrailIds.slice(0, depth) })}
                            onDropOnPlace={dropOnPlace}
                        />
                    </div>
                )}
                {/* On a row of its own the search field gives way before the buttons do: they are
                    the same width at any tray width, and a narrower field still takes a query. */}
                <div className="ml-auto flex min-w-0 max-w-full items-center gap-1">
                    <SearchBox
                        size="sm"
                        className="w-44 min-w-20 shrink"
                        value={searchQuery}
                        onChange={onSearchQueryChange}
                        placeholder={t("assets.searchPlaceholder")}
                    />
                    <FilterSystem
                        compact
                        className="shrink-0"
                        filters={filterConfigs}
                        activeFilters={activeFilters}
                        onFiltersChange={onFiltersChange}
                        onFilterOpen={onFilterOpen}
                    />
                    <span className="mx-1 h-4 shrink-0 border-l border-edge" />
                    <TooltipGroup className="flex shrink-0 items-center gap-0.5">
                        <ToolbarButton
                            size="sm"
                            active={view === "grid"}
                            aria-pressed={view === "grid"}
                            aria-label={t("assets.view.icons")}
                            data-tip={t("assets.view.icons")}
                            onClick={() => onViewChange("grid")}
                        >
                            <LayoutGrid className="h-4 w-4" />
                        </ToolbarButton>
                        <ToolbarButton
                            size="sm"
                            active={view === "details"}
                            aria-pressed={view === "details"}
                            aria-label={t("assets.view.details")}
                            data-tip={t("assets.view.details")}
                            onClick={() => onViewChange("details")}
                        >
                            <List className="h-4 w-4" />
                        </ToolbarButton>
                    </TooltipGroup>
                    <span className="mx-1 h-4 shrink-0 border-l border-edge" />
                    <TooltipGroup className="flex shrink-0 items-center gap-0.5">
                        <ToolbarButton
                            size="sm"
                            aria-label={t("common.import")}
                            onClick={() => handleImport(location.category, placeGroupId)}
                            {...freeze.writes(!canMakeHere, t("common.import"))}
                        >
                            <Upload className="h-4 w-4" />
                        </ToolbarButton>
                        <ToolbarButton
                            size="sm"
                            aria-label={t("assets.importRemote")}
                            onClick={() => handleImportRemote(location.category, placeGroupId)}
                            {...freeze.writes(
                                !canMakeHere || Boolean(remoteImportBlockedReason),
                                remoteImportBlockedReason ?? t("assets.importRemote"),
                            )}
                        >
                            <Link className="h-4 w-4" />
                        </ToolbarButton>
                        <ToolbarButton
                            size="sm"
                            aria-label={t("assets.menu.newGroup")}
                            onClick={() => handleCreateGroup(location.category, placeGroupId)}
                            {...freeze.writes(!canMakeHere, t("assets.menu.newGroup"))}
                        >
                            <FolderPlus className="h-4 w-4" />
                        </ToolbarButton>
                    </TooltipGroup>
                </div>
            </div>

            <div className="flex min-h-0 flex-1">
                {/* No right border: the resize seam on that edge is the line (see `EditorSidebarResizeHandle`). */}
                {showTree && <aside
                    className="relative flex shrink-0 flex-col"
                    style={{ width: editorSidebarCssWidth("assetBrowserFolders", treeWidth) }}
                >
                    <EditorSidebarResizeHandle id="assetBrowserFolders" edge="right" />
                    <BrowserFolderTree
                        location={isNarrowed ? null : location}
                        onNavigate={onNavigate}
                        openCategories={openCategories}
                        onToggleCategory={onToggleCategory}
                        onDropOnPlace={dropOnPlace}
                    />
                </aside>}
                <div className="flex min-w-0 flex-1 flex-col">
                    <div
                        tabIndex={0}
                        data-asset-browser-contents=""
                        className={cn(
                            "relative min-h-0 flex-1 outline-none",
                            placeDrop.over && "bg-primary/5 ring-1 ring-inset ring-primary/40",
                        )}
                        onKeyDown={onContentKeyDown}
                        onWheel={onContentWheel}
                        onClick={event => {
                            if (!isOnItem(event.target)) {
                                onClearSelection();
                            }
                        }}
                        onContextMenu={event => {
                            if (isOnItem(event.target)) {
                                return;
                            }
                            if (canMakeHere) {
                                showPlaceContextMenu(event, location.category, placeGroupId);
                            } else {
                                event.preventDefault();
                            }
                        }}
                        {...placeDrop.handlers}
                    >
                        {unreadable && (
                            <div className="flex items-start gap-1.5 px-3 py-2 text-xs text-danger">
                                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                                <span>{t("assets.unreadable.category")}</span>
                            </div>
                        )}
                        {content}
                    </div>
                    <BrowserStatus items={items} measures={measures} showLocation={isNarrowed} />
                </div>
            </div>
        </div>
    );
}

/**
 * Where the contents are: the category, the folders down to this one, and the sets walked into.
 * A press goes to that place; a folder segment also takes a drop, the way its tree row does.
 */
function BrowserPath({ location, folderPath, setPath, onNavigate, onLeaveSets, onDropOnPlace }: {
    location: AssetBrowserLocation;
    folderPath: readonly AssetGroup[];
    setPath: readonly ResolvedAssetSet[];
    onNavigate: (location: AssetBrowserLocation) => void;
    /** Step back out to `depth` sets deep without leaving the folder. */
    onLeaveSets: (depth: number) => void;
    onDropOnPlace: (event: React.DragEvent, kind: "move" | "files", category: AssetCategory, group: AssetGroup | null) => void;
}) {
    const { t } = useTranslation();
    const segments: Array<{ key: string; label: string; group: AssetGroup | null; onClick: () => void; droppable: boolean }> = [
        {
            key: "category",
            label: t(`assets.categories.${location.category}`),
            group: null,
            onClick: () => onNavigate({ category: location.category }),
            droppable: true,
        },
        ...folderPath.map(group => ({
            key: "group:" + group.id,
            label: group.name,
            group,
            onClick: () => onNavigate({ category: location.category, groupId: group.id }),
            droppable: true,
        })),
        ...setPath.map((entry, index) => ({
            key: "set:" + entry.set.id,
            label: entry.set.name,
            group: null,
            onClick: () => onLeaveSets(index + 1),
            droppable: false,
        })),
    ];
    return (
        <nav className="flex min-w-0 flex-1 items-center overflow-hidden">
            {segments.map((segment, index) => (
                <Fragment key={segment.key}>
                    {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-fg-subtle" />}
                    <PathSegment
                        label={segment.label}
                        current={index === segments.length - 1}
                        category={segment.droppable ? location.category : null}
                        onClick={segment.onClick}
                        onDrop={(event, kind) => onDropOnPlace(event, kind, location.category, segment.group)}
                    />
                </Fragment>
            ))}
        </nav>
    );
}

function PathSegment({ label, current, category, onClick, onDrop }: {
    label: string;
    current: boolean;
    category: AssetCategory | null;
    onClick: () => void;
    onDrop: (event: React.DragEvent, kind: "move" | "files") => void;
}) {
    const drop = useBrowserDropTarget(category, onDrop);
    return (
        <button
            type="button"
            data-asset-browser-path=""
            className={cn(
                "min-w-0 max-w-40 shrink truncate rounded-md px-1.5 py-1 text-xs cursor-default",
                current ? "text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                drop.over && "bg-primary/10 ring-1 ring-inset ring-primary/50",
            )}
            data-tip={label}
            onClick={onClick}
            {...drop.handlers}
        >
            {label}
        </button>
    );
}

/**
 * One line of values under the contents, and no labels: what is selected on the left, what is here
 * on the right. A single file reads as its own line - name, format, size, how many places use it -
 * and, among results, where it is filed.
 */
function BrowserStatus({ items, measures, showLocation }: {
    items: readonly AssetBrowserItem[];
    measures: AssetBrowserMeasures;
    showLocation: boolean;
}) {
    const { t, tn } = useTranslation();
    const { selectedItems, groups } = useAssetsPanelContext();

    const selected = items.filter(item =>
        (item.kind === "group" && selectedItems.has("group:" + item.group.id))
        || (item.kind === "asset" && selectedItems.has("asset:" + item.asset.id)));

    const sumBytes = (list: readonly AssetBrowserItem[]) => {
        let total = 0;
        let any = false;
        for (const item of list) {
            const bytes = assetBrowserItemBytes(item, measures);
            if (bytes !== null) {
                total += bytes;
                any = true;
            }
        }
        return any ? formatByteSize(total) : "";
    };

    let left = "";
    if (selected.length === 1) {
        const item = selected[0];
        if (item.kind === "asset") {
            const usage = assetBrowserItemUsage(item, measures);
            const bytes = assetBrowserItemBytes(item, measures);
            const where = showLocation
                ? [t(`assets.categories.${item.category}`), ...groupPath(item.asset.groupId, groups[item.category]).map(group => group.name)].join(" ▸ ")
                : "";
            left = [
                where,
                item.asset.name,
                assetBrowserItemFormat(item),
                bytes === null ? "" : formatByteSize(bytes),
                usage === null ? "" : usage === 0 ? t("assets.overview.stat.unreferenced") : tn("assets.overview.uses", usage),
            ].filter(Boolean).join(" · ");
        } else if (item.kind === "group") {
            left = [item.group.name, tn("assets.itemCount", item.childCount)].join(" · ");
        }
    } else if (selected.length > 1) {
        left = [tn("assets.browser.selected", selected.length), sumBytes(selected)].filter(Boolean).join(" · ");
    }
    const right = [tn("assets.itemCount", items.length), sumBytes(items)].filter(Boolean).join(" · ");

    return (
        <div className="flex h-6 shrink-0 items-center gap-3 border-t border-edge px-3 text-2xs text-fg-muted">
            <span className="min-w-0 truncate" data-asset-browser-status="">{left}</span>
            <span className="ml-auto shrink-0 tabular-nums">{right}</span>
        </div>
    );
}
