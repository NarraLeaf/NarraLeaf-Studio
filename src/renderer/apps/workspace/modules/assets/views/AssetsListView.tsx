import { useMemo, useCallback, useState, Dispatch, SetStateAction, DragEvent } from "react";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Upload, Link, FolderPlus, Layers, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ASSET_CATEGORY_ORDER, AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup, AssetSource } from "@/lib/workspace/services/assets/types";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { useSetSummary } from "../components/AssetSetRow";
import { formatAssetSetCoordinateReading, readAssetSetCoordinate } from "@shared/types/assetSetLabels";
import type { AssetSetCell } from "@shared/types/assetSet";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { AssetSupportBadge } from "../components/AssetSupportBadge";
import { ASSET_CATEGORY_ICONS, ASSET_TYPE_ICONS } from "../constants";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";

interface AssetsListViewProps {
    dropTargetId: string | null;
    handleRootDrop: (event: DragEvent, category: AssetCategory, contextualGroup?: AssetGroup | null) => Promise<void>;
    handleImport: (category: AssetCategory) => void;
    handleImportRemote: (category: AssetCategory) => void;
    handleCreateGroup: (category: AssetCategory) => void;
    actionLoading: boolean;
    setDropTargetId: Dispatch<SetStateAction<string | null>>;
    openItems: string[];
    onOpenChange: (openItems: string[]) => void;
    disableAnimation: boolean;
}

export function AssetsListView({
    dropTargetId,
    handleRootDrop,
    handleImport,
    handleImportRemote,
    handleCreateGroup,
    actionLoading,
    setDropTargetId,
    openItems,
    onOpenChange,
    disableAnimation,
}: AssetsListViewProps) {
    const { t, tn } = useTranslation();
    const freeze = useFreezeGuard();
    const {
        filteredAssets,
        filteredGroups,
        rootAssetSets,
        memberAssetIds,
        draggedItem,
        showContextMenu,
    } = useAssetsPanelContext();

    const hasAnyItems = useMemo(() => Object.values(filteredAssets).some(list => list.length > 0) || Object.values(filteredGroups).some(list => list.length > 0), [filteredAssets, filteredGroups]);

    return (
        <Accordion openItems={openItems} onOpenChange={onOpenChange} multiple disableAnimation={disableAnimation}>
            {ASSET_CATEGORY_ORDER.map((category) => {
                const CategoryIcon = ASSET_CATEGORY_ICONS[category];
                const categoryAssets = filteredAssets[category];
                const categoryGroups = filteredGroups[category];
                const categorySets = rootAssetSets[category];

                return (
                    <AccordionItem
                        key={category}
                        id={category}
                        icon={<CategoryIcon className="w-4 h-4" />}
                        headerProps={{
                            // The section's handle: verification and any future command that has to
                            // find a category on screen reads this rather than matching its label,
                            // which is translated.
                            "data-asset-category": category,
                            // The header had no menu at all. It is the section's own row, so it is
                            // where a command about the section as a whole belongs — today, Other's
                            // "New Text File". The body below still swallows contextmenu.
                            onContextMenu: (event) => showContextMenu(event, category, null, false),
                        }}
                        title={
                            <span className="flex items-center gap-1.5">
                                <span>{t(`assets.categories.${category}`)}</span>
                                <span className="text-xs text-fg-subtle">{tn("assets.itemCount", categoryAssets.length)}</span>
                            </span>
                        }
                        actions={
                            actionLoading ? (
                                <RefreshCw className="w-3 h-3 animate-spin text-fg" />
                            ) : (
                                <>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleImport(category);
                                        }}
                                        className="p-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                        {...freeze.writes(false, t("common.import"))}
                                    >
                                        <Upload className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleImportRemote(category);
                                        }}
                                        className="p-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                        {...freeze.writes(false, t("assets.importRemote"))}
                                    >
                                        <Link className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCreateGroup(category);
                                        }}
                                        className="p-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                        {...freeze.writes(false, t("assets.menu.newGroup"))}
                                    >
                                        <FolderPlus className="w-3 h-3" />
                                    </button>
                                </>
                            )
                        }
                    >
                        <div
                            className={`${dropTargetId === `root:${category}` ? 'bg-primary/10' : ''}`}
                            onDrop={(e) => handleRootDrop(e, category)}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedItem?.category === category || e.dataTransfer.types.includes('Files')) {
                                    setDropTargetId(`root:${category}`);
                                }
                            }}
                            onDragLeave={(e) => {
                                e.stopPropagation();
                                setDropTargetId((prev) => (prev === `root:${category}` ? null : prev));
                            }}
                            onContextMenu={(e) => e.preventDefault()}
                        >
                            {/* An empty category prints nothing. The accordion header's import buttons
                                are the way in; announcing the absence is not information. */}
                            {(categoryAssets.length > 0 || categoryGroups.length > 0 || categorySets.length > 0) && (
                                <div className="py-1">
                                    {/* Above the folders: a set is what a reference points at, and the
                                        files it resolves to are filed below in the ordinary way. */}
                                    {categorySets
                                        .filter(entry => !entry.set.groupId)
                                        .map(entry => <AssetSetItem key={entry.set.id} entry={entry} />)}
                                    {categoryGroups.filter(g => !g.parentGroupId).map(group => <GroupItem key={group.id} group={group} category={category} level={0} />)}
                                    {categoryAssets
                                        .filter(a => !a.groupId && !memberAssetIds.has(a.id))
                                        .map(asset => <AssetItem key={asset.id} asset={asset} category={category} level={0} />)}
                                </div>
                            )}
                        </div>
                    </AccordionItem>
                );
            })}
            {!hasAnyItems && (
                <div className="px-3 py-4 text-center text-xs text-fg-subtle">{t("assets.list.emptyFiltered")}</div>
            )}
        </Accordion>
    );
}

