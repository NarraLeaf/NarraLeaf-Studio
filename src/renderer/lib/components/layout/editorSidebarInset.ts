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
