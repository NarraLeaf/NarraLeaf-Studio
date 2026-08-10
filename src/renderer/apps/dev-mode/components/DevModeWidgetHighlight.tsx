/**
 * The DevTools element highlight, for widgets.
 *
 * Pointing at a blueprint in Interface ▸ Blueprints asks "which widget is this one attached to",
 * and the answer is a shape on the stage rather than an id in a list.
 *
 * It is drawn in the overlay layer, above everything the game paints and above the drawer itself:
 * a widget sitting under a dialog layer or behind a floating panel is exactly the one whose
 * position was worth being shown, so being covered would fail in the only case that matters.
 *
 * Re-measured every frame while it is up. Widgets move — page transitions, Displayable motion, a
 * list scrolling — and a box that was right only at the moment the pointer arrived would point at
 * where the widget used to be.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";

type WidgetHighlightBox = { left: number; top: number; width: number; height: number };

const NO_BOXES: WidgetHighlightBox[] = [];

export function DevModeWidgetHighlight(props: { elementId: string | null }): ReactNode {
    const { elementId } = props;
    const layerRef = useRef<HTMLDivElement | null>(null);
    const [boxes, setBoxes] = useState<WidgetHighlightBox[]>(NO_BOXES);

    useEffect(() => {
        const layer = layerRef.current;
        const view = layer?.ownerDocument.defaultView;
        if (!elementId || !layer || !view) {
            setBoxes(previous => (previous.length === 0 ? previous : NO_BOXES));
            return undefined;
        }
        // One element id can be on screen more than once: every row of a list renders the same
        // authored widget. Each instance is a real place the blueprint runs, so each gets a box.
        const selector = `[data-ui-element-id="${CSS.escape(elementId)}"]`;
        let frame = 0;
        const measure = (): void => {
            frame = view.requestAnimationFrame(measure);
            const base = layer.getBoundingClientRect();
            const next: WidgetHighlightBox[] = [];
            for (const node of layer.ownerDocument.querySelectorAll<HTMLElement>(selector)) {
                const rect = node.getBoundingClientRect();
                if (rect.width <= 0 || rect.height <= 0) {
                    continue;
                }
                next.push({
                    left: rect.left - base.left,
                    top: rect.top - base.top,
                    width: rect.width,
                    height: rect.height,
                });
            }
            setBoxes(previous => (sameWidgetHighlightBoxes(previous, next) ? previous : next));
        };
        measure();
        return () => view.cancelAnimationFrame(frame);
    }, [elementId]);

    return (
        <div ref={layerRef} className="pointer-events-none absolute inset-0 z-[60]" aria-hidden>
            {boxes.map((box, index) => (
                <div
                    key={index}
                    className="absolute border border-primary bg-primary/25"
                    style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
                />
            ))}
        </div>
    );
}

function sameWidgetHighlightBoxes(a: readonly WidgetHighlightBox[], b: readonly WidgetHighlightBox[]): boolean {
    return (
        a.length === b.length &&
        a.every((box, index) => {
            const other = b[index]!;
            return (
                box.left === other.left &&
                box.top === other.top &&
                box.width === other.width &&
                box.height === other.height
            );
        })
    );
}