/**
 * One row of the library tree.
 *
 * Folders and sets are the same row: same indent, same hover, same gesture - the whole row toggles,
 * and there is no separate disclosure control, which is what the folders have always done. Written
 * once so a set cannot drift into looking like a second kind of tree in the same panel.
 */
function TreeRow({
    level,
    icon,
    label,
    labelClassName,
    meta,
    trailing,
    dataAttributes,
    className,
    draggable,
    onClick,
    onContextMenu,
    onDragStart,
    onDragEnd,
}: {
    level: number;
    icon: React.ReactNode;
    label: string;
    labelClassName?: string;
    /** Sits with the label, in the label's own colour band: a count, a summary. */
    meta?: React.ReactNode;
    /** Sits at the far right, subdued: what this row is, rather than what it holds. */
    trailing?: string;
    dataAttributes?: Record<string, string>;
    className?: string;
    draggable?: boolean;
    onClick?: (event: React.MouseEvent) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDragStart?: (event: React.DragEvent) => void;
    onDragEnd?: () => void;
}) {
    return (
        <div
            {...dataAttributes}
            draggable={draggable}
            className={cn(
                "flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-fill",
                draggable && "nl-drag-source",
                className,
            )}
            style={{ paddingLeft: `${20 + level * 12}px` }}
            onClick={onClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
        >
            {icon}
            <span className={cn("min-w-0 truncate text-sm", labelClassName)}>{label}</span>
            {meta && <span className="shrink-0 text-xs">{meta}</span>}
            {trailing && <span className="ml-auto shrink-0 truncate text-2xs text-fg-subtle">{trailing}</span>}
        </div>
    );
}

/**
 * A set in the tree.
 *
 * The row is the folder's row - same component, same gesture, same indent - because a set is a
 * folder to whoever is browsing: it opens, it holds rows, and a sub-set nests inside it exactly as
 * a sub-folder does. What differs is only what the rows underneath are: one per value the set
 * varies by, answered either by a file or by a set one level down.
 *
 * The band of colour runs the length of the set and ends with it. A set is not a folder in the one
 * way that matters here - its members stay filed in whatever folder they were imported into and are
 * listed there too - so the band is what says these rows are one thing being shown twice.
 */
function AssetSetItem({ entry, level = 0, trailing }: {
    entry: ResolvedAssetSet;
    level?: number;
    /** What the parent set's row prints on the right for this one: the value it hangs at. */
    trailing?: string;
}) {
    const {
        assets,
        assetSets,
        assetSetNaming,
        expandedAssetSets,
        setExpandedAssetSets,
        handleAssetSetSelect,
        handleAssetClick,
        showAssetSetContextMenu,
        showAssetSetValueContextMenu,
        isMultiSelectMode,
    } = useAssetsPanelContext();
    const summary = useSetSummary(entry);

    // The whole library of that section, not the filtered list: a set's rows are its own, and one of
    // them turning into "no file" because a search is narrowing the panel would read as a hole in the
    // project.
    const assetsById = useMemo(
        () => new Map(assets[entry.category].map(asset => [asset.id, asset])),
        [assets, entry.category],
    );
    const setsById = useMemo(
        () => new Map(assetSets[entry.category].map(resolved => [resolved.set.id, resolved])),
        [assetSets, entry.category],
    );

    const open = expandedAssetSets.has(entry.set.id);
    const toggle = useCallback(() => {
        setExpandedAssetSets(current => {
            const next = new Set(current);
            if (next.has(entry.set.id)) {
                next.delete(entry.set.id);
            } else {
                next.add(entry.set.id);
            }
            return next;
        });
    }, [entry.set.id, setExpandedAssetSets]);

    return (
        <div className={cn(level === 0 && "bg-fill-subtle/50", level === 0 && open && "border-y border-edge-subtle")}>
            <TreeRow
                level={level}
                icon={<Layers className={cn("w-4 h-4 shrink-0", entry.incomplete ? "text-warning" : "text-primary")} />}
                label={entry.set.name}
                meta={<span className={entry.incomplete ? "text-warning" : "text-fg-subtle"}>{summary}</span>}
                trailing={trailing}
                dataAttributes={{ "data-asset-set-id": entry.set.id }}
                onClick={() => {
                    // A set is not part of the library's multi-selection: nothing that acts on marked
                    // rows (copy, export, delete bytes) means anything for a set.
                    handleAssetSetSelect(entry);
                    toggle();
                }}
                onContextMenu={event => showAssetSetContextMenu(event, entry)}
            />
            {open && entry.contents.cells.map(cell => {
                const coordinate = formatAssetSetCoordinateReading(
                    readAssetSetCoordinate(entry.set, cell.coordinate, assetSetNaming),
                );
                const child = cell.childSetIds.length === 1 ? setsById.get(cell.childSetIds[0]) : undefined;
                if (child) {
                    return <AssetSetItem key={cell.label} entry={child} level={level + 1} trailing={coordinate} />;
                }
                const asset = cell.assetIds.length === 1 ? assetsById.get(cell.assetIds[0]) : undefined;
                return (
                    <AssetSetMemberRow
                        key={cell.label}
                        cell={cell}
                        level={level + 1}
                        coordinate={coordinate}
                        asset={asset ?? null}
                        onOpen={() => { if (asset) handleAssetClick(asset, isMultiSelectMode); }}
                        onContextMenu={event => showAssetSetValueContextMenu(event, entry, cell.value)}
                    />
                );
            })}
        </div>
    );
}

function MemberIcon({ asset }: { asset: Asset }) {
    const Icon = ASSET_TYPE_ICONS[asset.type];
    return <Icon className="w-4 h-4 shrink-0 text-fg-muted" />;
}

/**
 * One value of a set, answered by a file.
 *
 * A value with no file keeps its row: the value is the reason the row exists, and dropping it would
 * leave a set that is missing something looking complete.
 */
function AssetSetMemberRow({ cell, level, coordinate, asset, onOpen, onContextMenu }: {
    cell: AssetSetCell;
    level: number;
    coordinate: string;
    asset: Asset | null;
    onOpen: () => void;
    onContextMenu: (event: React.MouseEvent) => void;
}) {
    const { t } = useTranslation();
    return (
        <TreeRow
            level={level}
            // The ordinary file mark, because a member is an ordinary file: it is filed in a folder
            // as well, and a mark of its own here would make the same file look like two things.
            icon={asset
                ? <MemberIcon asset={asset} />
                : <span className="h-4 w-4 shrink-0" />}
            label={asset
                ? asset.name
                : cell.assetIds.length > 1
                    ? t("assets.sets.inspector.variantAmbiguous", { count: String(cell.assetIds.length) })
                    : t("assets.sets.inspector.variantMissing")}
            labelClassName={asset ? undefined : "text-warning"}
            trailing={coordinate}
            dataAttributes={{ "data-asset-set-member": cell.label }}
            onClick={onOpen}
            onContextMenu={onContextMenu}
        />
    );
}

function GroupItem({ group, category, level }: { group: AssetGroup; category: AssetCategory; level: number }) {
    const freeze = useFreezeGuard();
    const {
        filteredGroups,
        filteredAssets,
        selectedItems,
        draggedItem,
        clipboard,
        expandedGroups,
        setExpandedGroups,
        rootAssetSets,
        memberAssetIds,
        handleItemSelect,
        handleGroupFocus,
        showContextMenu,
        handleDragStart,
        handleDragEnd,
        handleDropOnItem,
        handleImportToGroup,
        isFocused,
        isNarrowed,
    } = useAssetsPanelContext();
    const [isDragOverLocal, setDragOverLocal] = useState(false);

    // Groups default to collapsed, so a search that left them collapsed would return hits nobody can
    // see. While something is narrowing the library, every surviving group is open.
    const isOpen = isNarrowed || expandedGroups.has(group.id);
    const toggleOpen = useCallback(() => {
        setExpandedGroups((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(group.id)) {
                newSet.delete(group.id);
            } else {
                newSet.add(group.id);
            }
            return newSet;
        });
    }, [group.id, setExpandedGroups]);

    const childGroups = filteredGroups[category].filter(g => g.parentGroupId === group.id);
    const groupAssets = filteredAssets[category]
        .filter(a => a.groupId === group.id && !memberAssetIds.has(a.id));
    const isDragging = !!draggedItem && draggedItem.isGroup && draggedItem.item.id === group.id;
    const isSelected = selectedItems.has(`group:${group.id}`);
    const isCut = clipboard?.type === 'cut' && clipboard.groups.some(g => g.id === group.id);

    return (
        <div
            className={`${isDragOverLocal ? 'bg-primary/20' : ''}`}
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
            <TreeRow
                level={level}
                draggable
                dataAttributes={{ "data-asset-group-id": group.id }}
                className={cn(
                    isSelected && "bg-primary/20 border-l-2 border-primary",
                    isFocused(`group:${group.id}`) && "bg-fill-subtle",
                    isDragging && "opacity-50",
                    isCut && "opacity-40",
                )}
                icon={<FolderPlus className="w-4 h-4 shrink-0 text-primary" />}
                label={group.name}
                meta={<span className="text-fg-subtle">({groupAssets.length + childGroups.length})</span>}
                onClick={(e) => {
                    handleItemSelect(group.id, true, e);
                    handleGroupFocus(group.id);
                    toggleOpen();
                }}
                onContextMenu={(e) => showContextMenu(e, category, group, true)}
                onDragStart={(e) => handleDragStart?.(e, category, group, true)}
                onDragEnd={() => handleDragEnd?.()}
            />

            {isOpen && (
                <div>
                    {/* Above the sub-folders, the way a set sits above the folders at a section's
                        root: it is the entry a reference points at, and the files it resolves to are
                        filed below it in the ordinary way. */}
                    {rootAssetSets[category]
                        .filter(entry => entry.set.groupId === group.id)
                        .map(entry => <AssetSetItem key={entry.set.id} entry={entry} level={level + 1} />)}
                    {childGroups.map(child => <GroupItem key={child.id} group={child} category={category} level={level + 1} />)}
                    {groupAssets.map(asset => <AssetItem key={asset.id} asset={asset} category={category} level={level + 1} />)}
                </div>
            )}
        </div>
    );
}

