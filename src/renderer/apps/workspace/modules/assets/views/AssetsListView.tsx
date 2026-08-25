import { useMemo, useCallback, useEffect, useLayoutEffect, useRef, useState, Dispatch, SetStateAction, DragEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Upload, Link, FolderPlus, Layers, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ASSET_CATEGORY_ORDER, AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup, AssetSource } from "@/lib/workspace/services/assets/types";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { ASSET_SET_REVEAL_RING, useAssetSetRevealMark, useSetSummary } from "../components/AssetSetRow";
import { formatAssetSetCoordinateReading, readAssetSetCoordinate } from "@shared/types/assetSetLabels";
import type { AssetSetCell } from "@shared/types/assetSet";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import {
    assetSetsFiledIn,
    assetsFiledIn,
    groupsFiledIn,
    listViewCategoryRows,
    type ListViewRow,
    type ListViewRowOrderInput,
} from "../state/assetRowOrder";
import { AssetSupportBadge } from "../components/AssetSupportBadge";
import { ASSET_CATEGORY_ICONS, ASSET_TYPE_ICONS } from "../constants";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { AssetClaimMark } from "../assetLiveSession";

/** One row of the tree, already flattened. Only the section it belongs to varies. */
type TreeListRow = ListViewRow<ResolvedAssetSet>;

/**
 * A row's resting height: `py-1.5` above and below a 20px line of `text-sm`.
 *
 * The first frame and the scrollbar are all that depend on it - every mounted row measures itself,
 * so a row a support badge makes taller settles on its own.
 */
