import { useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronUp, Folder, Layers } from "lucide-react";
import { AssetType, type AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type AssetGroup } from "@/lib/workspace/services/assets/types";
import { readAssetTags } from "@shared/types/assetSetLabels";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { AssetThumbnail } from "../components/AssetThumbnail";
import { AssetSupportBadge } from "../components/AssetSupportBadge";
import { ASSET_SET_REVEAL_RING, useAssetSetRevealMark, useSetSummary } from "../components/AssetSetRow";
import { AssetClaimMark, AssetTransferSweep } from "../assetLiveSession";
import { ASSET_TYPE_ICONS } from "../constants";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { formatByteSize } from "../../asset-overview/assetOverviewModel";
import {
    assetBrowserItemBytes,
    assetBrowserItemFormat,
    assetBrowserItemName,
    assetBrowserItemUsage,
    groupPath,
    type AssetBrowserItem,
    type AssetBrowserMeasures,
    type AssetBrowserSort,
    type AssetBrowserSortKey,
} from "./assetBrowserModel";
import { useBrowserDropTarget, useBrowserItemGestures } from "./useBrowserItemGestures";

/** One row of the table. Fixed, so the windowing needs no measuring. */
const ROW_HEIGHT_PX = 28;

/**
 * The columns, in the widths a short, wide tray can afford. The name takes what is left; the numbers
 * are as wide as their longest value, right-aligned so they compare down the column.
 */
const COLUMNS = "minmax(12rem,1fr) 4.5rem 5rem 4.5rem minmax(6rem,0.6fr)";
const COLUMNS_WITH_LOCATION = `${COLUMNS} minmax(8rem,0.8fr)`;

export interface BrowserDetailsProps {
    items: readonly AssetBrowserItem[];
    measures: AssetBrowserMeasures;
    sort: AssetBrowserSort;
    onSortChange: (key: AssetBrowserSortKey) => void;
    /** Results come from the whole library, so they say where each one is filed. */
    showLocation: boolean;
    insideSet: ResolvedAssetSet | null;
    onEnterGroup: (category: AssetCategory, group: AssetGroup) => void;
    onEnterSet: (entry: ResolvedAssetSet) => void;
    onDropOnGroup: (event: React.DragEvent, kind: "move" | "files", category: AssetCategory, group: AssetGroup) => void;
}

/**
 * The contents of one place as a table: the same items as the grid, with what each one is spelled
 * out in columns - its format, how much room it takes, how many places use it, and its tags.
 *
 * A header press sorts by that column; the third press goes back to the library's own order.
 */
export function BrowserDetails({
    items,
    measures,
    sort,
    onSortChange,
    showLocation,
    insideSet,
    onEnterGroup,
    onEnterSet,
    onDropOnGroup,
}: BrowserDetailsProps) {
    const { t } = useTranslation();
    const gestures = useBrowserItemGestures({ insideSet, onEnterGroup, onEnterSet });
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const columns = showLocation ? COLUMNS_WITH_LOCATION : COLUMNS;

    const virtualizer = useVirtualizer({
        count: items.length,
        getScrollElement: () => scrollElement,
        estimateSize: () => ROW_HEIGHT_PX,
        overscan: 8,
    });

    const headers: Array<{ key: AssetBrowserSortKey | null; label: string; numeric?: boolean }> = [
        { key: "name", label: t("common.name") },
        { key: "format", label: t("assets.filter.format") },
        { key: "size", label: t("assets.filter.size"), numeric: true },
        { key: "usage", label: t("assets.filter.usage"), numeric: true },
        { key: null, label: t("assets.filter.tags") },
        ...(showLocation ? [{ key: null, label: t("assets.browser.location") }] : []),
    ];

    return (
        <div ref={setScrollElement} className="h-full overflow-auto">
            <div
                role="row"
                className="sticky top-0 z-10 grid h-7 items-center border-b border-edge bg-surface-sunken text-2xs text-fg-muted"
                style={{ gridTemplateColumns: columns }}
            >
                {headers.map(header => {
                    const active = header.key !== null && sort?.key === header.key;
                    const content = (
                        <>
                            <span className="truncate">{header.label}</span>
                            {active && (sort!.direction === "asc"
                                ? <ChevronUp className="h-3 w-3 shrink-0" />
                                : <ChevronDown className="h-3 w-3 shrink-0" />)}
                        </>
                    );
                    const cellClass = cn(
                        "flex h-full min-w-0 items-center gap-1 px-2",
                        header.numeric && "justify-end",
                        active && "text-fg",
                    );
                    return header.key ? (
                        <button
                            key={header.label}
                            type="button"
                            role="columnheader"
                            aria-sort={active ? (sort!.direction === "asc" ? "ascending" : "descending") : "none"}
                            className={cn(cellClass, "cursor-default hover:bg-fill")}
                            onClick={() => onSortChange(header.key!)}
                        >
                            {content}
                        </button>
                    ) : (
                        <div key={header.label} role="columnheader" className={cellClass}>{content}</div>
                    );
                })}
            </div>
            <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map(row => {
                    const item = items[row.index];
                    return (
                        <DetailsRow
                            key={item.key}
                            item={item}
                            top={row.start}
                            columns={columns}
                            showLocation={showLocation}
                            measures={measures}
                            gestures={gestures}
                            onDropOnGroup={onDropOnGroup}
                        />
                    );
                })}
            </div>
        </div>
    );
}

