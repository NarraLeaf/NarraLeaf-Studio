/**
 * The DOM half of input routing: what a browser event means in a surface's own terms, and how an
 * input that a lane passed on reaches the lane behind it.
 *
 * Kept apart from {@link ../input/surfaceInputActions} so the rules stay testable without a
 * document: everything here needs a real node under a real pointer, and everything there does not.
 *
 * Comments in English per project convention.
 */

import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import type { UIInputPointerGesture } from "@shared/types/ui-editor/inputAction";

const UI_ELEMENT_ID_ATTR = "data-ui-element-id";

/**
 * Lanes this event has already been offered to.
 *
 * A `pass` lane hands the input on by re-dispatching it into the lane behind, and that dispatch
 * bubbles through everything on the way - including, on some layouts, a shell that has already had
 * its turn. Without this the two would hand it back and forth forever. Keyed on the event object, in
 * the same shape and for the same reason as the DOM propagation control beside it.
 */
const VISITED_LANES = new WeakMap<Event, Set<string>>();

/** Whether this lane has already answered this event, marking it as having done so if not. */
export function claimInputLaneVisit(event: Event, laneKey: string): boolean {
    const visited = VISITED_LANES.get(event);
    if (!visited) {
        VISITED_LANES.set(event, new Set([laneKey]));
        return true;
    }
    if (visited.has(laneKey)) {
        return false;
    }
    visited.add(laneKey);
    return true;
}

/** Carry an event's visit record onto the copy that is handed to the lane behind. */
function inheritInputLaneVisits(source: Event, clone: Event): void {
    VISITED_LANES.set(clone, new Set(VISITED_LANES.get(source) ?? []));
}

/**
 * Which of the coarse wheel gestures this scroll is, or null when it moved nothing.
 *
 * One gesture, not two: a trackpad reports both axes on almost every frame, and an action bound to
 * `wheelDown` firing on a sideways flick because the vertical delta was not exactly zero is not a
 * gesture anybody aimed. The larger movement is the one the player meant.
 */
export function readWheelGesture(delta: { deltaX: number; deltaY: number }): UIInputPointerGesture | null {
    const x = Number.isFinite(delta.deltaX) ? delta.deltaX : 0;
    const y = Number.isFinite(delta.deltaY) ? delta.deltaY : 0;
    if (x === 0 && y === 0) {
        return null;
    }
    if (Math.abs(y) >= Math.abs(x)) {
        return y > 0 ? "wheelDown" : "wheelUp";
    }
    return x > 0 ? "wheelRight" : "wheelLeft";
}

/** Look one element id up wherever it lives - the surface's own table, or a component's. */
function readDocumentElement(document: UIDocument, elementId: string): UIElement | undefined {
    const own = document.elements[elementId];
    if (own) {
        return own;
    }
    for (const component of document.components ?? []) {
        const inner = component.elements[elementId];
        if (inner) {
            return inner;
        }
    }
    return undefined;
}

/**
 * The authored elements under the pointer, innermost first.
 *
 * Read off the DOM rather than off the document tree on purpose: `overControls` asks what the player
 * was pointing at, and only the DOM knows which of two overlapping siblings was actually on top.
 * Stops at the surface shell, so a lane never reports the elements of the lane in front of it.
 */
export function readSurfaceHitChain(input: {
    document: UIDocument;
    target: EventTarget | null;
    surfaceRoot: Element | null;
}): UIElement[] {
    const { document, surfaceRoot } = input;
    const start =
        input.target instanceof Element
            ? input.target
            : input.target instanceof Node
              ? input.target.parentElement
              : null;
    const chain: UIElement[] = [];
    let node: Element | null = start;
    while (node && (!surfaceRoot || surfaceRoot.contains(node))) {
        const elementId = node.getAttribute(UI_ELEMENT_ID_ATTR);
        if (elementId) {
            const element = readDocumentElement(document, elementId);
            if (element) {
                chain.push(element);
            }
        }
        node = node.parentElement;
    }
    return chain;
}

function cloneInputEvent(event: MouseEvent | WheelEvent): MouseEvent | WheelEvent | null {
    const init: MouseEventInit = {
        bubbles: true,
        cancelable: event.cancelable,
        composed: true,
        clientX: event.clientX,
        clientY: event.clientY,
        screenX: event.screenX,
        screenY: event.screenY,
        button: event.button,
        buttons: event.buttons,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
        detail: event.detail,
        view: event.view,
    };
    try {
        if (typeof WheelEvent !== "undefined" && event instanceof WheelEvent) {
            return new WheelEvent(event.type, {
                ...init,
                deltaX: event.deltaX,
                deltaY: event.deltaY,
                deltaZ: event.deltaZ,
                deltaMode: event.deltaMode,
            });
        }
        return new MouseEvent(event.type, init);
    } catch {
        // A host whose event constructors are missing or refuse this init cannot be handed the
        // event on. The lane in front has already answered; losing the one behind is the smaller
        // failure, and throwing out of a click handler is the larger one.
        return null;
    }
}

/**
 * Hand an input the current lane passed on to the lane behind it.
 *
 * The two hosts do not share a DOM subtree - the app surface stack is a sibling of the game stage,
 * not a descendant - so ordinary propagation stops at the front lane and there is nothing to let
 * through. What crosses the gap is a copy of the event, aimed at whatever is under the same point
 * once everything belonging to this lane is discounted. That is one hit test rather than a second
 * layering model, so the lane behind is whichever the browser already paints there.
 *
 * Returns whether anything was found to hand it to.
 */
export function handOffInputToLaneBehind(input: {
    event: MouseEvent | WheelEvent;
    /** The shell of the lane that passed. Everything inside it is discounted. */
    surfaceRoot: Element;
}): boolean {
    const { event, surfaceRoot } = input;
    const ownerDocument = surfaceRoot.ownerDocument;
    if (!ownerDocument || typeof ownerDocument.elementsFromPoint !== "function") {
        return false;
    }
    const stack = ownerDocument.elementsFromPoint(event.clientX, event.clientY);
    const behind = stack.find(candidate => !surfaceRoot.contains(candidate) && candidate !== surfaceRoot);
    if (!behind) {
        return false;
    }
    const clone = cloneInputEvent(event);
    if (!clone) {
        return false;
    }
    inheritInputLaneVisits(event, clone);
    behind.dispatchEvent(clone);
    return true;
}
