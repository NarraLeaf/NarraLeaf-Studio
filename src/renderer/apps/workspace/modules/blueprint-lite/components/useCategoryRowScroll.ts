import { useCallback, useEffect, useRef, useState, type DependencyList, type MouseEvent, type PointerEvent } from "react";
import { tabStripOverflow, type StripOverflow } from "@/apps/workspace/components/layout/tabStripOverflow";

/**
 * How far, in CSS px, the pointer travels with the button held before a press on the row becomes a
 * drag. Below it the press is a click on whatever chip it landed on; a hand pressing a button moves
 * a pixel or two, and that must not cost the author the click.
 */
export const CATEGORY_ROW_DRAG_THRESHOLD = 4;

type DragState = {
    pointerId: number;
    startX: number;
    startScrollLeft: number;
    moved: boolean;
};

/**
 * The palette's row of category chips: one line, wider than the menu, with no scrollbar.
 *
 * Three ways to move it, because each is the one some author reaches for first: the plain wheel
 * (turned sideways - the row only scrolls one way), a horizontal wheel or trackpad (left to the
 * browser), and a press-and-drag on the row itself, which is what a row of chips looks like it wants.
 * A drag that went past the threshold swallows the click it ends in, so letting go over a chip does
 * not also pick that category; a press that stayed put is an ordinary click.
 *
 * `overflow` says which edges are clipping chips, for the fades that are the only sign the row goes
 * on. Recomputed on scroll and on resize, and whenever `deps` change - the chips themselves change
 * with the catalogue the palette was opened on.
 */
export function useCategoryRowScroll(deps: DependencyList) {
    const rowRef = useRef<HTMLDivElement | null>(null);
    const dragRef = useRef<DragState | null>(null);
    const swallowClickRef = useRef(false);
    const [overflow, setOverflow] = useState<StripOverflow>({ left: false, right: false });
    const [dragging, setDragging] = useState(false);

    useEffect(() => {
        const row = rowRef.current;
        if (!row) {
            return;
        }
        const sync = () => {
            const next = tabStripOverflow(row);
            setOverflow(prev => (prev.left === next.left && prev.right === next.right ? prev : next));
        };
        // Not React's `onWheel`: that listener is passive, so it cannot stop the page under the menu
        // scrolling along with the row.
        const onWheel = (event: WheelEvent) => {
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
                return;
            }
            event.preventDefault();
            row.scrollLeft += event.deltaY;
        };
        sync();
        row.addEventListener("scroll", sync, { passive: true });
        row.addEventListener("wheel", onWheel, { passive: false });
        const observer = new ResizeObserver(sync);
        observer.observe(row);
        return () => {
            row.removeEventListener("scroll", sync);
            row.removeEventListener("wheel", onWheel);
            observer.disconnect();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, deps);

    const endDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) {
            return;
        }
        dragRef.current = null;
        if (!drag.moved) {
            return;
        }
        setDragging(false);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
        // The click this release produces belongs to the drag. Cleared on the next task as well, for
        // a release that produces no click at all (outside the row, or a cancelled pointer).
        swallowClickRef.current = true;
        setTimeout(() => {
            swallowClickRef.current = false;
        }, 0);
    }, []);

    const rowProps = {
        onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
            // Touch and pen already pan an overflowing row natively.
            if (event.pointerType !== "mouse" || event.button !== 0) {
                return;
            }
            dragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startScrollLeft: event.currentTarget.scrollLeft,
                moved: false,
            };
        },
        onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) {
                return;
            }
            const dx = event.clientX - drag.startX;
            if (!drag.moved) {
                if (Math.abs(dx) < CATEGORY_ROW_DRAG_THRESHOLD) {
                    return;
                }
                drag.moved = true;
                setDragging(true);
                event.currentTarget.setPointerCapture(event.pointerId);
            }
            event.currentTarget.scrollLeft = drag.startScrollLeft - dx;
        },
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onClickCapture: (event: MouseEvent<HTMLDivElement>) => {
            if (!swallowClickRef.current) {
                return;
            }
            swallowClickRef.current = false;
            event.preventDefault();
            event.stopPropagation();
        },
    };

    return { rowRef, overflow, dragging, rowProps };
}
