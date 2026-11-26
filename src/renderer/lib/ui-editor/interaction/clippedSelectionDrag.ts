type Point = { x: number; y: number };

/**
 * Whether a press should move the selection although it did not land on it.
 *
 * Moveable drags an element when the press lands on the element. Two kinds of press land inside a
 * selected element's box and still reach something else:
 *
 * - **Clipped.** A part of an element that a clipping container cuts off takes no press: it is not
 *   drawn there. An element dragged past such a container's edge is left with its frame on screen
 *   and nothing under the frame to grab.
 * - **Covered.** An element with a bigger sibling drawn over it is selected from the outline, and
 *   every press on it lands on the sibling. Without this the covered element could only be dragged
 *   after moving whatever covers it out of the way.
 *
 * Both are the selection's drag, as in every design tool: a press inside the selected element's box
 * moves what is selected. Released without moving, it is still the click it would have been and
 * selects what it hit (`useSurfaceInteractionEvents`), so the thing in front stays one click away.
 *
 * A press counts as one on the selection when:
 *
 * - it is inside the selection's frame (`insideFrame`, Moveable's own test, which follows rotation),
 * - it is inside the box of one of the selected elements - which keeps the gap between two elements
 *   of a multiple selection a press on whatever is in that gap, as it has always been,
 * - and it did not land on a selected element (`pressTarget`). Where it did, Moveable's own drag
 *   already has it.
 */
export function pressLandsInSelectionFrame(input: {
    point: Point;
    targets: readonly Element[];
    insideFrame: boolean;
    pressTarget: Element | null;
}): boolean {
    const { point, targets, insideFrame, pressTarget } = input;
    if (targets.length === 0 || !insideFrame) {
        return false;
    }
    const insideATarget = targets.some(target => {
        const box = target.getBoundingClientRect();
        return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
    });
    if (!insideATarget) {
        return false;
    }
    return !(pressTarget && targets.some(target => target === pressTarget || target.contains(pressTarget)));
}

/** Shift, Ctrl and Cmd presses add to and take from the selection; only a plain press moves it. */
export function isPlainSelectionPress(event: { button: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
    return event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey;
}
