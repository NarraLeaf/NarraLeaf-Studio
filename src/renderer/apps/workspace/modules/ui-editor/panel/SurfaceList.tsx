import { memo, useCallback, useMemo, useRef, useState } from "react";
import type { DragEvent, MouseEvent, ReactNode } from "react";
import type { UISurface } from "@shared/types/ui-editor/document";
import { MoreVertical } from "lucide-react";
import { MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { useTranslation } from "@/lib/i18n";
import type { UseTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";

import { formatStageMountLabel } from "./constants";
import { LivePreviewFrame } from "./LivePreviewFrame";
import { moveSurfaceIdWithinKind, surfaceEdgeFromPointer, type SurfaceDropEdge } from "./surfaceReorder";

const SURFACE_PREVIEW_HEIGHT = 96;
const SURFACE_PREVIEW_FRAME_CLASS = "mt-2 h-24 w-full overflow-hidden rounded-md border border-edge bg-surface-canvas";

type SurfaceListProps = {
    surfaces: UISurface[];
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
    onReorder?: (draggedId: string, anchorId: string, edge: SurfaceDropEdge) => void;
};

export type SurfaceListGlobalBlueprintCard = {
    title: string;
    subtitle: string;
    typeLabel: string;
    preview: ReactNode;
    canOpen: boolean;
    onClick: () => void;
    /** Right click: open the blueprint in a window of its own, as every blueprint entry does. */
    onOpenInWindow: () => void;
};

const getSurfaceTypeLabel = (surface: UISurface, t: UseTranslation["t"]): string => {
    if (surface.id === MAIN_APP_SURFACE_ID) {
        // Its own kind, not `DEFAULT_APP_SURFACE_NAME`: that constant is the name a new
        // project's entry page is created with, and using it here printed English into a
        // translated column - and printed the page's name again where its kind belongs.
        return t("uiEditor.surfaceKind.mainPage");
    }
    return surface.kind === "appSurface" ? t("uiEditor.surfaceKind.page") : t("uiEditor.surfaceKind.gameUi");
};

type SurfaceRowProps = {
    surface: UISurface;
    typeLabel: string;
    /** Localized stage slot this Game UI mounts into; absent for a Page. */
    mountLabel?: string;
    actionsLabel: string;
    contentRevision: number;
    renderPreview: () => ReactNode;
    onSurfaceClick: (surface: UISurface) => void;
    onOpenMenu: (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => void;
    /** False while the list is read-only, which is also when none of the drag handlers is passed. */
    draggable: boolean;
    /** This card is the one being carried, so it is greyed where it sits. */
    dragging: boolean;
    /** Which side of this card the drop indicator is on, or null for no indicator. */
    dropEdge: SurfaceDropEdge | null;
    onDragStart?: (event: DragEvent, surfaceId: string) => void;
    onDragEnd?: () => void;
    onDragOver?: (event: DragEvent, surfaceId: string) => void;
    onDrop?: (event: DragEvent, surfaceId: string) => void;
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
        typeLabel,
        mountLabel,
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
    }: SurfaceRowProps) {
        const handleClick = useCallback(() => onSurfaceClick(surface), [onSurfaceClick, surface]);
        const handleMenu = useCallback(
            (event: MouseEvent<HTMLDivElement | HTMLButtonElement>) => onOpenMenu(event, surface),
            [onOpenMenu, surface],
        );

        return (
            <div
                className={cn(
                    "group relative w-full text-left rounded-md border border-edge bg-surface-raised px-3 py-2 transition-colors hover:bg-fill-subtle",
                    // The global `-webkit-user-drag: none` leaves `draggable` inert without this.
                    draggable && "nl-drag-source",
                    dragging && "opacity-50",
                )}
                draggable={draggable}
                onDragStart={onDragStart ? event => onDragStart(event, surface.id) : undefined}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver ? event => onDragOver(event, surface.id) : undefined}
                onDrop={onDrop ? event => onDrop(event, surface.id) : undefined}
                onClick={handleClick}
                onContextMenu={handleMenu}
                role="button"
                tabIndex={0}
            >
                {dropEdge ? (
                    <div
                        className={cn(
                            "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-primary",
                            dropEdge === "before" ? "-top-1" : "-bottom-1",
                        )}
                    />
                ) : null}
                <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-fg truncate">{surface.name}</div>
                        <div className="text-2xs text-fg-muted">
                            {surface.designSize.width}×{surface.designSize.height}
                        </div>
                        <div className="text-2xs text-fg-subtle">{typeLabel}</div>
                        {mountLabel ? <div className="text-2xs text-fg-subtle">{mountLabel}</div> : null}
                    </div>
                    <button
                        type="button"
                        className="p-1 rounded-md hover:bg-fill text-fg-muted opacity-0 group-hover:opacity-100"
                        onClick={handleMenu}
                        data-tip={actionsLabel} aria-label={actionsLabel}
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                </div>
                <LivePreviewFrame
                    previewId={surface.id}
                    contentRevision={contentRevision}
                    render={renderPreview}
                    designWidth={surface.designSize.width}
                    designHeight={surface.designSize.height}
                    frameHeight={SURFACE_PREVIEW_HEIGHT}
                    className={SURFACE_PREVIEW_FRAME_CLASS}
                />
            </div>
        );
    },
    (previous, next) =>
        previous.surface === next.surface &&
        previous.contentRevision === next.contentRevision &&
        previous.typeLabel === next.typeLabel &&
        previous.mountLabel === next.mountLabel &&
        previous.actionsLabel === next.actionsLabel &&
        previous.onSurfaceClick === next.onSurfaceClick &&
        previous.onOpenMenu === next.onOpenMenu &&
        // The drag fields, so a card whose indicator has just come or gone is redrawn. They are all
        // scalars or stable callbacks, so a drag over one card leaves the other previews alone -
        // which is the whole point of this comparator.
        previous.draggable === next.draggable &&
        previous.dragging === next.dragging &&
        previous.dropEdge === next.dropEdge &&
        previous.onDragStart === next.onDragStart &&
        previous.onDragEnd === next.onDragEnd &&
        previous.onDragOver === next.onDragOver &&
        previous.onDrop === next.onDrop,
);