const TREE_ROW_HEIGHT_PX = 32;

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
    /** The panel's scroller. Each section windows its rows against it. */
    scrollElement: HTMLElement | null;
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
    scrollElement,
}: AssetsListViewProps) {
    const { t, tn } = useTranslation();
    const freeze = useFreezeGuard();
    const {
        filteredAssets,
        filteredGroups,
        assetSets,
        rootAssetSets,
        memberAssetIds,
        expandedGroups,
        expandedAssetSets,
        isNarrowed,
        draggedItem,
        draggedAssetSet,
        showContextMenu,
        publishRowOrder,
    } = useAssetsPanelContext();

    const hasAnyItems = useMemo(() => Object.values(filteredAssets).some(list => list.length > 0) || Object.values(filteredGroups).some(list => list.length > 0), [filteredAssets, filteredGroups]);

    /**
     * Every section's rows, flattened.
     *
     * The tree is windowed, so a section is an index into an array rather than a nest of components:
     * a library of a couple of thousand files used to put every one of them in the DOM, and that is
     * the size a project reaches long before anyone suspects the panel is the slow part.
     *
     * A closed section keeps its rows even though it mounts none of them. What it draws instead is a
     * spacer of their resting height, because the accordion animates a section shut by reading the
     * height of what is inside it - and a body that empties in the same commit as the toggle has no
     * height to shrink from, so the section would vanish rather than close.
     */
    const rowsByCategory = useMemo(() => {
        const input: ListViewRowOrderInput<ResolvedAssetSet> = {
            assets: filteredAssets,
            groups: filteredGroups,
            rootAssetSets,
            assetSets,
            memberAssetIds,
            expandedGroups,
            expandedAssetSets,
            isNarrowed,
        };
        const out = {} as Record<AssetCategory, TreeListRow[]>;
        for (const category of ASSET_CATEGORY_ORDER) {
            out[category] = listViewCategoryRows(category, input);
        }
        return out;
    }, [
        filteredAssets, filteredGroups, rootAssetSets, assetSets,
        memberAssetIds, expandedGroups, expandedAssetSets, isNarrowed,
    ]);

    // What a shift range covers: the keys of the rows above, in the order they are drawn. One walk
    // feeds both the markup and the range now, so the two cannot disagree about what is on screen.
    const rowOrder = useMemo(() => {
        const keys: string[] = [];
        for (const category of ASSET_CATEGORY_ORDER) {
            // A closed section draws nothing, so nothing in it can be caught in a range.
            if (!openItems.includes(category)) {
                continue;
            }
            for (const row of rowsByCategory[category]) {
                if (row.selectionKey) {
                    keys.push(row.selectionKey);
                }
            }
        }
        return keys;
    }, [openItems, rowsByCategory]);
    useLayoutEffect(() => {
        publishRowOrder(rowOrder);
        // Cleared on the way out: the grid and the overview draw something else entirely, and a
        // range must never be sliced out of a list of rows that are no longer on screen.
        return () => publishRowOrder([]);
    }, [publishRowOrder, rowOrder]);

    return (
        <Accordion openItems={openItems} onOpenChange={onOpenChange} multiple disableAnimation={disableAnimation}>
            {ASSET_CATEGORY_ORDER.map((category) => {
                const CategoryIcon = ASSET_CATEGORY_ICONS[category];
                const categoryAssets = filteredAssets[category];
                const rows = rowsByCategory[category];

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
                                if (draggedItem?.category === category
                                    || draggedAssetSet?.category === category
                                    || e.dataTransfer.types.includes('Files')) {
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
                            {rows.length > 0 && (openItems.includes(category) ? (
                                <CategoryRows category={category} rows={rows} scrollElement={scrollElement} />
                            ) : (
                                <div className="py-1" style={{ height: rows.length * TREE_ROW_HEIGHT_PX }} />
                            ))}
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
 * One section's rows, windowed against the panel's scroller.
 *
 * A virtualiser per section rather than one across the whole tree, so the accordion keeps its
 * headers, its open/close animation and its keyboard handling exactly as they were. `scrollMargin`
 * is what makes each agree with the rest of the column: other sections sit above and below this one
 * inside the same scroller, so the virtualiser has to be told where its own list starts. The offsets
 * it hands back are measured from the top of the scroller and the margin comes straight back off
 * them, which is why a margin one commit stale moves nothing on screen - it can only window the
 * wrong slice for a frame, and every commit re-measures.
 */
function CategoryRows({ category, rows, scrollElement }: {
    category: AssetCategory;
    rows: TreeListRow[];
    scrollElement: HTMLElement | null;
}) {
    const freeze = useFreezeGuard();
    const {
        draggedItem,
        draggedAssetSet,
        filteredGroups,
        expandedAssetSets,
        assetSetReveal,
        handleDropOnItem,
        handleImportToGroup,
    } = useAssetsPanelContext();
    const listRef = useRef<HTMLDivElement | null>(null);
    const [listMargin, setListMargin] = useState(0);
    /**
     * The folder the pointer is over, if any.
     *
     * Held for the whole section rather than by each folder's own wrapper, because a folder no
     * longer wraps its contents: two adjacent rows of one folder would otherwise trade `dragleave`
     * and `dragover` on every pointer move, and the tint would strobe.
     */
    const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollElement,
        estimateSize: () => TREE_ROW_HEIGHT_PX,
        overscan: 12,
        scrollMargin: listMargin,
        getItemKey: index => rows[index]?.key ?? index,
    });

    // The section's start offset moves whenever anything above it does: another section opening, the
    // import strip appearing. Measured after every commit rather than once, the same way the story
    // editor's row list does it.
    useLayoutEffect(() => {
        const list = listRef.current;
        const scroller = scrollElement;
        if (!list || !scroller) {
            return;
        }
        const margin = list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        setListMargin(previous => (Math.abs(previous - margin) > 0.5 ? margin : previous));
    });

    /**
     * Put a jumped-to set on screen even when its row is not mounted.
     *
     * The row marks itself once it exists (see `useAssetSetRevealMark`), but a windowed list may
     * have nothing to scroll to: there is no node until it has been scrolled to.
     */
    const revealNonce = assetSetReveal?.nonce ?? null;
    const revealSetId = assetSetReveal?.setId ?? null;
    useEffect(() => {
        if (revealNonce === null || !revealSetId) {
            return;
        }
        const index = rows.findIndex(row => row.kind === "set" && row.entry.set.id === revealSetId);
        if (index >= 0) {
            virtualizer.scrollToIndex(index, { align: "center" });
        }
        // The request is the event; the rows are read from the render it landed in.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealNonce]);

    /** The folder a pointer event landed in, read off the row wrapper the virtualiser already indexes. */
    const groupUnder = useCallback((event: DragEvent): AssetGroup | null => {
        const host = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-index]");
        const index = host ? Number(host.dataset.index) : Number.NaN;
        const row = Number.isFinite(index) ? rows[index] : undefined;
        const groupId = row?.groupPath[row.groupPath.length - 1];
        if (!groupId) {
            return null;
        }
        return filteredGroups[category].find(group => group.id === groupId) ?? null;
    }, [category, filteredGroups, rows]);

    return (
        <div className="py-1">
            <div
                ref={listRef}
                className="relative w-full"
                style={{ height: virtualizer.getTotalSize() }}
                onDragOver={(event) => {
                    const group = groupUnder(event);
                    if (!group) {
                        // Nothing encloses this row, so the section's own root is the drop target and
                        // this event belongs to it. Clearing here is what a folder's own wrapper used
                        // to get for free by no longer being under the pointer.
                        setDragOverGroupId(null);
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    const files = event.dataTransfer.types.includes("Files");
                    const internal = (draggedItem && draggedItem.category === category)
                        || (draggedAssetSet && draggedAssetSet.category === category);
                    // A frozen library never lights up as a drop target: the move and the import are
                    // both refused, and a folder that glows and then keeps its old contents reads as
                    // a bug.
                    if (freeze.frozen || (!internal && !files)) {
                        setDragOverGroupId(null);
                        return;
                    }
                    setDragOverGroupId(group.id);
                    event.dataTransfer.dropEffect = internal ? "move" : "copy";
                }}
                onDragLeave={(event) => {
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        return;
                    }
                    setDragOverGroupId(null);
                }}
                onDrop={(event) => {
                    const group = groupUnder(event);
                    if (!group) {
                        setDragOverGroupId(null);
                        return;
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    setDragOverGroupId(null);
                    if ((draggedItem || draggedAssetSet) && handleDropOnItem) {
                        handleDropOnItem(event, category, group);
                    } else {
                        handleImportToGroup(category, group.id, event.dataTransfer.files, event.dataTransfer);
                    }
                }}
            >
                {virtualizer.getVirtualItems().map(item => {
                    const row = rows[item.index];
                    if (!row) {
                        return null;
                    }
                    const bandOpen = row.band ? expandedAssetSets.has(row.band.setId) : false;
                    return (
                        <div
                            key={item.key}
                            ref={virtualizer.measureElement}
                            data-index={item.index}
                            className={cn(
                                "absolute left-0 top-0 w-full",
                                // The band runs the length of a top-level set and ends with it: the
                                // set's members stay filed in whatever folder they were imported
                                // into and are listed there too, so the tint is what says these rows
                                // are one thing being shown twice.
                                row.band && "bg-fill-subtle/50",
                                row.band?.first && bandOpen && "border-t border-edge-subtle",
                                row.band?.last && bandOpen && "border-b border-edge-subtle",
                                dragOverGroupId && row.groupPath.includes(dragOverGroupId) && "bg-primary/20",
                            )}
                            style={{ transform: `translateY(${item.start - listMargin}px)` }}
                        >
                            {row.kind === "set" ? (
                                <AssetSetItem row={row} />
                            ) : row.kind === "setValue" ? (
                                <AssetSetValueItem row={row} />
                            ) : row.kind === "group" ? (
                                <GroupItem row={row} />
                            ) : (
                                <AssetItem asset={row.asset} category={row.category} level={row.level} />
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
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
    rowRef,
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
    /** For a caller that has to bring this row on screen. Nothing else reaches into the row. */
    rowRef?: React.Ref<HTMLDivElement>;
    onClick?: (event: React.MouseEvent) => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDragStart?: (event: React.DragEvent) => void;
    onDragEnd?: () => void;
}) {
    return (
        <div
            ref={rowRef}
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
 * a sub-folder does. What differs is only what the rows underneath are: one per value the set varies
 * by, answered either by a file or by a set one level down. Those rows are the flattened list's own,
 * drawn after this one, and the tint that ties them together travels with each of them.
 */
function AssetSetItem({ row }: { row: Extract<TreeListRow, { kind: "set" }> }) {
    const {
        assetSetNaming,
        setExpandedAssetSets,
        draggedAssetSet,
        handleAssetSetSelect,
        handleAssetSetDragStart,
        handleDragEnd,
        showAssetSetContextMenu,
    } = useAssetsPanelContext();
    const entry = row.entry;
    const summary = useSetSummary(entry);
    const reveal = useAssetSetRevealMark(entry.set.id);
    // What the parent set's row prints on the right for this one: the value it hangs at.
    const trailing = row.parent
        ? formatAssetSetCoordinateReading(
            readAssetSetCoordinate(row.parent.entry.set, row.parent.cell.coordinate, assetSetNaming),
        )
        : undefined;

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
        <TreeRow
            level={row.level}
            // A nested set does not move on its own - where it is drawn follows the set it hangs
            // under, so dragging it somewhere would change nothing the author can see.
            draggable={!row.nested}
            rowRef={reveal.ref}
            icon={<Layers className={cn("w-4 h-4 shrink-0", entry.incomplete ? "text-warning" : "text-primary")} />}
            label={entry.set.name}
            meta={<span className={entry.incomplete ? "text-warning" : "text-fg-subtle"}>{summary}</span>}
            {...(trailing ? { trailing } : {})}
            dataAttributes={{ "data-asset-set-id": entry.set.id }}
            className={cn(
                draggedAssetSet?.setId === entry.set.id && "opacity-50",
                reveal.marked && ASSET_SET_REVEAL_RING,
            )}
            onClick={() => {
                // A set is not part of the library's multi-selection: nothing that acts on marked
                // rows (copy, export, delete bytes) means anything for a set.
                handleAssetSetSelect(entry);
                toggle();
            }}
            onContextMenu={event => showAssetSetContextMenu(event, entry)}
            {...(row.nested
                ? {}
                : {
                    onDragStart: (event: React.DragEvent) => handleAssetSetDragStart?.(event, entry.category, entry.set.id),
                    onDragEnd: () => handleDragEnd?.(),
                })}
        />
    );
}

/**
 * One value of a set.
 *
 * A value exactly one file answers is that file's ordinary row, marks and menu included: the only
 * thing being inside a set changes is that the file cannot be dragged out of one - a member is named
 * by its tags, and dropping it in a folder would move a row the set would go on drawing where it
 * was. Anything else is the hole the value is.
 */
function AssetSetValueItem({ row }: { row: Extract<TreeListRow, { kind: "setValue" }> }) {
    const { assets, assetSetNaming, showAssetSetValueContextMenu } = useAssetsPanelContext();
    const entry = row.entry;
    const coordinate = formatAssetSetCoordinateReading(
        readAssetSetCoordinate(entry.set, row.cell.coordinate, assetSetNaming),
    );
    // The whole library of that section, not the filtered list: a set's rows are its own, and one of
    // them turning into "no file" because a search is narrowing the panel would read as a hole in the
    // project.
    const asset = row.assetId
        ? assets[entry.category].find(candidate => candidate.id === row.assetId)
        : undefined;

    if (asset) {
        return (
            <AssetItem
                asset={asset}
                category={entry.category}
                level={row.level}
                trailing={coordinate}
                assetSetValue={{ setId: entry.set.id, value: row.cell.value }}
            />
        );
    }
    return (
        <AssetSetMemberRow
            cell={row.cell}
            level={row.level}
            coordinate={coordinate}
            onContextMenu={event => showAssetSetValueContextMenu(event, entry, row.cell.value)}
        />
    );
}

/**
 * One value of a set the library has no single file for.
 *
 * Drawn rather than skipped: the value is the reason the row exists, and dropping it would leave a
 * set that is missing something looking complete. A value a file does answer is drawn as that file's
 * own row instead.
 */
function AssetSetMemberRow({ cell, level, coordinate, onContextMenu }: {
    cell: AssetSetCell;
    level: number;
    coordinate: string;
    onContextMenu: (event: React.MouseEvent) => void;
}) {
    const { t } = useTranslation();
    return (
        <TreeRow
            level={level}
            icon={<span className="h-4 w-4 shrink-0" />}
            label={cell.assetIds.length > 1
                ? t("assets.sets.inspector.variantAmbiguous", { count: String(cell.assetIds.length) })
                : t("assets.sets.inspector.variantMissing")}
            labelClassName="text-warning"
            trailing={coordinate}
            dataAttributes={{ "data-asset-set-member": cell.label }}
            onContextMenu={onContextMenu}
        />
    );
}

function GroupItem({ row }: { row: Extract<TreeListRow, { kind: "group" }> }) {
    const {
        filteredGroups,
        filteredAssets,
        selectedItems,
        draggedItem,
        clipboard,
        setExpandedGroups,
        rootAssetSets,
        memberAssetIds,
        handleItemSelect,
        handleGroupFocus,
        showContextMenu,
        handleDragStart,
        handleDragEnd,
        isFocused,
    } = useAssetsPanelContext();
    const { group, category } = row;

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

    // Counted with the same three functions the flattened order walks, so the number on the folder
    // and the rows underneath it can never come from two different readings of what it holds.
    const childGroups = groupsFiledIn(filteredGroups[category], group.id);
    const groupAssets = assetsFiledIn(filteredAssets[category], group.id, memberAssetIds);
    // Sets made in this folder are rows in it, so they are part of what it holds. The files they
    // answer with are not counted twice: those are drawn inside the set and dropped from the list
    // above by the same rule.
    const groupSets = assetSetsFiledIn(rootAssetSets[category], group.id);
    const isDragging = !!draggedItem && draggedItem.isGroup && draggedItem.item.id === group.id;
    const isSelected = selectedItems.has(`group:${group.id}`);
    const isCut = clipboard?.type === 'cut' && clipboard.groups.some(g => g.id === group.id);

    return (
        <TreeRow
            level={row.level}
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
            meta={<span className="text-fg-subtle">({groupAssets.length + childGroups.length + groupSets.length})</span>}
            onClick={(e) => {
                handleItemSelect(group.id, true, e);
                handleGroupFocus(group.id);
                toggleOpen();
            }}
            onContextMenu={(e) => showContextMenu(e, category, group, true)}
            onDragStart={(e) => handleDragStart?.(e, category, group, true)}
            onDragEnd={() => handleDragEnd?.()}
        />
    );
}

/**
 * One file in the tree.
 *
 * The same row wherever the file is drawn, a folder or a set: clicking it marks it, opens it, and
 * puts it in the properties panel, and the marks it carries are the library's own. `assetSetValue`
 * is the one difference a set makes - the file is named by its tags there, so it stays where the set
 * draws it and only the sub-set command is added to its menu.
 */
function AssetItem({ asset, category, level, trailing, assetSetValue }: {
    asset: Asset;
    category: AssetCategory;
    level: number;
    /** What this file is the variant for, when it is drawn inside a set. */
    trailing?: string;
    /** The set value this row answers, when it is drawn inside a set. */
    assetSetValue?: { setId: string; value: string };
}) {
    const { selectedItems, clipboard, draggedItem, handleItemSelect, handleAssetClick, showContextMenu, handleDragStart, handleDragEnd, isFocused, isMultiSelectMode, mediaSupport, handleConvertMedia, assetClaims } = useAssetsPanelContext();
    const Icon = ASSET_TYPE_ICONS[asset.type];
    const isSelected = selectedItems.has(`asset:${asset.id}`);
    const isDragging = !!draggedItem && !draggedItem.isGroup && draggedItem.item.id === asset.id;
    const support = mediaSupport.get(asset.id);
    // Who else has this record open in a live session, or null. Read from one subscription for the
    // whole panel; outside a session it is always null and costs a lookup.
    const claimedBy = assetClaims[asset.id] ?? null;
    // Inside a set, the row does not leave: which set a file belongs to is written in its tags, so a
    // drop somewhere else would move a row the set goes on drawing exactly where it was.
    const movable = !assetSetValue;

    return (
        <div
            draggable={movable}
            className={cn(
                "flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-fill",
                movable && "nl-drag-source",
                isSelected && "bg-primary/20 border-l-2 border-primary",
                isFocused(`asset:${asset.id}`) && "bg-fill-subtle",
                clipboard?.type === "cut" && clipboard.assets.some(a => a.id === asset.id) && "opacity-40",
                isDragging && "opacity-50",
            )}
            style={{ paddingLeft: `${20 + level * 12}px` }}
            onClick={(e) => {
                handleItemSelect(asset.id, false, e);
                handleAssetClick(asset, isMultiSelectMode);
            }}
            onContextMenu={(e) => showContextMenu(e, category, asset, false, assetSetValue)}
            onDragStart={movable ? (e) => handleDragStart?.(e, category, asset, false) : undefined}
            onDragEnd={movable ? () => handleDragEnd?.() : undefined}
        >
            <Icon className="w-4 h-4 text-fg-muted" />
            <span className="text-sm flex-1 truncate">{asset.name}</span>
            {claimedBy && <AssetClaimMark account={claimedBy} />}
            {support && (
                <AssetSupportBadge
                    record={support}
                    onConvert={asset.source === AssetSource.Local ? () => handleConvertMedia(asset) : undefined}
                />
            )}
            {trailing
                ? <span className="shrink-0 truncate text-2xs text-fg-subtle">{trailing}</span>
                : asset.tags.length > 0 && <span className="text-xs text-fg-subtle">+{asset.tags.length}</span>}
        </div>
    );
}
