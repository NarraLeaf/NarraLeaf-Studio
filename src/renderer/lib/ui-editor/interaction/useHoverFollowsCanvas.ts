import { useEffect, useRef, type RefObject } from "react";
import type { WidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateStore";
import type { ViewportTransform } from "../geometry";

type PointerPosition = { x: number; y: number };

/**
 * Keeps the canvas's hovered looks on what the pointer is over when the drawing moves and the pointer
 * does not.
 *
 * An element's hovered look follows the pointer enter and leave the browser sends, and it sends them
 * only when the pointer moves. Panning or zooming the canvas (a transform) and editing the page (an
 * element moved, deleted, brought back by an undo) both change what lies under a pointer that stays
 * where it was - and the element that slid away, or came back somewhere else, went on looking
 * hovered until the pointer next moved, or until the pointer crossed it again.
 *
 * So after either changes, on the next frame - once the new drawing is laid out, and at most once per
 * frame during a wheel gesture - this asks what is under the last place the pointer was seen inside
 * the canvas and hands that to the store, which hovers exactly the drawings around it. A pointer that
 * is outside the canvas hovers nothing on it already and is left alone, and so is a finger, which
 * never hovers.
 */
export function useHoverFollowsCanvas(
    containerRef: RefObject<HTMLElement | null>,
    store: WidgetRuntimeStateStore | null,
    viewport: ViewportTransform,
    documentRevision: number,
): void {
    const pointerRef = useRef<PointerPosition | null>(null);

    useEffect(() => {
        const root = containerRef.current;
        if (!root) {
            return undefined;
        }
        const track = (event: PointerEvent) => {
            pointerRef.current = event.pointerType === "touch" ? null : { x: event.clientX, y: event.clientY };
        };
        const forget = () => {
            pointerRef.current = null;
        };
        const listen = { capture: true, passive: true } as const;
        root.addEventListener("pointerover", track, listen);
        root.addEventListener("pointermove", track, listen);
        root.addEventListener("pointerdown", track, listen);
        root.addEventListener("pointerleave", forget);
        return () => {
            root.removeEventListener("pointerover", track, listen);
            root.removeEventListener("pointermove", track, listen);
            root.removeEventListener("pointerdown", track, listen);
            root.removeEventListener("pointerleave", forget);
        };
    }, [containerRef]);

    useEffect(() => {
        const ownerDocument = containerRef.current?.ownerDocument;
        const view = ownerDocument?.defaultView;
        if (!store || !ownerDocument || typeof view?.requestAnimationFrame !== "function") {
            return undefined;
        }
        const frameId = view.requestAnimationFrame(() => {
            const at = pointerRef.current;
            if (!at || typeof ownerDocument.elementFromPoint !== "function") {
                return;
            }
            store.retargetHover(ownerDocument.elementFromPoint(at.x, at.y));
        });
        return () => view.cancelAnimationFrame(frameId);
    }, [containerRef, documentRevision, store, viewport]);
}
