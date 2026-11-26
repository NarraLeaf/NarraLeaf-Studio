import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import { isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import { useStore } from "@xyflow/react";
import { useTranslation } from "@/lib/i18n";
import { LivePreviewFrame } from "../ui-editor/panel/LivePreviewFrame";
import { beginOverviewDrag, endOverviewDrag, moveOverviewDrag, type OverviewDrag, type OverviewEditServices } from "./pageOverviewEdits";

type HitBox = { elementId: string; left: number; top: number; width: number; height: number };

export type OverviewPagePreviewProps = {
    surface: UISurface;
    document: UIDocument;
    /** The controls that have a group, which are the ones the preview lets the author pick. */
    elementIds: readonly string[];
    elementNames: ReadonlyMap<string, string>;
    width: number;
    contentRevision: number;
    renderSurface: (surface: UISurface) => React.ReactNode;
    selectedElementId: string | null;
    onSelect: (elementId: string) => void;
    /** Null while the page cannot be written - the preview then only selects. */
    edit: OverviewEditServices | null;
    /**
     * Told where each control is drawn, as a height inside the node that holds the preview, so the
     * node can put that control's pin beside it. Only when the answer changes.
     */
    onPins: (pins: ReadonlyArray<{ elementId: string; y: number }>) => void;
};

/** A minimal hit box, so a control drawn one pixel wide can still be pointed at. */
const MIN_HIT = 6;

/**
 * The page as the player sees it, scaled to the column, with a box over each control the overview
 * lists. A box selects its control; on a control the page places freely, dragging the box moves it.
 *
 * The boxes are measured off the drawing rather than worked out from the layout, so a control that
 * a stack or a list places is still found where it is drawn - it just cannot be dragged, because
 * its parent decides where it goes.
 */
export function OverviewPagePreview({
    surface,
    document,
    elementIds,
    elementNames,
    width,
    contentRevision,
    renderSurface,
    selectedElementId,
    onSelect,
    edit,
    onPins,
}: OverviewPagePreviewProps) {
    const { t } = useTranslation();
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const [boxes, setBoxes] = useState<HitBox[]>([]);
    const designWidth = Math.max(1, surface.designSize.width);
    const designHeight = Math.max(1, surface.designSize.height);
    const height = Math.round((width * designHeight) / designWidth);
    const scale = width / designWidth;
    // The canvas is zoomed, and a measured rectangle is zoomed with it; boxes are placed in the
    // node's own pixels, so every measurement is divided back out.
    const zoom = useStore(state => state.transform[2]);

    const measure = useCallback(() => {
        const wrap = wrapRef.current;
        if (!wrap) {
            return;
        }
        const origin = wrap.getBoundingClientRect();
        const z = zoom > 0 ? zoom : 1;
        const next: HitBox[] = [];
        for (const elementId of elementIds) {
            // The bridge draws the page with its editor markers on; a bare preview drawing names
            // its elements under the preview attribute instead. Either one says where it is drawn.
            const id = CSS.escape(elementId);
            const node = wrap.querySelector<HTMLElement>(`[data-ui-element-id="${id}"], [data-ui-preview-element-id="${id}"]`);
            if (!node) {
                continue;
            }
            const rect = node.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                continue;
            }
            const rw = rect.width / z;
            const rh = rect.height / z;
            const w = Math.max(MIN_HIT, rw);
            const h = Math.max(MIN_HIT, rh);
            next.push({
                elementId,
                left: (rect.left - origin.left) / z - (w - rw) / 2,
                top: (rect.top - origin.top) / z - (h - rh) / 2,
                width: w,
                height: h,
            });
        }
        setBoxes(previous => (sameBoxes(previous, next) ? previous : next));
    }, [elementIds, zoom]);

    // The drawing is built lazily and replaced on every content revision, so the boxes are measured
    // after it lands rather than on a fixed schedule.
    useLayoutEffect(() => {
        measure();
        const frame = requestAnimationFrame(measure);
        return () => cancelAnimationFrame(frame);
    }, [measure, contentRevision, width]);

    useEffect(() => {
        const wrap = wrapRef.current;
        if (!wrap || typeof MutationObserver === "undefined") {
            return;
        }
        let pending = 0;
        const observer = new MutationObserver(() => {
            cancelAnimationFrame(pending);
            pending = requestAnimationFrame(measure);
        });
        observer.observe(wrap, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
        return () => {
            cancelAnimationFrame(pending);
            observer.disconnect();
        };
    }, [measure]);

    useEffect(() => {
        const offset = wrapRef.current?.offsetTop ?? 0;
        onPins(boxes.map(box => ({ elementId: box.elementId, y: Math.round(offset + box.top + box.height / 2) })));
    }, [boxes, onPins]);

    const dragRef = useRef<{ drag: OverviewDrag; pointerId: number; x: number; y: number } | null>(null);

    const draggable = (elementId: string): boolean => {
        const element = document.elements[elementId];
        return Boolean(edit && element && !isUIElementFlowLayoutChild(document, element));
    };

    const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>, elementId: string) => {
        if (event.button !== 0) {
            return;
        }
        onSelect(elementId);
        if (!edit || !draggable(elementId)) {
            return;
        }
        const drag = beginOverviewDrag(edit, surface.id, elementId);
        if (!drag) {
            return;
        }
        event.currentTarget.setPointerCapture(event.pointerId);
        dragRef.current = { drag, pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    };

    const handlePointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const current = dragRef.current;
        const factor = scale * (zoom > 0 ? zoom : 1);
        if (!current || !edit || current.pointerId !== event.pointerId || factor <= 0) {
            return;
        }
        moveOverviewDrag(edit, current.drag, (event.clientX - current.x) / factor, (event.clientY - current.y) / factor);
    };

    const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
        const current = dragRef.current;
        if (!current || current.pointerId !== event.pointerId) {
            return;
        }
        dragRef.current = null;
        if (edit) {
            endOverviewDrag(edit, current.drag);
        }
    };

    return (
        // `nodrag nopan`: a press on the preview picks or moves a control, never the node or the canvas.
        <div ref={wrapRef} className="nodrag nopan relative" style={{ width, height }} data-page-overview-preview={surface.id}>
            <LivePreviewFrame
                previewId={surface.id}
                contentRevision={contentRevision}
                render={() => renderSurface(surface)}
                designWidth={designWidth}
                designHeight={designHeight}
                frameHeight={height}
                className="overflow-hidden rounded-sm bg-surface-canvas"
            />
            {boxes.map(box => {
                const name = elementNames.get(box.elementId) ?? box.elementId;
                const canDrag = draggable(box.elementId);
                const selected = box.elementId === selectedElementId;
                return (
                    <button
                        key={box.elementId}
                        type="button"
                        className={`absolute rounded-sm outline outline-1 transition-colors duration-100 ${
                            selected
                                ? "bg-primary/15 outline-primary"
                                : "outline-transparent hover:bg-fill-subtle hover:outline-edge-strong"
                        } ${canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
                        style={{ left: box.left, top: box.top, width: box.width, height: box.height, touchAction: "none" }}
                        aria-label={name}
                        aria-pressed={selected}
                        data-tip={canDrag || !edit ? name : t("uiEditor.pageOverview.placedByParent", { name })}
                        data-page-overview-hit={box.elementId}
                        onPointerDown={event => handlePointerDown(event, box.elementId)}
                        onPointerMove={handlePointerMove}
                        onPointerUp={finishDrag}
                        onPointerCancel={finishDrag}
                    />
                );
            })}
        </div>
    );
}

function sameBoxes(a: readonly HitBox[], b: readonly HitBox[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return a.every((box, index) => {
        const other = b[index];
        return other.elementId === box.elementId
            && Math.abs(other.left - box.left) < 0.5
            && Math.abs(other.top - box.top) < 0.5
            && Math.abs(other.width - box.width) < 0.5
            && Math.abs(other.height - box.height) < 0.5;
    });
}
