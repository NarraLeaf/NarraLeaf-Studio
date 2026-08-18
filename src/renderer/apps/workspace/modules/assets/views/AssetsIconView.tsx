import { Dispatch, SetStateAction, DragEvent, useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from "react";
import { ASSET_CATEGORY_ORDER, AssetCategory, AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup, AssetSource } from "@/lib/workspace/services/assets/types";
import { FolderPlus, Folder, Link, Upload, ChevronLeft } from "lucide-react";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { ASSET_CATEGORY_ICONS, ASSET_TYPE_ICONS } from "../constants";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { AssetThumbnail } from "../components/AssetThumbnail";
import { AssetSupportBadge } from "../components/AssetSupportBadge";
import { AssetSetIconTile } from "../components/AssetSetRow";

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
        handleAssetSetSelect,
        showAssetSetContextMenu,
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
    // While a search or filter is narrowing the library the grid goes flat: a hit filed three groups
    // down is not a hit if the reader has to guess which folder to open to see it.
    const parentPredicate = useCallback(
        (parentId?: string) => (isNarrowed ? true : activeGroup ? parentId === activeGroup.group.id : !parentId),
        [activeGroup, isNarrowed],
    );

    const handleEnterGroup = useCallback((group: AssetGroup) => {
        onGroupPathChange([...groupPathIds, group.id]);
    }, [groupPathIds, onGroupPathChange]);

    const handleBack = useCallback(() => {
        onGroupPathChange(groupPathIds.slice(0, -1));
    }, [groupPathIds, onGroupPathChange]);

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
        if (activeGroup && !isNarrowed) {
            const title = activeGroup.group.name;
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
    }, [compactToolbar, activeGroup, isNarrowed, publishedBack, setAssetsIconToolbarCenter]);

    useEffect(() => {
        return () => setAssetsIconToolbarCenter(null);
    }, [setAssetsIconToolbarCenter]);

    const displayCategories = activeGroup && !isNarrowed ? [activeGroup.category] : ASSET_CATEGORY_ORDER;
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
            {activeGroup && !isNarrowed && !compactToolbar && (
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
                    <div className="text-sm font-semibold truncate px-2">{activeGroup.group.name}</div>
                    <div className="w-6 h-6" />
                </div>
            )}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {displayCategories.map((category) => {
                    const CategoryIcon = ASSET_CATEGORY_ICONS[category];
                    // Narrowed, the grid is a result set: only groups that matched by name are hits.
                    // The rest of `filteredGroups` is the ancestor scaffolding a tree needs.
                    const categoryGroups = isNarrowed
                        ? filteredGroups[category].filter((group) => matchedGroupIds.has(group.id))
                        : filteredGroups[category].filter((group) => parentPredicate(group.parentGroupId));
                    const categoryAssets = filteredAssets[category].filter((asset) => parentPredicate(asset.groupId));
                    // What this section stands for, not what happens to be loose in it.
                    const scopedAssets = isNarrowed
                        ? categoryAssets
                        : assetsInSubtree(filteredAssets[category], filteredGroups[category], activeGroup?.group.id ?? null);
                    // Only at the top of a section, never inside a folder: a set is filed under the
                    // section its type belongs to and is not in any folder, so walking into one must
                    // not keep drawing it as if it were part of that folder's contents.
                    const categorySets = activeGroup && !isNarrowed ? [] : assetSets[category];
                    const hasItems = categoryGroups.length > 0 || categoryAssets.length > 0 || categorySets.length > 0;

                    return (
                        <section
                            key={category}
                            className={`border rounded-lg p-3 bg-fill-subtle ${dropTargetId === "root:" + category ? "border-primary" : "border-transparent"}`}
                            onDrop={(e) => handleRootDrop(e, category, activeGroup?.group ?? undefined)}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedItem?.category === category || e.dataTransfer.types.includes("Files")) {
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
                                            onSelect={() => handleAssetSetSelect(entry)}
                                            onContextMenu={(event) => showAssetSetContextMenu(event, entry)}
                                        />
                                    ))}
                                    {categoryGroups.map((group) => {
                                        const childGroups = filteredGroups[category].filter((g) => g.parentGroupId === group.id);
                                        const childAssets = filteredAssets[category].filter((a) => a.groupId === group.id);
                                        const childCount = childGroups.length + childAssets.length;
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
                const internal = draggedItem && draggedItem.category === category;
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
                if (draggedItem && handleDropOnItem) {
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

function AssetIconTile({ asset, category }: { asset: Asset; category: AssetCategory }) {
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

    return (
        <div
            draggable
            className={`nl-drag-source border rounded-lg p-2 bg-fill-subtle flex flex-col gap-2 cursor-pointer hover:border-edge-strong ${
                isSelected ? "border-primary/80 bg-primary/10" : "border-transparent"
            } ${isDragging ? "opacity-50" : ""} ${
                clipboard?.type === "cut" && clipboard.assets.some((a) => a.id === asset.id) ? "opacity-40" : ""
            }`}
            onClick={(e) => {
                const isMultiSelectIntent = e.ctrlKey || e.metaKey || e.shiftKey;
                handleItemSelect(asset.id, false, e);
                handleAssetClick(asset, isMultiSelectIntent || isMultiSelectMode);
            }}
            onContextMenu={(e) => showContextMenu(e, category, asset, false)}
            onDragStart={(e) => handleDragStart?.(e, category, asset, false)}
            onDragEnd={() => handleDragEnd?.()}
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
                {asset.tags.length > 0 && (
                    <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{tn("assets.iconView.tagCount", asset.tags.length)}</span>
                )}
            </div>
        </div>
    );
}
