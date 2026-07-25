import { Dispatch, SetStateAction, DragEvent, useMemo, useState, useEffect, useLayoutEffect, useCallback } from "react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { FolderPlus, Folder, Link, Upload, ChevronLeft } from "lucide-react";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { ASSET_TYPE_ICONS } from "../constants";
import { useTranslation } from "@/lib/i18n";
import { AssetThumbnail } from "../components/AssetThumbnail";

interface AssetsIconViewProps {
    dropTargetId: string | null;
    handleRootDrop: (event: DragEvent, type: AssetType, contextualGroup?: AssetGroup | null) => Promise<void>;
    actionLoading: boolean;
    setDropTargetId: Dispatch<SetStateAction<string | null>>;
    handleImport: (type: AssetType) => void;
    handleImportRemote: (type: AssetType) => void;
    handleCreateGroup: (type: AssetType) => void;
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
 * category whose every file is filed in a group — the count that sent this card into existence.
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
    const {
        groups,
        filteredAssets,
        filteredGroups,
        draggedItem,
        handleGroupFocus,
        compactToolbar,
        setAssetsIconToolbarCenter,
        isNarrowed,
        matchedGroupIds,
    } = useAssetsPanelContext();
    const groupStack = useMemo(() => {
        const groupById = new Map<string, AssetGroup>();
        Object.values(groups).flat().forEach(group => groupById.set(group.id, group));
        const stack: Array<{ group: AssetGroup; type: AssetType }> = [];
        groupPathIds.forEach(groupId => {
            const group = groupById.get(groupId);
            if (group) {
                stack.push({ group, type: group.type });
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

    const handleEnterGroup = useCallback((group: AssetGroup, type: AssetType) => {
        onGroupPathChange([...groupPathIds, group.id]);
    }, [groupPathIds, onGroupPathChange]);

    const handleBack = useCallback(() => {
        onGroupPathChange(groupPathIds.slice(0, -1));
    }, [groupPathIds, onGroupPathChange]);

    useLayoutEffect(() => {
        if (!compactToolbar) {
            setAssetsIconToolbarCenter(null);
            return;
        }
        if (activeGroup && !isNarrowed) {
            setAssetsIconToolbarCenter({
                title: activeGroup.group.name,
                onBack: handleBack,
            });
        } else {
            setAssetsIconToolbarCenter(null);
        }
    }, [compactToolbar, activeGroup, isNarrowed, handleBack, setAssetsIconToolbarCenter]);

    useEffect(() => {
        return () => setAssetsIconToolbarCenter(null);
    }, [setAssetsIconToolbarCenter]);

    const displayTypes = activeGroup && !isNarrowed ? [activeGroup.type] : Object.values(AssetType);
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
                <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-surface border-b border-edge">
                    <button
                        onClick={handleBack}
                        className="p-1 rounded-md hover:bg-fill"
                        title={t("assets.backToParent")}
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="text-sm font-semibold truncate px-2">{activeGroup.group.name}</div>
                    <div className="w-6 h-6" />
                </div>
            )}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {displayTypes.map((type) => {
                    const TypeIcon = ASSET_TYPE_ICONS[type];
                    // Narrowed, the grid is a result set: only groups that matched by name are hits.
                    // The rest of `filteredGroups` is the ancestor scaffolding a tree needs.
                    const typeGroups = isNarrowed
                        ? filteredGroups[type].filter((group) => matchedGroupIds.has(group.id))
                        : filteredGroups[type].filter((group) => parentPredicate(group.parentGroupId));
                    const typeAssets = filteredAssets[type].filter((asset) => parentPredicate(asset.groupId));
                    // What this section stands for, not what happens to be loose in it.
                    const scopedAssets = isNarrowed
                        ? typeAssets
                        : assetsInSubtree(filteredAssets[type], filteredGroups[type], activeGroup?.group.id ?? null);
                    const hasItems = typeGroups.length > 0 || typeAssets.length > 0;

                    return (
                        <section
                            key={type}
                            className={`border rounded-lg p-3 bg-fill-subtle ${dropTargetId === "root:" + type ? "border-primary" : "border-transparent"}`}
                            onDrop={(e) => handleRootDrop(e, type, activeGroup?.group ?? undefined)}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedItem?.type === type || e.dataTransfer.types.includes("Files")) {
                                    setDropTargetId("root:" + type);
                                }
                            }}
                            onDragLeave={(e) => {
                                e.stopPropagation();
                                setDropTargetId((prev) => (prev === "root:" + type ? null : prev));
                            }}
                        >
                            <header className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <TypeIcon className="w-5 h-5 text-fg" />
                                    <div>
                                        <p className="text-sm font-medium">{t(`assets.types.${type}`)}</p>
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
                                                    handleImport(type);
                                                }}
                                                className="p-1 rounded-md hover:bg-fill"
                                                title={t("common.import")}
                                            >
                                                <Upload className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleImportRemote(type);
                                                }}
                                                className="p-1 rounded-md hover:bg-fill"
                                                title={t("assets.importRemote")}
                                            >
                                                <Link className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCreateGroup(type);
                                                }}
                                                className="p-1 rounded-md hover:bg-fill"
                                                title={t("assets.menu.newGroup")}
                                            >
                                                <FolderPlus className="w-4 h-4" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </header>

                            {/* An empty category prints nothing under its header. The header's own import
                                buttons are the way in; a sentence saying there is nothing here is the
                                thing this card removes. */}
                            {hasItems && (
                                <div
                                    className="mt-3 grid gap-3"
                                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${iconSize}px, 1fr))` }}
                                >
                                    {typeGroups.map((group) => {
                                        const childGroups = filteredGroups[type].filter((g) => g.parentGroupId === group.id);
                                        const childAssets = filteredAssets[type].filter((a) => a.groupId === group.id);
                                        const childCount = childGroups.length + childAssets.length;
                                        // Nested groups count as content: `UI` holds four subgroups and
                                        // no loose file, and a card for it that showed nothing would be
                                        // the blank card this replaces.
                                        const preview = assetsInSubtree(filteredAssets[type], filteredGroups[type], group.id)
                                            .filter((asset) => asset.type === AssetType.Image)
                                            .slice(0, GROUP_PREVIEW_LIMIT);

                                        return (
                                            <GroupIconTile
                                                key={group.id}
                                                group={group}
                                                type={type}
                                                childCount={childCount}
                                                preview={preview}
                                                onNavigate={() => {
                                                    handleGroupFocus(group.id);
                                                    handleEnterGroup(group, type);
                                                }}
                                            />
                                        );
                                    })}
                                    {typeAssets.map((asset) => (
                                        <AssetIconTile key={asset.id} asset={asset} type={type} />
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
    type,
    childCount,
    preview,
    onNavigate,
}: {
    group: AssetGroup;
    type: AssetType;
    childCount: number;
    /** Up to {@link GROUP_PREVIEW_LIMIT} images from anywhere in the group, deepest included. */
    preview: Asset[];
    onNavigate?: () => void;
}) {
    const { t, tn } = useTranslation();
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
            onContextMenu={(e) => showContextMenu(e, type, group, true)}
            onDragStart={(e) => handleDragStart?.(e, type, group, true)}
            onDragEnd={() => handleDragEnd?.()}
            onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const files = e.dataTransfer.types.includes("Files");
                const internal = draggedItem && draggedItem.type === type;
                if (!internal && !files) {
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
                    handleDropOnItem(e, type, group);
                } else {
                    handleImportToGroup(type, group.id, e.dataTransfer.files, e.dataTransfer);
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
                        title={t("common.import")}
                        onClick={(e) => {
                            e.stopPropagation();
                            handleImportToGroup(type, group.id);
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
                <span className="ml-auto shrink-0 text-2xs tabular-nums text-fg-subtle" title={tn("assets.itemCount", childCount)}>
                    {childCount}
                </span>
            </div>
        </div>
    );
}

function AssetIconTile({ asset, type }: { asset: Asset; type: AssetType }) {
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
    } = useAssetsPanelContext();
    const Icon = ASSET_TYPE_ICONS[asset.type];
    const isImage = asset.type === AssetType.Image;
    const isSelected = selectedItems.has("asset:" + asset.id);
    const isDragging = !!draggedItem && !draggedItem.isGroup && draggedItem.item.id === asset.id;

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
            onContextMenu={(e) => showContextMenu(e, type, asset, false)}
            onDragStart={(e) => handleDragStart?.(e, type, asset, false)}
            onDragEnd={() => handleDragEnd?.()}
        >
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
            <div className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-medium" title={asset.name}>{asset.name}</span>
                {asset.tags.length > 0 && (
                    <span className="ml-auto shrink-0 text-2xs text-fg-subtle">{tn("assets.iconView.tagCount", asset.tags.length)}</span>
                )}
            </div>
        </div>
    );
}
