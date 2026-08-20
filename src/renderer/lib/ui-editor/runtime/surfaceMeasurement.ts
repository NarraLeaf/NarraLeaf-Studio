/**
 * Measuring what is actually on screen, in the coordinates an author writes.
 *
 * The Displayable family answers from the document: `Get Bounds` adds up authored layout along the
 * parent chain. That is the right answer for "where did I put this", and the wrong one for "where
 * is it now" - it does not know about a motion in flight, a variant that moved the widget, a text
 * box that grew to fit its own words, or which row of a list an instance ended up on.
 *
 * This module answers the second question, and answers it in surface coordinates rather than
 * pixels. The author never sees the window: they placed a button at 640×360 on a 1280×720 surface,
 * and that is the number every other node in the graph speaks in. A rect reported in device pixels
 * would be a second coordinate system nobody asked for, and it would change when the player resized
 * the window without the widget having moved at all.
 *
 * The conversion runs off the surface shell (`[data-ui-surface-id]`), which is the same element the
 * pointer payload on every mouse event divides by - so a click reported at (640, 360) and a rect
 * measured here describe the same point.
 *
 * Comments in English per project convention.
 */

import { normalizeRectExtent, type BlueprintRect, type BlueprintVector2D } from "@shared/types/blueprint/valueTypes";

/** The design size of a surface, which is what its shell's measured box maps onto. */
export type SurfaceDesignSize = { width: number; height: number };

export type SurfaceDesignSizeLookup = (surfaceId: string) => SurfaceDesignSize | null | undefined;

export type MeasuredSurfaceRect = {
    /** The surface the measured instance turned out to live on. */
    surfaceId: string;
    /** The rect in that surface's coordinates. */
    rect: BlueprintRect;
};

/** A point in a surface's coordinates, and where it lands in the viewport. */
export type ClientPoint = { x: number; y: number };

function resolveDocument(root?: Document | null): Document | null {
    if (root) {
        return root;
    }
    return typeof window === "undefined" ? null : window.document;
}

/**
 * Escaping for an attribute selector.
 *
 * `CSS.escape` is the right tool and is present in every browser this runs in, but the same code is
 * imported by unit tests running without a DOM shim, so the fallback keeps the module loadable. Ids
 * are generated and hold no quotes, which is why dropping the two characters that could break the
 * selector is enough rather than a second escaping implementation.
 */
function escapeAttributeValue(value: string): string {
    const escape = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape : null;
    return escape ? escape(value) : value.replace(/["\\]/g, "");
}

function surfaceShellOf(node: Element): HTMLElement | null {
    return node.closest<HTMLElement>("[data-ui-surface-id]");
}

/**
 * The scale that turns viewport pixels into surface units, or null when the shell has no area.
 *
 * A shell measuring zero is a surface that has not been laid out yet - a page mid-transition, a
 * frame whose target has not mounted. Dividing by it would report Infinity, so callers are told
 * there is no answer instead of being handed one that is arithmetically valid and meaningless.
 */
function surfaceScale(shellRect: DOMRect, design: SurfaceDesignSize): { x: number; y: number } | null {
    if (shellRect.width <= 0 || shellRect.height <= 0 || design.width <= 0 || design.height <= 0) {
        return null;
    }
    return { x: design.width / shellRect.width, y: design.height / shellRect.height };
}

/**
 * Measure one widget, in the coordinates of the surface it sits on.
 *
 * ## Which instance
 *
 * One element id can be on screen more than once: every row of a list renders the same authored
 * widget, and a linked component instance carries the whole component's ids with it. The first
 * painted instance is the answer, and a zero-area one is skipped rather than reported - a hidden
 * widget is on screen at no size, and returning that box would send a pointer to the top-left
 * corner of the surface. Callers that need a particular row have to say which, and no caller does
 * yet, so this stays first-wins and says so rather than pretending the question does not exist.
 */
export function measureElementSurfaceRect(
    elementId: string,
    designSizeOf: SurfaceDesignSizeLookup,
    root?: Document | null,
): MeasuredSurfaceRect | null {
    const doc = resolveDocument(root);
    if (!doc || !elementId) {
        return null;
    }
    const nodes = doc.querySelectorAll<HTMLElement>(`[data-ui-element-id="${escapeAttributeValue(elementId)}"]`);
    for (const node of nodes) {
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
            continue;
        }
        const shell = surfaceShellOf(node);
        const surfaceId = shell?.dataset.uiSurfaceId;
        if (!shell || !surfaceId) {
            continue;
        }
        const design = designSizeOf(surfaceId);
        if (!design) {
            continue;
        }
        const shellRect = shell.getBoundingClientRect();
        const scale = surfaceScale(shellRect, design);
        if (!scale) {
            continue;
        }
        return {
            surfaceId,
            rect: normalizeRectExtent(
                (rect.left - shellRect.left) * scale.x,
                (rect.top - shellRect.top) * scale.y,
                rect.width * scale.x,
                rect.height * scale.y,
            ),
        };
    }
    return null;
}

/**
 * The other direction: a point an author named in surface coordinates, in viewport pixels.
 *
 * Needed by anything that has to leave the page with a position - moving the system cursor is the
 * only caller today. It is deliberately the exact inverse of the measurement above, so "the centre
 * of this button" round-trips instead of landing a pixel or two off after a scale change.
 */
export function surfacePointToClientPoint(
    surfaceId: string,
    point: BlueprintVector2D,
    designSizeOf: SurfaceDesignSizeLookup,
    root?: Document | null,
): ClientPoint | null {
    const doc = resolveDocument(root);
    if (!doc || !surfaceId) {
        return null;
    }
    const design = designSizeOf(surfaceId);
    if (!design) {
        return null;
    }
    const shell = doc.querySelector<HTMLElement>(`[data-ui-surface-id="${escapeAttributeValue(surfaceId)}"]`);
    if (!shell) {
        return null;
    }
    const shellRect = shell.getBoundingClientRect();
    const scale = surfaceScale(shellRect, design);
    if (!scale) {
        return null;
    }
    return {
        x: shellRect.left + point.x / scale.x,
        y: shellRect.top + point.y / scale.y,
    };
}
