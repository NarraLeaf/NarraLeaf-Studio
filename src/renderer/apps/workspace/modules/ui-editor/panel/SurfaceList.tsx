import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from "react";
import type { UISurface } from "@shared/types/ui-editor/document";
import { LayoutTemplate, MoreVertical } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { UseTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { DropIndicator } from "@/lib/components/elements/DropIndicator";
import type { FrozenControlProps } from "../../../components/ui/freezeGuard";

import { formatStageMountLabel } from "./constants";
import { LivePreviewFrame } from "./LivePreviewFrame";
import {
    moveSurfaceIdToGap,
    surfaceGapAnchor,
    surfaceGapForCard,
    surfaceHalfFromPointer,
    surfaceHalfFromPointerAcross,
    type SurfaceDropGap,
} from "./surfaceReorder";
import {
    resolveSurfaceListLayout,
    SURFACE_LIST_GAP,
    SURFACE_ROW_THUMB_HEIGHT,
    type SurfaceListLayout,
} from "./surfaceListLayout";

/** The frame round every preview; its height is the layout's, set by the frame itself. */
const PREVIEW_FRAME_CLASS = "overflow-hidden rounded-md border border-edge bg-surface-canvas";

type SurfaceListProps = {
    surfaces: UISurface[];
    /** The page the game starts on, which its card says. Resolved by the caller from the document. */
    entrySurfaceId: string | null;
    globalBlueprintCard?: SurfaceListGlobalBlueprintCard;
    renderSurfacePreview?: (surface: UISurface) => ReactNode;
    /** Moves only when this surface's own content changed; keeps one page's edit off the other cards. */
    getSurfaceContentRevision?: (surface: UISurface) => number;
    onSurfaceClick: (surface: UISurface) => void;
    onOpenMenu: (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => void;
    /**
     * Put the dragged card where it was dropped, stated as a card and which side of it.
     *
     * The list draws one kind at a time, so it knows the order the author sees but not the order the
     * document holds; the panel owns the second and turns this into one. Absent while the document
     * may not be written - the cards then do not pick up at all, rather than picking up and refusing.
     */
    onReorder?: (draggedId: string, gap: SurfaceDropGap) => void;
    /** The tile under the cards that makes a title page, while the project has no interface yet. */
    starterTile?: SurfaceListStarterTile;
};

/**
 * The first action an empty interface offers, drawn the way an empty blueprint offers its first
 * layers: a dashed tile beside what is already there, under the cards rather than over them.
 */
export type SurfaceListStarterTile = {
    title: string;
    description: string;
    onClick: () => void;
    /** The tile writes the interface document, so a frozen project greys it. */
    writeProps: FrozenControlProps;
};

export type SurfaceListGlobalBlueprintCard = {
    title: string;
    subtitle: string;
    typeLabel: string;
    /** Drawn to fill the box it is given, which is the same size as a surface preview beside it. */
    preview: ReactNode;
    canOpen: boolean;
    onClick: () => void;
    /** Right click: open the blueprint in a window of its own, as every blueprint entry does. */
    onOpenInWindow: () => void;
};

/**
 * What a card says under its name, on one line.
 *
 * The kind is left out: the list shows one kind at a time and the switch right above it says which,
 * so "Page" under every page was the switch read back. What is left is what tells two cards of the
 * same kind apart - the slot a Game UI mounts into, that a page is the entry page - and the size.
 */
const getSurfaceMetaLabel = (surface: UISurface, isEntry: boolean, t: UseTranslation["t"]): string => {
    const parts: string[] = [];
    if (surface.kind === "stageSurface") {
        parts.push(formatStageMountLabel(surface.mount, t));
    } else if (isEntry) {
        parts.push(t("uiEditor.surfaceKind.mainPage"));
    }
    parts.push(`${surface.designSize.width}×${surface.designSize.height}`);
    return parts.join(" · ");
};

/** The kind, which still names the card's actions for a screen reader. */
const getSurfaceTypeLabel = (surface: UISurface, isEntry: boolean, t: UseTranslation["t"]): string => {
    if (isEntry) {
        return t("uiEditor.surfaceKind.mainPage");
    }
    return surface.kind === "appSurface" ? t("uiEditor.surfaceKind.page") : t("uiEditor.surfaceKind.gameUi");
};

/** A card the drop indicator hangs on, and which edge of it. */
type DropAnchor = { cardIndex: number; edge: "before" | "after" };

/** The two shapes a card takes; see `surfaceListLayout`. */
type CardShape = "tile" | "row";

/** A card's outer box, shared by the surface cards and the global blueprint card. */
const cardClass = (shape: CardShape) =>
    cn(
        "group relative min-w-0 rounded-md border border-edge bg-surface-raised text-left transition-colors hover:bg-fill-subtle",
        shape === "tile" ? "flex flex-col p-2" : "flex items-center gap-2 p-1.5",
    );

/**
 * The name and the meta line, laid out the same way in both shapes.
 *
 * `tips` puts each line in full on hover, for a tile narrow enough to cut it short. Off where the card
 * already has a tip of its own to give, which a nested one would hide.
 */
function CardCaption({ name, meta, tips = false }: { name: string; meta: string; tips?: boolean }) {
    return (
        <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-semibold text-fg" data-tip={tips ? name : undefined}>{name}</div>
            <div className="truncate text-2xs text-fg-muted" data-tip={tips ? meta : undefined}>{meta}</div>
        </div>
    );
}

type SurfaceRowProps = {
    surface: UISurface;
    shape: CardShape;
    /** The preview's height in CSS pixels; a tile's width is the grid's, a row's thumbnail is fixed. */
    previewHeight: number;
    metaLabel: string;
    actionsLabel: string;
    contentRevision: number;
    renderPreview: () => ReactNode;
    onSurfaceClick: (surface: UISurface) => void;
    onOpenMenu: (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => void;
    /** False while the list is read-only, which is also when none of the drag handlers is passed. */
    draggable: boolean;
    /** This card is the one being carried, so it is greyed where it sits. */
    dragging: boolean;
    /** Which edge of this card the one indicator hangs on, or null when it is elsewhere. */
    dropEdge: "before" | "after" | null;
    onDragStart?: (event: DragEvent, cardIndex: number) => void;
    onDragEnd?: () => void;
    onDragOver?: (event: DragEvent, cardIndex: number) => void;
    onDrop?: (event: DragEvent, cardIndex: number) => void;
    /** Where this card sits in the list, which is what a gap is counted from. */
    cardIndex: number;
};

/**
 * One card in the list.
 *
 * Memoised on the surface record and its content revision rather than re-rendered with the list:
 * the panel re-renders on every document change, and without this the card's live preview would be
 * rebuilt for edits made to a completely different page. `UIDocumentService` mutates surfaces in
 * place, so the record's identity does not tell you whether it changed - the revision does.
 */
const SurfaceRow = memo(
    function SurfaceRow({
        surface,
        shape,
        previewHeight,
        metaLabel,
        actionsLabel,
        contentRevision,
        renderPreview,
        onSurfaceClick,
        onOpenMenu,
        draggable,
        dragging,
        dropEdge,
        onDragStart,
        onDragEnd,
        onDragOver,
        onDrop,
        cardIndex,
    }: SurfaceRowProps) {
        const handleClick = useCallback(() => onSurfaceClick(surface), [onSurfaceClick, surface]);
        const handleMenu = useCallback(
            (event: MouseEvent<HTMLDivElement | HTMLButtonElement>) => onOpenMenu(event, surface),
            [onOpenMenu, surface],
        );

        const preview = (
            <LivePreviewFrame
                previewId={surface.id}
                contentRevision={contentRevision}
                render={renderPreview}
                designWidth={surface.designSize.width}
                designHeight={surface.designSize.height}
                frameHeight={previewHeight}
                className={cn(PREVIEW_FRAME_CLASS, shape === "tile" ? "w-full" : "w-24 shrink-0")}
            />
        );
        const menuButton = (
            <button
                type="button"
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-fg-muted opacity-0 hover:bg-fill hover:text-fg group-hover:opacity-100"
                onClick={handleMenu}
                data-tip={actionsLabel} aria-label={actionsLabel}
            >
                <MoreVertical className="h-4 w-4" />
            </button>
        );

        return (
            <div
                className={cn(
                    cardClass(shape),
                    // The global `-webkit-user-drag: none` leaves `draggable` inert without this.
                    draggable && "nl-drag-source",
                    dragging && "opacity-50",
                )}
                data-surface-card={surface.id}
                draggable={draggable}
                onDragStart={onDragStart ? event => onDragStart(event, cardIndex) : undefined}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver ? event => onDragOver(event, cardIndex) : undefined}
                onDrop={onDrop ? event => onDrop(event, cardIndex) : undefined}
                onClick={handleClick}
                onContextMenu={handleMenu}
                role="button"
                tabIndex={0}
            >
                {/*
                  * In the gutter between cards rather than on the card's own border, which the card
                  * already draws: the gap is 8px either way, and a line centred in it belongs to
                  * neither card, which is what an insertion point is. Tiles read left to right, so
                  * theirs is upright and sits in the gutter beside them.
                  */}
                {dropEdge ? (
                    <DropIndicator
                        edge={dropEdge}
                        axis={shape === "tile" ? "horizontal" : "vertical"}
                        className={
                            shape === "tile"
                                ? dropEdge === "before" ? "-left-1" : "-right-1"
                                : dropEdge === "before" ? "-top-1" : "-bottom-1"
                        }
                    />
                ) : null}
                {shape === "tile" ? (
                    <>
                        {preview}
                        <div className="mt-1.5 flex items-start gap-1">
                            <CardCaption name={surface.name} meta={metaLabel} tips />
                            {menuButton}
                        </div>
                    </>
                ) : (
                    <>
                        {preview}
                        <CardCaption name={surface.name} meta={metaLabel} tips />
                        {menuButton}
                    </>
                )}
            </div>
        );
    },
    (previous, next) =>
        previous.surface === next.surface &&
        previous.contentRevision === next.contentRevision &&
        previous.shape === next.shape &&
        previous.previewHeight === next.previewHeight &&
        previous.metaLabel === next.metaLabel &&
        previous.actionsLabel === next.actionsLabel &&
        previous.onSurfaceClick === next.onSurfaceClick &&
        previous.onOpenMenu === next.onOpenMenu &&
        // The drag fields, so a card whose indicator has just come or gone is redrawn. They are all
        // scalars or stable callbacks, so a drag over one card leaves the other previews alone -
        // which is the whole point of this comparator.
        previous.draggable === next.draggable &&
        previous.dragging === next.dragging &&
        previous.dropEdge === next.dropEdge &&
        previous.cardIndex === next.cardIndex &&
        previous.onDragStart === next.onDragStart &&
        previous.onDragEnd === next.onDragEnd &&
        previous.onDragOver === next.onDragOver &&
        previous.onDrop === next.onDrop,
);

/**
 * The width the list lays its cards out in, measured.
 *
 * Measured rather than left to CSS because the layout is a choice between two card shapes, not just
 * a column count, and the preview inside a tile is sized from the column width. The first reading is
 * taken as the list mounts, in the commit, so the first paint already has the right shape - a list
 * that drew rows and then snapped to tiles would flash on every panel open.
 */
function useListContentWidth(): [number, (node: HTMLDivElement | null) => void] {
    const [width, setWidth] = useState(0);
    const observerRef = useRef<ResizeObserver | null>(null);

    const attach = useCallback((node: HTMLDivElement | null) => {
        observerRef.current?.disconnect();
        observerRef.current = null;
        if (!node) {
            return;
        }
        const measure = () => {
            const style = window.getComputedStyle(node);
            const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
            // `clientWidth` leaves the scrollbar's lane out, which is the width the cards really get.
            const next = Math.max(0, node.clientWidth - (Number.isFinite(padding) ? padding : 0));
            setWidth(current => (Math.abs(current - next) < 0.5 ? current : next));
        };
        measure();
        if (typeof ResizeObserver === "undefined") {
            return;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(node);
        observerRef.current = observer;
    }, []);

    useLayoutEffect(() => () => observerRef.current?.disconnect(), []);

    return [width, attach];
}

export function SurfaceList({
    surfaces,
    entrySurfaceId,
    globalBlueprintCard,
    renderSurfacePreview,
    getSurfaceContentRevision,
    onSurfaceClick,
    onOpenMenu,
    onReorder,
    starterTile,
}: SurfaceListProps) {
    const { t } = useTranslation();
    const [contentWidth, attachList] = useListContentWidth();
    const layout: SurfaceListLayout = useMemo(() => resolveSurfaceListLayout(contentWidth), [contentWidth]);
    const shape: CardShape = layout.mode === "tiles" ? "tile" : "row";
    const previewHeight = layout.mode === "tiles" ? layout.previewHeight : SURFACE_ROW_THUMB_HEIGHT;
    /**
     * The card being carried, held twice.
     *
     * A native drag runs a nested message loop, so the state set in `dragstart` is not there to be
     * read by the `dragover` that has to decide whether this is a drop target at all - the ref is.
     * The state beside it only greys the card being carried and draws the indicator, which is a
     * render and so is allowed to arrive a frame later.
     */
    const dragRef = useRef<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    /** Where the one indicator hangs: a card and which edge of it. Nothing else draws one. */
    const [dropAnchor, setDropAnchor] = useState<DropAnchor | null>(null);
    const visibleIds = useMemo(() => surfaces.map(surface => surface.id), [surfaces]);

    const handleDragStart = useCallback((event: DragEvent, cardIndex: number) => {
        const surfaceId = visibleIds[cardIndex];
        if (!surfaceId) {
            return;
        }
        dragRef.current = surfaceId;
        setDraggingId(surfaceId);
        setDropAnchor(null);
        event.dataTransfer.effectAllowed = "move";
        // A drag with an empty data transfer is not a drag at all in Chromium. Nothing is being
        // handed anywhere else, so it carries the card's own id and no more.
        event.dataTransfer.setData("text/plain", surfaceId);
    }, [visibleIds]);

    const handleDragEnd = useCallback(() => {
        dragRef.current = null;
        setDraggingId(null);
        setDropAnchor(null);
    }, []);

    /** Which half of the card under the pointer: the near side in reading order is "before". */
    const halfOf = useCallback((event: DragEvent) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return shape === "tile"
            ? surfaceHalfFromPointerAcross(event.clientX, rect)
            : surfaceHalfFromPointer(event.clientY, rect);
    }, [shape]);

    /**
     * Light a gap up, or leave it alone.
     *
     * Not calling `preventDefault` is how a card says it is not a target, which is what draws the
     * "no drop" cursor - so this asks the same move the drop asks rather than a looser test of its
     * own, and the two can never disagree.
     */
    const handleDragOver = useCallback((event: DragEvent, cardIndex: number) => {
        const draggedId = dragRef.current;
        if (!draggedId) {
            return;
        }
        const half = halfOf(event);
        const gap = surfaceGapForCard(cardIndex, half);
        if (!moveSurfaceIdToGap(visibleIds, draggedId, gap)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        // A list draws each gap in one place, between the two rows it separates. A grid draws it on
        // the card under the pointer: the gap after the last tile of a row is also the gap before the
        // first tile of the next, and a line at the far end of the next row would be nowhere near
        // where the author is pointing.
        const next = shape === "tile"
            ? { cardIndex, edge: half === "top" ? "before" as const : "after" as const }
            : surfaceGapAnchor(visibleIds.length, gap);
        setDropAnchor(current =>
            current && next && current.cardIndex === next.cardIndex && current.edge === next.edge ? current : next,
        );
    }, [halfOf, shape, visibleIds]);

    const handleDrop = useCallback((event: DragEvent, cardIndex: number) => {
        event.preventDefault();
        event.stopPropagation();
        const draggedId = dragRef.current;
        const gap = surfaceGapForCard(cardIndex, halfOf(event));
        handleDragEnd();
        if (!draggedId || !moveSurfaceIdToGap(visibleIds, draggedId, gap)) {
            return;
        }
        onReorder?.(draggedId, gap);
    }, [halfOf, handleDragEnd, onReorder, visibleIds]);


    // Nothing to list yet: the list is empty and stays empty. The Create Page / Create Game UI
    // button is the row directly above this pane (SurfaceActions), so two lines saying there are no
    // pages and to press that button are the button described rather than offered.
    if (surfaces.length === 0 && !globalBlueprintCard) {
        return <div ref={attachList} data-surface-list="" className="min-h-64 flex-1 overflow-y-auto px-2 py-2" />;
    }

    const gridStyle: CSSProperties | undefined =
        layout.mode === "tiles"
            ? { gridTemplateColumns: `repeat(${layout.columns}, minmax(0, 1fr))`, gap: SURFACE_LIST_GAP }
            : { gap: SURFACE_LIST_GAP };

    // The floor is there because this list is what the panel is for: the component and input-action
    // sections below it shrink before it does, and it keeps a card's worth of height even when they
    // have nothing left to give. The grid is a box inside the scroller rather than the scroller
    // itself, so the rows it adds grow the scroll height instead of being squeezed into the floor.
    return (
        <div ref={attachList} data-surface-list={layout.mode} className="min-h-64 flex-1 overflow-y-auto px-2 py-2">
            <div className={layout.mode === "tiles" ? "grid content-start" : "flex flex-col"} style={gridStyle}>
                {globalBlueprintCard ? (
                    <button
                        type="button"
                        className={cn(
                            cardClass(shape),
                            "disabled:cursor-default disabled:hover:bg-surface-raised",
                        )}
                        disabled={!globalBlueprintCard.canOpen}
                        onClick={globalBlueprintCard.onClick}
                        onContextMenu={event => {
                            event.preventDefault();
                            if (globalBlueprintCard.canOpen) {
                                globalBlueprintCard.onOpenInWindow();
                            }
                        }}
                        data-tip={globalBlueprintCard.canOpen ? t("blueprint.entry.openInWindow") : undefined}
                        aria-label={
                            globalBlueprintCard.canOpen
                                ? t("uiEditor.panel.openGlobalBlueprint")
                                : t("uiEditor.panel.globalBlueprintUnavailable")
                        }
                    >
                        <div
                            className={shape === "tile" ? "w-full" : "w-24 shrink-0"}
                            style={{ height: previewHeight }}
                        >
                            {globalBlueprintCard.preview}
                        </div>
                        <div className={shape === "tile" ? "mt-1.5 flex w-full items-start gap-1" : "min-w-0 flex-1"}>
                            <CardCaption
                                name={globalBlueprintCard.title}
                                meta={`${globalBlueprintCard.subtitle} · ${globalBlueprintCard.typeLabel}`}
                            />
                        </div>
                    </button>
                ) : null}
                {surfaces.map((surface, cardIndex) => {
                    const isEntry = surface.id === entrySurfaceId;
                    const typeLabel = getSurfaceTypeLabel(surface, isEntry, t);
                    return (
                        <SurfaceRow
                            key={surface.id}
                            surface={surface}
                            shape={shape}
                            previewHeight={previewHeight}
                            metaLabel={getSurfaceMetaLabel(surface, isEntry, t)}
                            actionsLabel={t("uiEditor.panel.surfaceActions", { label: typeLabel })}
                            contentRevision={getSurfaceContentRevision?.(surface) ?? 0}
                            renderPreview={() => renderSurfacePreview?.(surface) ?? null}
                            onSurfaceClick={onSurfaceClick}
                            onOpenMenu={onOpenMenu}
                            draggable={Boolean(onReorder)}
                            dragging={draggingId === surface.id}
                            dropEdge={dropAnchor?.cardIndex === cardIndex ? dropAnchor.edge : null}
                            onDragStart={onReorder ? handleDragStart : undefined}
                            onDragEnd={onReorder ? handleDragEnd : undefined}
                            onDragOver={onReorder ? handleDragOver : undefined}
                            onDrop={onReorder ? handleDrop : undefined}
                            cardIndex={cardIndex}
                        />
                    );
                })}
                {starterTile ? (
                    <button
                        type="button"
                        onClick={starterTile.onClick}
                        data-surface-starter-title-page=""
                        // A row of its own in the grid: it is not one of the pages, and at a tile's
                        // width its description would wrap to a column of single words.
                        style={layout.mode === "tiles" ? { gridColumn: "1 / -1" } : undefined}
                        className={cn(
                            "group flex w-full flex-col items-start gap-1.5 rounded-md border border-dashed border-edge-strong p-3 text-left",
                            "transition-colors duration-150 hover:border-primary hover:bg-fill-subtle focus-visible:border-primary focus-visible:bg-fill-subtle",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                        {...starterTile.writeProps}
                    >
                        <LayoutTemplate
                            className="h-4 w-4 text-fg-muted transition-colors duration-150 group-hover:text-primary group-disabled:text-fg-muted"
                            aria-hidden
                        />
                        <span className="text-xs font-medium text-fg">{starterTile.title}</span>
                        <span className="text-2xs text-fg-subtle">{starterTile.description}</span>
                    </button>
                ) : null}
            </div>
        </div>
    );
}