export function SurfaceList({
    surfaces,
    globalBlueprintCard,
    renderSurfacePreview,
    getSurfaceContentRevision,
    onSurfaceClick,
    onOpenMenu,
    onReorder,
}: SurfaceListProps) {
    const { t } = useTranslation();
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
    const [dropTarget, setDropTarget] = useState<{ surfaceId: string; edge: SurfaceDropEdge } | null>(null);
    const visibleIds = useMemo(() => surfaces.map(surface => surface.id), [surfaces]);

    const handleDragStart = useCallback((event: DragEvent, surfaceId: string) => {
        dragRef.current = surfaceId;
        setDraggingId(surfaceId);
        setDropTarget(null);
        event.dataTransfer.effectAllowed = "move";
        // A drag with an empty data transfer is not a drag at all in Chromium. Nothing is being
        // handed anywhere else, so it carries the card's own id and no more.
        event.dataTransfer.setData("text/plain", surfaceId);
    }, []);

    const handleDragEnd = useCallback(() => {
        dragRef.current = null;
        setDraggingId(null);
        setDropTarget(null);
    }, []);

    /**
     * Light a card up, or leave it alone.
     *
     * Not calling `preventDefault` is how a card says it is not a target, which is what draws the
     * "no drop" cursor - so this asks the same move the drop asks rather than a looser test of its
     * own, and the two can never disagree.
     */
    const handleDragOver = useCallback((event: DragEvent, surfaceId: string) => {
        const draggedId = dragRef.current;
        if (!draggedId) {
            return;
        }
        const edge = surfaceEdgeFromPointer(event.clientY, event.currentTarget.getBoundingClientRect());
        if (!moveSurfaceIdWithinKind(visibleIds, draggedId, surfaceId, edge)) {
            return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropTarget(current => (
            current && current.surfaceId === surfaceId && current.edge === edge ? current : { surfaceId, edge }
        ));
    }, [visibleIds]);

    const handleDrop = useCallback((event: DragEvent, surfaceId: string) => {
        event.preventDefault();
        event.stopPropagation();
        const draggedId = dragRef.current;
        const edge = surfaceEdgeFromPointer(event.clientY, event.currentTarget.getBoundingClientRect());
        handleDragEnd();
        if (!draggedId || !moveSurfaceIdWithinKind(visibleIds, draggedId, surfaceId, edge)) {
            return;
        }
        onReorder?.(draggedId, surfaceId, edge);
    }, [handleDragEnd, onReorder, visibleIds]);

    // Nothing to list yet: the list is empty and stays empty. The Create Page / Create Game UI
    // button is the row directly above this pane (SurfaceActions), so two lines saying there are no
    // pages and to press that button are the button described rather than offered.
    if (surfaces.length === 0 && !globalBlueprintCard) {
        return <div className="flex-1 overflow-y-auto px-2 py-2" />;
    }

    return (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
            {globalBlueprintCard ? (
                <button
                    type="button"
                    className="group w-full text-left rounded-md border border-edge bg-surface-raised px-3 py-2 transition-colors hover:bg-fill-subtle disabled:cursor-default disabled:hover:bg-surface-raised"
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
                    <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                            <div className="text-sm font-semibold text-fg truncate">{globalBlueprintCard.title}</div>
                            <div className="text-2xs text-fg-muted">{globalBlueprintCard.subtitle}</div>
                            <div className="text-2xs text-fg-subtle">{globalBlueprintCard.typeLabel}</div>
                        </div>
                    </div>
                    <div className="mt-2">{globalBlueprintCard.preview}</div>
                </button>
            ) : null}
            {surfaces.map(surface => {
                const typeLabel = getSurfaceTypeLabel(surface, t);
                return (
                    <SurfaceRow
                        key={surface.id}
                        surface={surface}
                        typeLabel={typeLabel}
                        mountLabel={
                            surface.kind === "stageSurface" ? formatStageMountLabel(surface.mount, t) : undefined
                        }
                        actionsLabel={t("uiEditor.panel.surfaceActions", { label: typeLabel })}
                        contentRevision={getSurfaceContentRevision?.(surface) ?? 0}
                        renderPreview={() => renderSurfacePreview?.(surface) ?? null}
                        onSurfaceClick={onSurfaceClick}
                        onOpenMenu={onOpenMenu}
                        draggable={Boolean(onReorder)}
                        dragging={draggingId === surface.id}
                        dropEdge={dropTarget?.surfaceId === surface.id ? dropTarget.edge : null}
                        onDragStart={onReorder ? handleDragStart : undefined}
                        onDragEnd={onReorder ? handleDragEnd : undefined}
                        onDragOver={onReorder ? handleDragOver : undefined}
                        onDrop={onReorder ? handleDrop : undefined}
                    />
                );
            })}
        </div>
    );
}