type Gestures = ReturnType<typeof useBrowserItemGestures>;

function DetailsRow({ item, top, columns, showLocation, measures, gestures, onDropOnGroup }: {
    item: AssetBrowserItem;
    top: number;
    columns: string;
    showLocation: boolean;
    measures: AssetBrowserMeasures;
    gestures: Gestures;
    onDropOnGroup: BrowserDetailsProps["onDropOnGroup"];
}) {
    const { t, tn } = useTranslation();
    const {
        selectedItems,
        clipboard,
        draggedItem,
        draggedAssetSet,
        assetSetNaming,
        groups,
        mediaSupport,
        handleConvertMedia,
        assetClaims,
        assetTransfers,
    } = useAssetsPanelContext();
    const drop = useBrowserDropTarget(
        item.kind === "group" ? item.category : null,
        (event, kind) => {
            if (item.kind === "group") {
                onDropOnGroup(event, kind, item.category, item.group);
            }
        },
    );
    // Keyed on nothing for a row that is not a set, which no jump ever asks for.
    const reveal = useAssetSetRevealMark(item.kind === "set" ? item.entry.set.id : "");

    const location = useMemo(() => {
        if (!showLocation) {
            return "";
        }
        const groupId = item.kind === "group"
            ? item.group.parentGroupId
            : item.kind === "set"
                ? item.entry.set.groupId
                : item.kind === "hole" ? undefined : item.asset.groupId;
        return [t(`assets.categories.${item.category}`), ...groupPath(groupId, groups[item.category]).map(group => group.name)]
            .join(" ▸ ");
    }, [groups, item, showLocation, t]);

    const selected = item.kind === "group"
        ? selectedItems.has("group:" + item.group.id)
        : item.kind === "asset" ? selectedItems.has("asset:" + item.asset.id) : false;
    const isCut = clipboard?.type === "cut" && (
        item.kind === "group" ? clipboard.groups.some(entry => entry.id === item.group.id)
            : item.kind === "asset" ? clipboard.assets.some(entry => entry.id === item.asset.id) : false
    );
    const isDragging = item.kind === "set"
        ? draggedAssetSet?.setId === item.entry.set.id
        : item.kind === "group" || item.kind === "asset"
            ? !!draggedItem && draggedItem.item.id === (item.kind === "group" ? item.group.id : item.asset.id)
            : false;
    const dragStart = gestures.dragStartFor(item);

    let icon: React.ReactNode;
    let name = assetBrowserItemName(item);
    let nameClassName = "";
    let trailing: React.ReactNode = null;
    switch (item.kind) {
        case "set":
            icon = <Layers className={cn("h-4 w-4 shrink-0", item.entry.incomplete ? "text-warning" : "text-primary")} />;
            trailing = item.caption
                ? <span className="shrink-0 truncate text-2xs text-fg-subtle">{item.caption}</span>
                : <SetSummary entry={item.entry} />;
            break;
        case "group":
            icon = <Folder className="h-4 w-4 shrink-0 text-primary" />;
            trailing = <span className="shrink-0 text-2xs text-fg-subtle">{tn("assets.itemCount", item.childCount)}</span>;
            break;
        case "hole":
            icon = <span className="h-4 w-4 shrink-0" />;
            nameClassName = "text-fg-muted";
            trailing = <span className="shrink-0 text-2xs text-warning">{t("assets.sets.inspector.variantMissing")}</span>;
            break;
        case "inherited":
            icon = <RowThumb item={item} />;
            name = item.caption;
            nameClassName = "italic text-fg-muted";
            trailing = (
                <span className="shrink-0 truncate text-2xs text-fg-subtle">
                    {`${item.asset.name} · ${t("assets.sets.inspector.variantInherited")}`}
                </span>
            );
            break;
        case "asset": {
            icon = <RowThumb item={item} />;
            if (item.caption) {
                name = item.caption;
                trailing = <span className="shrink-0 truncate text-2xs text-fg-subtle">{item.asset.name}</span>;
            }
            break;
        }
    }

    const asset = item.kind === "asset" ? item.asset : null;
    const support = asset ? mediaSupport.get(asset.id) : undefined;
    const claimedBy = asset ? assetClaims[asset.id] ?? null : null;
    const arriving = asset ? assetTransfers[asset.id] : undefined;
    const bytes = assetBrowserItemBytes(item, measures);
    const usage = assetBrowserItemUsage(item, measures);
    const tags = asset ? readAssetTags(asset.tags, assetSetNaming).map(entry => entry.label).join(", ") : "";

    return (
        <div
            ref={item.kind === "set" ? reveal.ref : undefined}
            role="row"
            data-asset-browser-item={item.key}
            draggable={!!dragStart}
            className={cn(
                "absolute left-0 grid w-full items-center text-xs cursor-default",
                dragStart && "nl-drag-source",
                arriving !== undefined && "isolate",
                selected ? "bg-primary/15 text-fg" : "hover:bg-fill",
                (isCut || isDragging) && "opacity-40",
                drop.over && "bg-primary/10 ring-1 ring-inset ring-primary/50",
                reveal.marked && ASSET_SET_REVEAL_RING,
            )}
            style={{ top, height: ROW_HEIGHT_PX, gridTemplateColumns: columns }}
            onClick={event => gestures.onClick(item, event)}
            onDoubleClick={() => gestures.onOpen(item)}
            onContextMenu={event => gestures.onContextMenu(item, event)}
            onDragStart={dragStart}
            onDragEnd={gestures.onDragEnd}
            {...drop.handlers}
        >
            {arriving !== undefined && <AssetTransferSweep share={arriving} />}
            <div className="flex min-w-0 items-center gap-2 px-2">
                {icon}
                <span className={cn("min-w-0 truncate", nameClassName)}>{name}</span>
                {trailing}
                {claimedBy && <AssetClaimMark account={claimedBy} />}
                {support && asset && (
                    <AssetSupportBadge
                        record={support}
                        onConvert={asset.source === AssetSource.Local ? () => handleConvertMedia(asset) : undefined}
                    />
                )}
            </div>
            <div className="truncate px-2 text-fg-muted">{assetBrowserItemFormat(item)}</div>
            <div className="truncate px-2 text-right tabular-nums text-fg-muted">{bytes === null ? "" : formatByteSize(bytes)}</div>
            <div className={cn("truncate px-2 text-right tabular-nums", usage === 0 ? "text-fg-subtle" : "text-fg-muted")}>
                {usage === null ? "" : usage}
            </div>
            <div className="truncate px-2 text-fg-subtle" data-tip={tags || undefined}>{tags}</div>
            {showLocation && <div className="truncate px-2 text-fg-subtle" data-tip={location}>{location}</div>}
        </div>
    );
}

/** The picture at the head of a file's row: its thumbnail for an image, its type mark for anything else. */
function RowThumb({ item }: { item: Extract<AssetBrowserItem, { kind: "asset" | "inherited" }> }) {
    const Icon = ASSET_TYPE_ICONS[item.asset.type];
    if (item.asset.type === AssetType.Image) {
        return <AssetThumbnail asset={item.asset} className="h-5 w-5 shrink-0 rounded-sm bg-surface-sunken" />;
    }
    return <Icon className="h-4 w-4 shrink-0 text-fg-muted" />;
}

/** How much of what a set promises the library answers, in the warning colour when not all of it. */
function SetSummary({ entry }: { entry: ResolvedAssetSet }) {
    const summary = useSetSummary(entry);
    return (
        <span className={cn("shrink-0 truncate text-2xs", entry.incomplete ? "text-warning" : "text-fg-subtle")}>
            {summary}
        </span>
    );
}
