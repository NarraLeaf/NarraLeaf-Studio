/**
 * Where a pointer event landed, in the local design space of each element it reaches.
 *
 * An element's pointer heads report `x` / `y` in that element's own box: its top-left corner is 0,0
 * and its authored size is the far corner, whatever the surface is scaled to on screen. A press
 * reaches more than one element - it is answered by every element on its way up the tree that has a
 * head for it (`devModeBlueprintHostAdapter`) - and each of them is owed the point in its own box.
 * Handing every ancestor the box of the element that happened to be under the pointer made a panel's
 * click read different numbers depending on which of its children was hit.
 *
 * So the point is read once, as the press arrives, for every drawn element between the one hit and
 * the surface it is in, and the walk up the tree looks each one up as it gets there. Read up front
 * rather than as the walk arrives, because the walk awaits each element's graphs in turn: a graph on
 * the button that moves the panel it sits in would otherwise change where the panel says it was
 * pressed.
 *
 * Comments in English per project convention.
 */

/** A point in one element's own design space. */
export type UIElementPointerPoint = { x: number; y: number };

/** The press, for the element with this id on its way up, or null for one it never reaches. */
export type UIElementPointerPositions = (elementId: string) => UIElementPointerPoint | null;

const UI_ELEMENT_ID_ATTR = "data-ui-element-id";
/** Where one surface's elements end: a page, a frame's page, a Game UI slot. */
const UI_SURFACE_ID_ATTR = "data-ui-surface-id";

type BoxLike = { left: number; top: number; width: number; height: number };

/**
 * A client point in the design space of a box drawn at `box` on screen and authored at
 * `designWidth` x `designHeight`.
 *
 * The ratio of the two sizes undoes whatever scale the box is drawn at - the surface fitted to the
 * window, an element's own scale - so the answer is in authored pixels either way.
 */
export function localPointerPoint(
    box: BoxLike,
    designWidth: number,
    designHeight: number,
    clientX: number,
    clientY: number,
): UIElementPointerPoint {
    const width = Math.max(1, Math.abs(designWidth));
    const height = Math.max(1, Math.abs(designHeight));
    const scaleX = box.width > 0 ? width / box.width : 1;
    const scaleY = box.height > 0 ? height / box.height : 1;
    return {
        x: (clientX - box.left) * scaleX,
        y: (clientY - box.top) * scaleY,
    };
}

/**
 * Read the press at `clientX`, `clientY` for `hit` and every drawn element that contains it, up to
 * the surface they are drawn on.
 *
 * Each element is found by the id its wrapper carries, nearest first, which is the drawing the press
 * is in: a row's or a placement's copy of an element is the one around the element that was hit, and
 * the walk up the document tree visits exactly those. A wrapper's authored size is its layout box
 * (`offsetWidth` / `offsetHeight`, which no transform changes), the same size the element measures
 * its own press against.
 */
export function readElementPointerPositions(hit: Element, clientX: number, clientY: number): UIElementPointerPositions {
    const points = new Map<string, UIElementPointerPoint>();
    for (let node: Element | null = hit; node; node = node.parentElement) {
        if (node.hasAttribute(UI_SURFACE_ID_ATTR)) {
            break;
        }
        const elementId = node.getAttribute(UI_ELEMENT_ID_ATTR);
        if (!elementId || points.has(elementId)) {
            continue;
        }
        const box = node.getBoundingClientRect();
        const html = node as HTMLElement;
        const designWidth = html.offsetWidth > 0 ? html.offsetWidth : box.width;
        const designHeight = html.offsetHeight > 0 ? html.offsetHeight : box.height;
        points.set(elementId, localPointerPoint(box, designWidth, designHeight, clientX, clientY));
    }
    return elementId => points.get(elementId) ?? null;
}

/**
 * The payload an element reached by bubbling is handed: the same press, its `x` / `y` read in that
 * element's own box. A payload with no position (a click raised from the keyboard) and an element the
 * press has no point for are left as they are.
 */
export function pointerPayloadFor(
    payload: Record<string, unknown> | undefined,
    elementId: string,
    positions: UIElementPointerPositions | undefined,
): Record<string, unknown> | undefined {
    if (!payload || !positions || typeof payload.x !== "number" || typeof payload.y !== "number") {
        return payload;
    }
    const point = positions(elementId);
    return point ? { ...payload, x: point.x, y: point.y } : payload;
}
