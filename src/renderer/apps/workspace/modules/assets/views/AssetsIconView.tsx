import { Dispatch, SetStateAction, DragEvent, useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from "react";
import { ASSET_CATEGORY_ORDER, AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup, AssetSource } from "@/lib/workspace/services/assets/types";
import { FolderPlus, Folder, Link, Upload, ChevronLeft } from "lucide-react";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { iconViewRowOrder } from "../state/assetRowOrder";
import { ASSET_CATEGORY_ICONS, ASSET_TYPE_ICONS } from "../constants";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { AssetThumbnail } from "../components/AssetThumbnail";
import { AssetSupportBadge } from "../components/AssetSupportBadge";
import { AssetSetIconTile } from "../components/AssetSetRow";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { formatAssetSetCoordinateReading, readAssetSetCoordinate } from "@shared/types/assetSetLabels";

interface AssetsIconViewProps {
    dropTargetId: string | null;
    handleRootDrop: (event: DragEvent, category: AssetCategory, contextualGroup?: AssetGroup | null) => Promise<void>;
    actionLoading: boolean;
    setDropTargetId: Dispatch<SetStateAction<string | null>>;
    handleImport: (category: AssetCategory) => void;
    handleImportRemote: (category: AssetCategory) => void;
    handleCreateGroup: (category: AssetCategory) => void;
    iconSize: number;
    onIconSizeChange: (nextSize: number) => void;
    groupPathIds: string[];
    onGroupPathChange: (nextPathIds: string[]) => void;
}

/** How many thumbnails a group tile stacks. Four fills a 2x2 cleanly; more would be unreadable at 120px. */
const GROUP_PREVIEW_LIMIT = 4;

/** `groupId` plus every group nested under it, so a subtree can be counted or previewed in one pass. */
function subtreeGroupIds(groups: readonly AssetGroup[], rootId: string): Set<string> {
    const ids = new Set<string>([rootId]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const group of groups) {
            if (group.parentGroupId && ids.has(group.parentGroupId) && !ids.has(group.id)) {
                ids.add(group.id);
                grew = true;
            }
        }
    }
    return ids;
}

/**
 * Every asset a group holds, however deep.
 *
 * The header used to print only the assets sitting loose at this level, which reads `0 assets` for a
 * category whose every file is filed in a group.
 */
function assetsInSubtree(
    assets: readonly Asset[],
    groups: readonly AssetGroup[],
    rootId: string | null,
): Asset[] {
    if (!rootId) {
        return [...assets];
    }
    const ids = subtreeGroupIds(groups, rootId);
    return assets.filter(asset => !!asset.groupId && ids.has(asset.groupId));
}

