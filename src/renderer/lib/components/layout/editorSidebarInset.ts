/**
 * How much of a canvas a sidebar drawn over its left edge covers, for the chrome floating on it.
 *
 * The UI editor's outline and the blueprint editor's layer panel are drawn over their canvases rather
 * than beside them (the canvas pans underneath), and both can be dragged wide. Chrome laid out against
 * the whole canvas - the tool bar pinned to the top right corner, the docker bar centred at the
 * bottom - then ends up over the sidebar's title row and its rows, or under the sidebar. So the
 * editor sets this property on the element the canvas and its chrome share, to the width the sidebar
 * is drawn at (`0px` while it is collapsed), and the chrome keeps to the rest. Where nothing sets it,
 * every reader falls back to `0px` and lays out against the whole canvas, as before.
 */
export const EDITOR_SIDEBAR_INSET_PROPERTY = "--nl-editor-sidebar-inset";

const INSET = `var(${EDITOR_SIDEBAR_INSET_PROPERTY}, 0px)`;

/**
 * `max-width` for chrome pinned 12px from the canvas's top right corner (`right-3`): it stops 12px
 * short of the sidebar, and wraps onto another row rather than reach over it.
 */
export const CANVAS_CORNER_CHROME_MAX_WIDTH = `calc(100% - ${INSET} - 24px)`;

/** `left` for chrome centred (with `-translate-x-1/2`) in the part of the canvas the sidebar leaves. */
export const CANVAS_FREE_CENTRE_LEFT = `calc(${INSET} + (100% - ${INSET}) / 2)`;

/**
 * `padding-left` for content that fills the canvas in place of what usually pans under the sidebar
 * - an empty state, say - so it is laid out in the part the sidebar leaves.
 */
export const CANVAS_SIDEBAR_INSET_PADDING = INSET;

/**
 * The inset in pixels, for a canvas that has to do arithmetic with it - framing a graph, say -
 * rather than lay chrome out against it.
 *
 * Measured, not parsed: the editor sets the property to the sidebar's own `clamp()`, which only the
 * layout engine can resolve. `element` is an element inside the one the property is set on, sized
 * like the canvas; 0 when nothing sets it.
 */
export function measureEditorSidebarInset(element: Element | null | undefined): number {
    if (!element) {
        return 0;
    }
    const probe = element.ownerDocument.createElement("div");
    probe.style.cssText = `position:absolute;left:0;top:0;height:0;visibility:hidden;pointer-events:none;width:${INSET}`;
    element.appendChild(probe);
    const width = probe.getBoundingClientRect().width;
    probe.remove();
    return Number.isFinite(width) ? width : 0;
}