function AssetItem({ asset, category, level }: { asset: Asset; category: AssetCategory; level: number }) {
    const { selectedItems, clipboard, draggedItem, handleItemSelect, handleAssetClick, showContextMenu, handleDragStart, handleDragEnd, isFocused, isMultiSelectMode, mediaSupport, handleConvertMedia } = useAssetsPanelContext();
    const Icon = ASSET_TYPE_ICONS[asset.type];
    const isSelected = selectedItems.has(`asset:${asset.id}`);
    const isDragging = !!draggedItem && !draggedItem.isGroup && draggedItem.item.id === asset.id;
    const support = mediaSupport.get(asset.id);

    return (
        <div
            draggable
            className={`nl-drag-source flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-fill ${isSelected ? 'bg-primary/20 border-l-2 border-primary' : ''} ${isFocused(`asset:${asset.id}`) ? 'bg-fill-subtle' : ''} ${clipboard?.type === 'cut' && clipboard.assets.some(a => a.id === asset.id) ? 'opacity-40' : ''} ${isDragging ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${20 + level * 12}px` }}
            onClick={(e) => {
                handleItemSelect(asset.id, false, e);
                handleAssetClick(asset, isMultiSelectMode);
            }}
            onContextMenu={(e) => showContextMenu(e, category, asset, false)}
            onDragStart={(e) => handleDragStart?.(e, category, asset, false)}
            onDragEnd={() => handleDragEnd?.()}
        >
            <Icon className="w-4 h-4 text-fg-muted" />
            <span className="text-sm flex-1 truncate">{asset.name}</span>
            {support && (
                <AssetSupportBadge
                    record={support}
                    onConvert={asset.source === AssetSource.Local ? () => handleConvertMedia(asset) : undefined}
                />
            )}
            {asset.tags.length > 0 && <span className="text-xs text-fg-subtle">+{asset.tags.length}</span>}
        </div>
    );
}