export function AssetsIconView({
    dropTargetId,
    handleRootDrop,
    actionLoading,
    setDropTargetId,
    handleImport,
    handleImportRemote,
    handleCreateGroup,
    iconSize,
    onIconSizeChange,
    groupPathIds,
    onGroupPathChange,
}: AssetsIconViewProps) {
    const { t, tn } = useTranslation();
    const freeze = useFreezeGuard();
    const {
        groups,
        filteredAssets,
        filteredGroups,
        draggedItem,
        handleGroupFocus,
        showContextMenu,
        compactToolbar,
        setAssetsIconToolbarCenter,
        isNarrowed,
        matchedGroupIds,
        assetSets,
        rootAssetSets,
        memberAssetIds,
        assetSetNaming,
        assets: libraryAssets,
        handleAssetSetSelect,
        showAssetSetValueContextMenu,
        handleAssetSetDragStart,
        handleDragEnd,
        draggedAssetSet,
        showAssetSetContextMenu,
        publishRowOrder,
        assetSetReveal,
    } = useAssetsPanelContext();
    const groupStack = useMemo(() => {
        const groupById = new Map<string, AssetGroup>();
        Object.values(groups).flat().forEach(group => groupById.set(group.id, group));
        const stack: Array<{ group: AssetGroup; category: AssetCategory }> = [];
        groupPathIds.forEach(groupId => {
            const group = groupById.get(groupId);
            if (group) {
                stack.push({ group, category: group.category });
            }
        });
        return stack;
    }, [groups, groupPathIds]);
    const activeGroup = groupStack.length > 0 ? groupStack[groupStack.length - 1] : null;

    /**
     * The sets walked into, outermost first.
     *
     * Held here rather than in the panel's saved state, unlike the folder path: a folder is where an
     * author leaves the panel, and a set is somewhere they step into and back out of. Cleared
     * whenever the set at the end of it stops existing, so deleting one cannot leave the grid inside
     * something the project no longer has.
     */
    const [setPathIds, setSetPathIds] = useState<string[]>([]);
    const setStack = useMemo(() => {
        const byId = new Map(Object.values(assetSets).flat().map(entry => [entry.set.id, entry]));
        const stack: ResolvedAssetSet[] = [];
        for (const id of setPathIds) {
            const entry = byId.get(id);
            if (!entry) {
                break;
            }
            stack.push(entry);
        }
        return stack;
    }, [assetSets, setPathIds]);
    const activeSet = setStack.length > 0 ? setStack[setStack.length - 1] : null;
    useEffect(() => {
        if (setStack.length !== setPathIds.length) {
            setSetPathIds(setStack.map(entry => entry.set.id));
        }
    }, [setPathIds.length, setStack]);

    // A jump landing on a set: the panel opened the folder, and stepping into whatever encloses the
    // set is the part only the grid can do, since it shows one level at a time. The target itself is
    // not stepped into - it is the tile being revealed, and walking into it would show its contents
    // instead of it. Keyed on the request so following the same reference twice comes back here.
    const revealNonce = assetSetReveal?.nonce ?? null;
    const revealAncestorIds = assetSetReveal?.ancestorSetIds;
    useEffect(() => {
        if (revealNonce === null) {
            return;
        }
        setSetPathIds([...(revealAncestorIds ?? [])]);
        // `revealAncestorIds` is deliberately not a dependency: the request is the event, and its
        // path is a fact about that request rather than something that changes underneath it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealNonce]);

    // A search narrows the whole library, so it takes the reader out of whatever they had opened -
    // the same thing it already does to folders.
    const insideSet = activeSet && !isNarrowed ? activeSet : null;
    // While a search or filter is narrowing the library the grid goes flat: a hit filed three groups
    // down is not a hit if the reader has to guess which folder to open to see it.
    const parentPredicate = useCallback(
        (parentId?: string) => (isNarrowed ? true : activeGroup ? parentId === activeGroup.group.id : !parentId),
        [activeGroup, isNarrowed],
    );

    const handleEnterGroup = useCallback((group: AssetGroup) => {
        onGroupPathChange([...groupPathIds, group.id]);
    }, [groupPathIds, onGroupPathChange]);

    const handleEnterSet = useCallback((entry: ResolvedAssetSet) => {
        setSetPathIds(current => [...current, entry.set.id]);
    }, []);

    // Out of the set first, then out of the folder: they are one path to the reader, and the set is
    // the part of it they are standing in.
    const handleBack = useCallback(() => {
        if (setPathIds.length > 0) {
            setSetPathIds(current => current.slice(0, -1));
            return;
        }
        onGroupPathChange(groupPathIds.slice(0, -1));
    }, [groupPathIds, onGroupPathChange, setPathIds.length]);

    // The compact toolbar draws the breadcrumb, so this handler leaves the component and is held in
    // the panel's state. It goes out through a constant identity on purpose: published directly,
    // `handleBack` changes whenever the caller re-creates `onGroupPathChange` - which callers written
    // inline do on every render - and the effect below would re-publish, re-render, and never settle.
    const backRef = useRef(handleBack);
    useLayoutEffect(() => {
        backRef.current = handleBack;
    }, [handleBack]);
    const publishedBack = useCallback(() => backRef.current(), []);

    useLayoutEffect(() => {
        if (!compactToolbar) {
            setAssetsIconToolbarCenter(null);
            return;
        }
        const crumb = insideSet ? insideSet.set.name : activeGroup && !isNarrowed ? activeGroup.group.name : null;
        if (crumb) {
            const title = crumb;
            // Same folder, same breadcrumb: keep the object React already has rather than writing an
            // equal-but-new one, which would count as a change and schedule another render.
            setAssetsIconToolbarCenter(prev => (
                prev && prev.title === title && prev.onBack === publishedBack
                    ? prev
                    : { title, onBack: publishedBack }
            ));
        } else {
            setAssetsIconToolbarCenter(null);
        }
    }, [compactToolbar, activeGroup, insideSet, isNarrowed, publishedBack, setAssetsIconToolbarCenter]);

    useEffect(() => {
        return () => setAssetsIconToolbarCenter(null);
    }, [setAssetsIconToolbarCenter]);

    const displayCategories = useMemo(() => (insideSet
        ? [insideSet.category]
        : activeGroup && !isNarrowed ? [activeGroup.category] : ASSET_CATEGORY_ORDER), [activeGroup, insideSet, isNarrowed]);

    /**
     * What each section draws, worked out once.
     *
     * Held apart from the markup because the selection needs the same answer: a shift range covers
     * the tiles between the two clicked ones, and the only honest source for which tiles those are
     * is the list the grid is about to render. Deriving it a second time from the library records
     * would put the folder walk, the set stepped into and the flattening a search does into two
     * places at once.
     */
    const sections = useMemo(() => displayCategories.map((category) => {
        // Narrowed, the grid is a result set: only groups that matched by name are hits.
        // The rest of `filteredGroups` is the ancestor scaffolding a tree needs.
        // Inside a set there are no folders and no loose files: what it holds is one
        // answer per value, which the cells below stand for.
        const categoryGroups = insideSet
            ? []
            : isNarrowed
                ? filteredGroups[category].filter((group) => matchedGroupIds.has(group.id))
                : filteredGroups[category].filter((group) => parentPredicate(group.parentGroupId));
        // A file a set answers with is drawn inside that set and not again beside it,
        // the same rule the tree follows: two tiles for one file read as two files.
        const categoryAssets = insideSet
            ? []
            : filteredAssets[category]
                .filter((asset) => parentPredicate(asset.groupId) && !memberAssetIds.has(asset.id));
        // What this section stands for, not what happens to be loose in it.
        const scopedAssets = isNarrowed
            ? categoryAssets
            : assetsInSubtree(filteredAssets[category], filteredGroups[category], activeGroup?.group.id ?? null);
        // Filed where it was made, so walking into a folder shows the sets made in it. Walking into
        // a set draws none of them: what it holds is its own values.
        const categorySets = insideSet
            ? []
            : isNarrowed
                ? rootAssetSets[category]
                : rootAssetSets[category].filter(entry => (entry.set.groupId ?? "") === (activeGroup?.group.id ?? ""));
        // One tile per value the set promises: the file that answers it, the set that
        // answers it, or the hole - which keeps its tile, because the value is why the
        // tile is there and dropping it would make an unfinished set look finished.
        const setCells = insideSet ? insideSet.contents.cells : [];
        return { category, groups: categoryGroups, assets: categoryAssets, scopedAssets, sets: categorySets, setCells };
    }), [
        activeGroup, displayCategories, filteredAssets, filteredGroups, insideSet, isNarrowed,
        matchedGroupIds, memberAssetIds, parentPredicate, rootAssetSets,
    ]);

    const rowOrder = useMemo(() => iconViewRowOrder(sections), [sections]);
    useLayoutEffect(() => {
        publishRowOrder(rowOrder);
        // Cleared on the way out: the tree and the overview draw something else entirely, and a
        // range must never be sliced out of a list of tiles that are no longer on screen.
        return () => publishRowOrder([]);
    }, [publishRowOrder, rowOrder]);

    const minIconSize = 120;
    const maxIconSize = 240;
    const step = 10;

    return (
        <div
            className="h-full flex flex-col relative"
            onWheel={(event) => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                const direction = event.deltaY > 0 ? -1 : 1;
                const next = Math.min(maxIconSize, Math.max(minIconSize, iconSize + direction * step));
                if (next !== iconSize) {
                    onIconSizeChange(next);
                }
            }}
        >
            {(insideSet || (activeGroup && !isNarrowed)) && !compactToolbar && (
                <div
                    // `bg-surface-sunken`, like the other sticky group headers (localization, voice):
                    // a base `bg-surface` is cleared under a workspace wallpaper, and the grid would
                    // scroll straight through this strip.
                    className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-surface-sunken border-b border-edge"
                >
                    <button
                        onClick={handleBack}
                        className="p-1 rounded-md hover:bg-fill"
                        data-tip={t("assets.backToParent")} aria-label={t("assets.backToParent")}
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="text-sm font-semibold truncate px-2">{insideSet ? insideSet.set.name : activeGroup?.group.name}</div>
                    <div className="w-6 h-6" />
                </div>
            )}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {sections.map(({
                    category,
                    groups: categoryGroups,
                    assets: categoryAssets,
                    scopedAssets,
                    sets: categorySets,
                    setCells,
                }) => {
                    const CategoryIcon = ASSET_CATEGORY_ICONS[category];
                    const hasItems = categoryGroups.length > 0
                        || categoryAssets.length > 0
                        || categorySets.length > 0
                        || setCells.length > 0;

                    return (
                        <section
                            key={category}
                            className={`border rounded-lg p-3 bg-fill-subtle ${dropTargetId === "root:" + category ? "border-primary" : "border-transparent"}`}
                            onDrop={(e) => handleRootDrop(e, category, activeGroup?.group ?? undefined)}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedItem?.category === category
                                    || draggedAssetSet?.category === category
                                    || e.dataTransfer.types.includes("Files")) {
                                    setDropTargetId("root:" + category);
                                }
                            }}
                            onDragLeave={(e) => {
                                e.stopPropagation();
                                setDropTargetId((prev) => (prev === "root:" + category ? null : prev));
                            }}
                        >
                            <header
                                className="flex items-center justify-between gap-3"
                                // Same handle and same menu as the list view's accordion header:
                                // one section, two renderings, one way to find and command it.
                                data-asset-category={category}
                                onContextMenu={(e) => showContextMenu(e, category, null, false)}
                            >
                                <div className="flex items-center gap-2">
                                    <CategoryIcon className="w-5 h-5 text-fg" />
                                    <div>
                                        <p className="text-sm font-medium">{t(`assets.categories.${category}`)}</p>
                                        <p className="text-xs text-fg-subtle">{tn("assets.iconView.assetCount", scopedAssets.length)}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {actionLoading ? (
                                        <span className="text-xs text-fg-muted">{t("assets.iconView.updating")}</span>
                                    ) : (
                                        <>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleImport(category);
                                                }}
                                                className="p-1 rounded-md hover:bg-fill disabled:cursor-not-allowed disabled:opacity-40"
                                                {...freeze.writes(false, t("common.import"))}
                                            >
                                                <Upload className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleImportRemote(category);
                                                }}
                                                className="p-1 rounded-md hover:bg-fill disabled:cursor-not-allowed disabled:opacity-40"
                                                {...freeze.writes(false, t("assets.importRemote"))}
                                            >
                                                <Link className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCreateGroup(category);
                                                }}
                                                className="p-1 rounded-md hover:bg-fill disabled:cursor-not-allowed disabled:opacity-40"
                                                {...freeze.writes(false, t("assets.menu.newGroup"))}
                                            >
                                                <FolderPlus className="w-4 h-4" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </header>

                            {/* An empty category prints nothing under its header. The header's own import
                                buttons are the way in; a sentence saying there is nothing here is the
                                thing this deliberately omits. */}
                            {hasItems && (
                                <div
                                    className="mt-3 grid gap-3"
                                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${iconSize}px, 1fr))` }}
                                >
                                    {categorySets.map((entry) => (
                                        <AssetSetIconTile
                                            key={entry.set.id}
                                            entry={entry}
                                            selected={false}
                                            dragging={draggedAssetSet?.setId === entry.set.id}
                                            onSelect={() => handleAssetSetSelect(entry)}
                                            onNavigate={() => handleEnterSet(entry)}
                                            onContextMenu={(event) => showAssetSetContextMenu(event, entry)}
                                            onDragStart={(event) => handleAssetSetDragStart?.(event, category, entry.set.id)}
                                            onDragEnd={() => handleDragEnd?.()}
                                        />
                                    ))}
                                    {setCells.map((cell) => {
                                        const child = cell.childSetIds.length === 1
                                            ? assetSets[category].find(entry => entry.set.id === cell.childSetIds[0])
                                            : undefined;
                                        const coordinate = formatAssetSetCoordinateReading(
                                            readAssetSetCoordinate(insideSet!.set, cell.coordinate, assetSetNaming),
                                        );
                                        if (child) {
                                            return (
                                                <AssetSetIconTile
                                                    key={cell.label}
                                                    entry={child}
                                                    caption={coordinate}
                                                    selected={false}
                                                    onSelect={() => handleAssetSetSelect(child)}
                                                    onNavigate={() => handleEnterSet(child)}
                                                    onContextMenu={(event) => showAssetSetContextMenu(event, child)}
                                                />
                                            );
                                        }
                                        const asset = cell.assetIds.length === 1
                                            ? filteredAssets[category].find(entry => entry.id === cell.assetIds[0])
                                                ?? libraryAssets[category].find(entry => entry.id === cell.assetIds[0])
                                            : undefined;
                                        return asset
                                            ? (
                                                <AssetIconTile
                                                    key={cell.label}
                                                    asset={asset}
                                                    category={category}
                                                    caption={coordinate}
                                                    assetSetValue={{ setId: insideSet!.set.id, value: cell.value }}
                                                />
                                            )
                                            : (
                                                <AssetSetHoleTile
                                                    key={cell.label}
                                                    caption={coordinate}
                                                    onContextMenu={(event) => showAssetSetValueContextMenu(event, insideSet!, cell.value)}
                                                />
                                            );
                                    })}
                                    {categoryGroups.map((group) => {
                                        const childGroups = filteredGroups[category].filter((g) => g.parentGroupId === group.id);
                                        const childAssets = filteredAssets[category]
                                            .filter((a) => a.groupId === group.id && !memberAssetIds.has(a.id));
                                        // Sets made in this folder are tiles in it. Their files are
                                        // drawn inside the set, and dropped from the list above by
                                        // the same rule, so nothing is counted twice.
                                        const childSets = rootAssetSets[category]
                                            .filter((entry) => entry.set.groupId === group.id);
                                        const childCount = childGroups.length + childAssets.length + childSets.length;
                                        // Nested groups count as content: `UI` holds four subgroups and
                                        // no loose file, and a card for it that showed nothing would be
                                        // the blank card this replaces.
                                        const preview = assetsInSubtree(filteredAssets[category], filteredGroups[category], group.id)
                                            .filter((asset) => asset.type === AssetType.Image)
                                            .slice(0, GROUP_PREVIEW_LIMIT);

                                        return (
                                            <GroupIconTile
                                                key={group.id}
                                                group={group}
                                                category={category}
                                                childCount={childCount}
                                                preview={preview}
                                                onNavigate={() => {
                                                    handleGroupFocus(group.id);
                                                    handleEnterGroup(group);
                                                }}
                                            />
                                        );
                                    })}
                                    {categoryAssets.map((asset) => (
                                        <AssetIconTile key={asset.id} asset={asset} category={category} />
                                    ))}
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>
        </div>
    );
}

function GroupIconTile({
    group,
    category,
    childCount,
    preview,
    onNavigate,
}: {
    group: AssetGroup;
    category: AssetCategory;
    childCount: number;
    /** Up to {@link GROUP_PREVIEW_LIMIT} images from anywhere in the group, deepest included. */
    preview: Asset[];
    onNavigate?: () => void;
}) {
    const { t, tn } = useTranslation();
    const freeze = useFreezeGuard();
    const {
        selectedItems,
        clipboard,
        showContextMenu,
        handleItemSelect,
        handleGroupFocus,
        handleDropOnItem,
        handleImportToGroup,
        handleDragStart,
        handleDragEnd,
        draggedItem,
        draggedAssetSet,
    } = useAssetsPanelContext();
    const [isDragOverLocal, setDragOverLocal] = useState(false);
    const isSelected = selectedItems.has("group:" + group.id);
    const isDragging = !!draggedItem && draggedItem.isGroup && draggedItem.item.id === group.id;
    const isCut = clipboard?.type === "cut" && clipboard.groups.some((g) => g.id === group.id);

    return (
        <div
            draggable
            data-asset-group-id={group.id}
            className={`nl-drag-source border rounded-lg p-2 bg-fill-subtle flex flex-col gap-2 cursor-pointer hover:border-edge-strong ${
                isSelected ? "border-primary/80 bg-primary/10" : "border-transparent"
            } ${isDragging ? "opacity-50" : ""} ${isCut ? "opacity-40" : ""} ${isDragOverLocal ? "ring-1 ring-primary/50 bg-primary/10" : ""}`}
            onClick={(e) => {
                const isMultiSelectIntent = e.ctrlKey || e.metaKey || e.shiftKey;
                handleItemSelect(group.id, true, e);
                handleGroupFocus(group.id);
                if (!isMultiSelectIntent) {
                    onNavigate?.();
                }
            }}
            onContextMenu={(e) => showContextMenu(e, category, group, true)}
            onDragStart={(e) => handleDragStart?.(e, category, group, true)}
            onDragEnd={() => handleDragEnd?.()}
            onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const files = e.dataTransfer.types.includes("Files");
                const internal = (draggedItem && draggedItem.category === category)
                    || (draggedAssetSet && draggedAssetSet.category === category);
                // A frozen library never lights up as a drop target: the move and the import are both
                // refused, and a folder that glows and then keeps its old contents reads as a bug.
                if (freeze.frozen || (!internal && !files)) {
                    return;
                }
                setDragOverLocal(true);
                e.dataTransfer.dropEffect = internal ? "move" : "copy";
            }}
            onDragLeave={(e) => {
                e.stopPropagation();
                setDragOverLocal(false);
            }}
            onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverLocal(false);
                if ((draggedItem || draggedAssetSet) && handleDropOnItem) {
                    handleDropOnItem(e, category, group);
                } else {
                    handleImportToGroup(category, group.id, e.dataTransfer.files, e.dataTransfer);
                }
            }}
        >
            <div className="aspect-square w-full overflow-hidden rounded-md bg-surface-sunken">
                {preview.length > 0 ? (
                    <div className={`grid h-full w-full gap-px ${preview.length > 1 ? "grid-cols-2 grid-rows-2" : ""}`}>
                        {preview.map((asset) => (
                            <AssetThumbnail key={asset.id} asset={asset} className="h-full w-full min-h-0 min-w-0" />
                        ))}
                    </div>
                ) : childCount > 0 ? (
                    // Holds things, none of them picturable (audio, fonts): the folder mark is honest here.
                    <div className="flex h-full w-full items-center justify-center">
                        <Folder className="h-1/3 w-1/3 text-fg-subtle" />
                    </div>
                ) : (
                    // Holds nothing. Offer the one thing that changes that, rather than say so.
                    <button
                        type="button"
                        data-tip={t("common.import")} aria-label={t("common.import")}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleImportToGroup(category, group.id);
                        }}
                        className="flex h-full w-full items-center justify-center rounded-md border border-dashed border-edge-strong text-fg-muted hover:bg-fill hover:text-fg"
                    >
                        <Upload className="h-1/4 w-1/4" />
                    </button>
                )}
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
                <Folder className="w-3.5 h-3.5 shrink-0 text-primary" />
                <span className="truncate text-xs font-medium">{group.name}</span>
                <span className="ml-auto shrink-0 text-2xs tabular-nums text-fg-subtle" data-tip={tn("assets.itemCount", childCount)}>
                    {childCount}
                </span>
            </div>
        </div>
    );
}

/**
 * A value of a set with no file for it.
 *
 * Drawn rather than skipped: the value is why there is a tile at all, and a set missing one of its
 * variants would otherwise look finished.
 */
function AssetSetHoleTile({ caption, onContextMenu }: {
    caption: string;
    onContextMenu?: (event: React.MouseEvent) => void;
}) {
    const { t } = useTranslation();
    return (
        <div
            className="flex flex-col gap-2 rounded-lg border border-dashed border-warning/40 bg-fill-subtle p-2"
            onContextMenu={onContextMenu}
        >
            <div className="flex aspect-square w-full items-center justify-center rounded-md bg-fill">
                <span className="text-2xs text-warning">{t("assets.sets.inspector.variantMissing")}</span>
            </div>
            <span className="truncate text-2xs text-fg-subtle" data-tip={caption}>{caption}</span>
        </div>
    );
}

function AssetIconTile({ asset, category, caption, assetSetValue }: {
    asset: Asset;
    category: AssetCategory;
    /** What this file is the variant for, when it is being drawn inside a set. */
    caption?: string;
    /** The set value this tile answers, when it is being drawn inside a set. */
    assetSetValue?: { setId: string; value: string };
}) {
    const { tn } = useTranslation();
    const {
        selectedItems,
        handleItemSelect,
        handleAssetClick,
        isMultiSelectMode,
        showContextMenu,
        handleDragStart,
        handleDragEnd,
        clipboard,
        draggedItem,
        mediaSupport,
        handleConvertMedia,
    } = useAssetsPanelContext();
    const Icon = ASSET_TYPE_ICONS[asset.type];
    const isImage = asset.type === AssetType.Image;
    const isSelected = selectedItems.has("asset:" + asset.id);
    const isDragging = !!draggedItem && !draggedItem.isGroup && draggedItem.item.id === asset.id;
    const support = mediaSupport.get(asset.id);
    // Inside a set, the tile does not leave: which set a file belongs to is written in its tags, so
    // a drop somewhere else would move a tile the set goes on drawing exactly where it was.
    const movable = !assetSetValue;

    return (
        <div
            draggable={movable}
            className={`${movable ? "nl-drag-source " : ""}border rounded-lg p-2 bg-fill-subtle flex flex-col gap-2 cursor-pointer hover:border-edge-strong ${
                isSelected ? "border-primary/80 bg-primary/10" : "border-transparent"
            } ${isDragging ? "opacity-50" : ""} ${
                clipboard?.type === "cut" && clipboard.assets.some((a) => a.id === asset.id) ? "opacity-40" : ""
            }`}
            onClick={(e) => {
                const isMultiSelectIntent = e.ctrlKey || e.metaKey || e.shiftKey;
                handleItemSelect(asset.id, false, e);
                handleAssetClick(asset, isMultiSelectIntent || isMultiSelectMode);
            }}
            onContextMenu={(e) => showContextMenu(e, category, asset, false, assetSetValue)}
            onDragStart={movable ? (e) => handleDragStart?.(e, category, asset, false) : undefined}
            onDragEnd={movable ? () => handleDragEnd?.() : undefined}
        >
            {/* The mark sits over the square rather than in the name row: at 120px that row is a
                name and nothing else fits beside it without truncating the one thing it is for. */}
            <div className="relative">
                {isImage ? (
                    <div className="aspect-square w-full overflow-hidden rounded-md bg-surface-sunken">
                        <AssetThumbnail asset={asset} className="h-full w-full" />
                    </div>
                ) : (
                    // Not a thumbnail pretending to be one: no picture frame, just the category mark. A
                    // waveform / first frame replaces this per type, not a generic file glyph in a photo box.
                    <div className="flex aspect-square w-full items-center justify-center rounded-md bg-fill">
                        <Icon className="h-1/4 w-1/4 text-fg-muted" />
                    </div>
                )}
                {support && (
                    <AssetSupportBadge
                        record={support}
                        onConvert={asset.source === AssetSource.Local ? () => handleConvertMedia(asset) : undefined}
                        className="absolute left-1 top-1"
                    />
                )}
            </div>
            <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-medium" data-tip={asset.name}>{asset.name}</span>
                {!caption && asset.tags.length > 0 && (
                    <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{tn("assets.iconView.tagCount", asset.tags.length)}</span>
                )}
            </div>
            {caption && (
                <span className="-mt-1 truncate text-2xs text-fg-subtle" data-tip={caption}>{caption}</span>
            )}
        </div>
    );
}
