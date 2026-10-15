import { useCallback, useMemo, useRef, useState } from "react";

type PointerPoint = { clientX: number; clientY: number };

export type MenuPointer = {
    /**
     * Call from each row's `onMouseMove`, with the row's highlight key - or `null` for a row that is
     * not a highlight stop (the speaker menu's "create" row, a "nothing matches" line), which still
     * answers the pointer with its hover tint.
     */
    move: (key: string | null, event: PointerPoint) => void;
    /**
     * Whether rows may wear their hover tint: the pointer has moved since rows last moved under it.
     * A row's `hover:` classes belong behind this.
     */
    live: boolean;
    /** Spread on the element that scrolls the rows. */
    listProps: {
        onScroll: () => void;
        onMouseOver: (event: PointerPoint) => void;
    };
    /**
     * Forget the pointer, for a menu that stays mounted while closed and opens again: its next
     * opening is under a resting pointer as much as its first was.
     */
    reset: () => void;
};

/**
 * Hover highlighting for a slot's menus that follows the pointer, and only the pointer. The blueprint
 * add-node menu follows the same rule, for the same reason.
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
 * The hover tint follows the same rule. CSS `:hover` goes to whatever row is under the pointer, so
 * after a wheel the row that slid under it wore the grey tint while the highlighted row had scrolled
 * out of view, and the grey read as the highlight. The tint is therefore off until the pointer
 * moves, and goes off again whenever rows move under it instead: on a scroll of the list (a wheel, or
 * an arrow key bringing the highlight into view), and on a row arriving under a pointer that is
 * where it was (the list re-filtered as the author typed).
 */
export function usePointerHighlight(onHighlight: (key: string) => void): MenuPointer {
    const last = useRef<{ x: number; y: number } | null>(null);
    const latest = useRef(onHighlight);
    latest.current = onHighlight;
    const [live, setLive] = useState(false);

    const move = useCallback((key: string | null, event: PointerPoint) => {
        const previous = last.current;
        last.current = { x: event.clientX, y: event.clientY };
        if (previous && (previous.x !== event.clientX || previous.y !== event.clientY)) {
            setLive(true);
            if (key !== null) {
                latest.current(key);
            }
        }
    }, []);

    const listProps = useMemo(() => ({
        onScroll: () => setLive(false),
        onMouseOver: (event: PointerPoint) => {
            // A pointer that moves onto a row arrives somewhere new; a row that moves under the
            // pointer finds it where the last move left it.
            const at = last.current;
            if (at && at.x === event.clientX && at.y === event.clientY) {
                setLive(false);
            }
        },
    }), []);

    const reset = useCallback(() => {
        last.current = null;
        setLive(false);
    }, []);

    return { move, live, listProps, reset };
}
