import { useCallback, useRef } from "react";

type PointerPoint = { clientX: number; clientY: number };

/**
 * Hover highlighting for a slot's menus that follows the pointer, and only the pointer.
 *
 * The highlight is Enter's pointer, so whatever lights it decides what Enter takes. Wiring it to
 * `mouseenter` let the list light a row the pointer never moved to: a wheel over the open menu
 * scrolls the rows under a pointer that stays where it is, Chromium reports the row that slid under
 * it as entered, and the word Enter would take changed while the author was only scrolling to read.
 *
 * So a row lights on `mousemove`, and only when the pointer is somewhere it was not on the previous
 * move. The first move after the menu opens records where the pointer is and lights nothing: the
 * menu opening under a resting pointer is not the author choosing a row either.
 *
 * Returns `(key, event)`; call it from each row's `onMouseMove`.
 */
export function usePointerHighlight(onHighlight: (key: string) => void): (key: string, event: PointerPoint) => void {
    const last = useRef<{ x: number; y: number } | null>(null);
    const latest = useRef(onHighlight);
    latest.current = onHighlight;
    return useCallback((key: string, event: PointerPoint) => {
        const previous = last.current;
        last.current = { x: event.clientX, y: event.clientY };
        if (previous && (previous.x !== event.clientX || previous.y !== event.clientY)) {
            latest.current(key);
        }
    }, []);
}
