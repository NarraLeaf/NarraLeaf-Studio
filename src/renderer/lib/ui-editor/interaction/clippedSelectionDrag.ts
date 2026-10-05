type Point = { x: number; y: number };

/**
 * Whether a press should move the selection although it did not land on it.
 *
 * Moveable drags an element when the press lands on the element, and a part of an element that a
 * clipping container cuts off takes no press: it is not drawn there. An element dragged past such a
 * container's edge is therefore left with its selection frame on screen and nothing under the frame
 * to grab, and every press there goes to whatever is behind it instead. So a press counts as one on
 * the selection when:
 *
 * - it is inside the selection's frame (`insideFrame`, Moveable's own test, which follows rotation),
 * - it is inside the box of one of the selected elements - which keeps the gap between two elements
 *   of a multiple selection a press on whatever is in that gap, as it has always been,
 * - and none of the selected elements is drawn at that point (`elementsAtPoint`, in the order
 *   `document.elementsFromPoint` returns them). Where one is drawn, the press already reaches it,
 *   and an element merely covered by another is still listed there, so a press on the thing in front
 *   keeps selecting the thing in front.
 */
export function pressLandsOnClippedSelection(input: {
    point: Point;
    targets: readonly Element[];
    insideFrame: boolean;
    elementsAtPoint: readonly Element[];
}): boolean {
    const { point, targets, insideFrame, elementsAtPoint } = input;
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
    return !elementsAtPoint.some(hit => targets.some(target => target === hit || target.contains(hit)));
}

/** Shift, Ctrl and Cmd presses add to and take from the selection; only a plain press moves it. */
export function isPlainSelectionPress(event: { button: number; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
    return event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey;
}
