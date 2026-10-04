import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Folder, Layers } from "lucide-react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetSource, type AssetGroup } from "@/lib/workspace/services/assets/types";
import type { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { AssetThumbnail } from "../components/AssetThumbnail";
import { AssetSupportBadge } from "../components/AssetSupportBadge";
import { ASSET_SET_REVEAL_RING, useAssetSetRevealMark, useSetSummary } from "../components/AssetSetRow";
import { AssetTransferSweep } from "../assetLiveSession";
import { ASSET_TYPE_ICONS } from "../constants";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import {
    assetBrowserItemBytes,
    assetBrowserItemFormat,
    assetBrowserItemName,
    type AssetBrowserItem,
    type AssetBrowserMeasures,
} from "./assetBrowserModel";
import { formatByteSize } from "../../asset-overview/assetOverviewModel";
import { useBrowserDropTarget, useBrowserItemGestures } from "./useBrowserItemGestures";

/** The `gap-2` between tiles, in pixels. Read here because the column count is worked out by hand. */
const TILE_GAP_PX = 8;

/**
 * What a tile costs above its square: the border, the padding, the gap and the two text rows.
 *
 * Only the first frame and the scrollbar depend on it - every mounted row of tiles measures itself.
 */
const TILE_CHROME_PX = 50;

export interface BrowserGridProps {
    items: readonly AssetBrowserItem[];
    tileSize: number;
    measures: AssetBrowserMeasures;
    insideSet: ResolvedAssetSet | null;
    onEnterGroup: (category: AssetCategory, group: AssetGroup) => void;
    onEnterSet: (entry: ResolvedAssetSet) => void;
    onDropOnGroup: (event: React.DragEvent, kind: "move" | "files", category: AssetCategory, group: AssetGroup) => void;
}

/**
 * The contents of one place as tiles, windowed a row at a time.
 *
 * The row is the unit the virtualiser measures, so the column count is worked out here with the
 * formula `repeat(auto-fill, minmax(size, 1fr))` would use: it is the one number that decides how
 * many rows there are, and a grid that wraps by itself cannot say.
 */
export function BrowserGrid({ items, tileSize, measures, insideSet, onEnterGroup, onEnterSet, onDropOnGroup }: BrowserGridProps) {
    const { assetSetReveal } = useAssetsPanelContext();
    const gestures = useBrowserItemGestures({ insideSet, onEnterGroup, onEnterSet });
    const listRef = useRef<HTMLDivElement | null>(null);
    const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null);
    const [width, setWidth] = useState(0);

    const columns = Math.max(1, Math.floor((width + TILE_GAP_PX) / (tileSize + TILE_GAP_PX)));
    const columnWidth = width > 0 ? (width - TILE_GAP_PX * (columns - 1)) / columns : tileSize;
    const rowCount = Math.ceil(items.length / columns);

    const virtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => scrollElement,
        estimateSize: () => columnWidth + TILE_CHROME_PX + TILE_GAP_PX,
        overscan: 4,
    });

    useLayoutEffect(() => {
        const list = listRef.current;
        if (!list) {
            return;
        }
        const next = list.getBoundingClientRect().width;
        setWidth(previous => (Math.abs(previous - next) > 0.5 ? next : previous));
    });

    useEffect(() => {
        const list = listRef.current;
        if (!list || typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(() => {
            const next = list.getBoundingClientRect().width;
            setWidth(previous => (Math.abs(previous - next) > 0.5 ? next : previous));
        });
        observer.observe(list);
        return () => observer.disconnect();
    }, []);

    // A column count that changes puts every tile in a different row, and the cache is keyed by row.
    useLayoutEffect(() => {
        virtualizer.measure();
    }, [columns, tileSize, virtualizer]);

    // A jump landing on a set: its row may not be mounted, and the tile marks itself once it is.
    const revealNonce = assetSetReveal?.nonce ?? null;
    const revealSetId = assetSetReveal?.setId ?? null;
    useEffect(() => {
        if (revealNonce === null || !revealSetId) {
            return;
        }
        const index = items.findIndex(item => item.kind === "set" && item.entry.set.id === revealSetId);
        if (index >= 0) {
            virtualizer.scrollToIndex(Math.floor(index / columns), { align: "center" });
        }
        // The request is the event; the items are read from the render it landed in.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revealNonce]);

    return (
        <div ref={setScrollElement} className="h-full overflow-y-auto px-2 py-2">
            <div ref={listRef} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map(row => (
                    <div
                        key={row.key}
                        ref={virtualizer.measureElement}
                        data-index={row.index}
                        className={cn("absolute left-0 top-0 grid w-full gap-2", row.index < rowCount - 1 && "pb-2")}
                        style={{
                            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                            transform: `translateY(${row.start}px)`,
                        }}
                    >
                        {items.slice(row.index * columns, row.index * columns + columns).map(item => (
                            <BrowserTile
                                key={item.key}
                                item={item}
                                measures={measures}
                                gestures={gestures}
                                onDropOnGroup={onDropOnGroup}
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}

type Gestures = ReturnType<typeof useBrowserItemGestures>;

function BrowserTile({ item, measures, gestures, onDropOnGroup }: {
    item: AssetBrowserItem;
    measures: AssetBrowserMeasures;
    gestures: Gestures;
    onDropOnGroup: BrowserGridProps["onDropOnGroup"];
}) {
    if (item.kind === "set") {
        return <SetTile item={item} gestures={gestures} />;
    }
    if (item.kind === "group") {
        return <GroupTile item={item} gestures={gestures} onDropOnGroup={onDropOnGroup} />;
    }
    return <FileTile item={item} measures={measures} gestures={gestures} />;
}

/**
 * The frame every tile shares: the square, the name, and one line under it saying what the thing is.
 * Written once so a folder, a set and a file cannot drift into three looks in one grid.
 */
function TileFrame({
    selected,
    dimmed,
    dropOver,
    marked,
    frameRef,
    draggable,
    tone,
    square,
    name,
    nameClassName,
    meta,
    metaClassName,
    overlay,
    dataAttributes,
    onClick,
    onDoubleClick,
    onContextMenu,
    onDragStart,
    onDragEnd,
    dropHandlers,
}: {
    selected?: boolean;
    dimmed?: boolean;
    dropOver?: boolean;
    marked?: boolean;
    frameRef?: React.Ref<HTMLDivElement>;
    draggable?: boolean;
    tone?: "warning";
    square: React.ReactNode;
    name: string;
    nameClassName?: string;
    meta?: string;
    metaClassName?: string;
    overlay?: React.ReactNode;
    dataAttributes?: Record<string, string>;
    onClick?: (event: React.MouseEvent) => void;
    onDoubleClick?: () => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDragStart?: (event: React.DragEvent) => void;
    onDragEnd?: () => void;
    dropHandlers?: Partial<Pick<React.HTMLAttributes<HTMLDivElement>, "onDragOver" | "onDragLeave" | "onDrop">>;
}) {
    return (
        <div
            ref={frameRef}
            {...dataAttributes}
            draggable={draggable}
            className={cn(
                "relative isolate flex min-w-0 flex-col gap-1 rounded-md border p-1.5 cursor-default",
                draggable && "nl-drag-source",
                selected ? "border-primary/80 bg-primary/10" : tone === "warning" ? "border-dashed border-warning/40" : "border-transparent hover:bg-fill",
                dimmed && "opacity-40",
                dropOver && "ring-1 ring-primary/50 bg-primary/10",
                marked && ASSET_SET_REVEAL_RING,
            )}
            onClick={onClick}
            onDoubleClick={onDoubleClick}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            {...dropHandlers}
        >
            {overlay}
            <div className="relative aspect-square w-full overflow-hidden rounded-sm bg-surface-sunken">
                {square}
            </div>
            <div className="min-w-0">
                <p className={cn("truncate text-xs", nameClassName)} data-tip={name}>{name}</p>
                <p className={cn("truncate text-2xs text-fg-subtle", metaClassName)}>{meta || " "}</p>
            </div>
        </div>
    );
}

function SetTile({ item, gestures }: { item: Extract<AssetBrowserItem, { kind: "set" }>; gestures: Gestures }) {
    const { draggedAssetSet } = useAssetsPanelContext();
    const summary = useSetSummary(item.entry);
    const reveal = useAssetSetRevealMark(item.entry.set.id);
    const dragStart = gestures.dragStartFor(item);
    const incomplete = item.entry.incomplete;
    return (
        <TileFrame
            frameRef={reveal.ref}
            marked={reveal.marked}
            dataAttributes={{ "data-asset-browser-item": item.key, "data-asset-set-id": item.entry.set.id }}
            draggable={!!dragStart}
            dimmed={draggedAssetSet?.setId === item.entry.set.id}
            square={(
                <div className="flex h-full w-full items-center justify-center">
                    <Layers className={cn("h-1/3 w-1/3", incomplete ? "text-warning" : "text-primary")} />
                </div>
            )}
            name={item.entry.set.name}
            // A set drawn as the answer to another set's value says which value; one filed in a
            // folder says how much of what it promises the library answers.
            meta={item.caption ?? summary}
            metaClassName={incomplete && !item.caption ? "text-warning" : undefined}
            onClick={event => gestures.onClick(item, event)}
            onDoubleClick={() => gestures.onOpen(item)}
            onContextMenu={event => gestures.onContextMenu(item, event)}
            onDragStart={dragStart}
            onDragEnd={gestures.onDragEnd}
        />
    );
}

function GroupTile({ item, gestures, onDropOnGroup }: {
    item: Extract<AssetBrowserItem, { kind: "group" }>;
    gestures: Gestures;
    onDropOnGroup: BrowserGridProps["onDropOnGroup"];
}) {
    const { tn } = useTranslation();
    const { selectedItems, clipboard, draggedItem } = useAssetsPanelContext();
    const { group, category } = item;
    const drop = useBrowserDropTarget(category, (event, kind) => onDropOnGroup(event, kind, category, group));
    const isCut = clipboard?.type === "cut" && clipboard.groups.some(entry => entry.id === group.id);
    const isDragging = !!draggedItem && draggedItem.isGroup && draggedItem.item.id === group.id;
    return (
        <TileFrame
            dataAttributes={{ "data-asset-browser-item": item.key, "data-asset-group-id": group.id }}
            draggable
            selected={selectedItems.has("group:" + group.id)}
            dimmed={isCut || isDragging}
            dropOver={drop.over}
            square={item.preview.length > 0 ? (
                <div className={cn("grid h-full w-full gap-px", item.preview.length > 1 && "grid-cols-2 grid-rows-2")}>
                    {item.preview.map(asset => (
                        <AssetThumbnail key={asset.id} asset={asset} className="h-full w-full min-h-0 min-w-0" />
                    ))}
                </div>
            ) : (
                <div className="flex h-full w-full items-center justify-center">
                    <Folder className="h-1/3 w-1/3 text-fg-subtle" />
                </div>
            )}
            name={group.name}
            meta={tn("assets.itemCount", item.childCount)}
            onClick={event => gestures.onClick(item, event)}
            onDoubleClick={() => gestures.onOpen(item)}
            onContextMenu={event => gestures.onContextMenu(item, event)}
            onDragStart={gestures.dragStartFor(item)}
            onDragEnd={gestures.onDragEnd}
            dropHandlers={drop.handlers}
        />
    );
}

function FileTile({ item, measures, gestures }: {
    item: Extract<AssetBrowserItem, { kind: "asset" | "inherited" | "hole" }>;
    measures: AssetBrowserMeasures;
    gestures: Gestures;
}) {
    const { t } = useTranslation();
    const { selectedItems, clipboard, draggedItem, mediaSupport, handleConvertMedia, assetTransfers } = useAssetsPanelContext();

    if (item.kind === "hole") {
        return (
            <TileFrame
                dataAttributes={{ "data-asset-browser-item": item.key }}
                tone="warning"
                square={(
                    <div className="flex h-full w-full items-center justify-center">
                        <span className="text-2xs text-warning">{t("assets.sets.inspector.variantMissing")}</span>
                    </div>
                )}
                name={item.caption}
                nameClassName="text-fg-muted"
                onContextMenu={event => gestures.onContextMenu(item, event)}
            />
        );
    }

    const asset = item.asset;
    const Icon = ASSET_TYPE_ICONS[asset.type];
    const square = asset.type === AssetType.Image
        ? <AssetThumbnail asset={asset} className="h-full w-full" />
        : (
            <div className="flex h-full w-full items-center justify-center bg-fill">
                <Icon className="h-1/4 w-1/4 text-fg-muted" />
            </div>
        );

    if (item.kind === "inherited") {
        // The fallback's file, drawn again at a value that has none of its own. Not that file's own
        // tile: selecting, opening or dragging it here would be one file drawn as two.
        return (
            <TileFrame
                dataAttributes={{ "data-asset-browser-item": item.key }}
                square={square}
                name={item.caption}
                nameClassName="italic text-fg-muted"
                meta={`${asset.name} · ${t("assets.sets.inspector.variantInherited")}`}
                onContextMenu={event => gestures.onContextMenu(item, event)}
            />
        );
    }

    const support = mediaSupport.get(asset.id);
    const arriving = assetTransfers[asset.id];
    const dragStart = gestures.dragStartFor(item);
    const bytes = assetBrowserItemBytes(item, measures);
    const meta = [assetBrowserItemFormat(item), bytes === null ? "" : formatByteSize(bytes)].filter(Boolean).join(" · ");
    const isCut = clipboard?.type === "cut" && clipboard.assets.some(entry => entry.id === asset.id);
    const isDragging = !!draggedItem && !draggedItem.isGroup && draggedItem.item.id === asset.id;
    return (
        <TileFrame
            dataAttributes={{ "data-asset-browser-item": item.key }}
            draggable={!!dragStart}
            selected={selectedItems.has("asset:" + asset.id)}
            dimmed={isCut || isDragging}
            overlay={arriving !== undefined ? <AssetTransferSweep share={arriving} /> : undefined}
            square={(
                <>
                    {square}
                    {support && (
                        <AssetSupportBadge
                            record={support}
                            onConvert={asset.source === AssetSource.Local ? () => handleConvertMedia(asset) : undefined}
                            className="absolute left-1 top-1"
                        />
                    )}
                </>
            )}
            // Inside a set the value is the name the author is looking for; the file's own name is
            // what answers it.
            name={item.caption ?? assetBrowserItemName(item)}
            meta={item.caption ? asset.name : meta}
            onClick={event => gestures.onClick(item, event)}
            onDoubleClick={() => gestures.onOpen(item)}
            onContextMenu={event => gestures.onContextMenu(item, event)}
            onDragStart={dragStart}
            onDragEnd={gestures.onDragEnd}
        />
    );
}
