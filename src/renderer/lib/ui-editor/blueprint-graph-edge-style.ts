/**
 * How a blueprint edge is drawn, in the one place both canvases read it from.
 *
 * There are two of those canvases: the editor's (`useBlueprintFlowProjection`) and the Dev Mode
 * debugger's read-only view. They must agree - the debugger exists to show an author the graph they
 * wrote, and a wire that changes colour between the two windows reads as a different wire.
 *
 * These are literal hex rather than design-system tokens on purpose, and it is the one place in the
 * renderer where that is the right answer. `stroke` here is an SVG paint handed to React Flow as an
 * inline style, not a Tailwind class, so it can carry no `var(--nl-*)` indirection through the token
 * layer; and the two colours are not surface chrome, they are the *type* of a connection - exec
 * versus data - the same way a syntax theme colours a keyword. They are deliberately equally legible
 * on both the light and dark canvas, which is why neither follows the theme.
 */

/** An execution wire: the order nodes run in. */
export const BLUEPRINT_EXEC_EDGE_COLOR = "#22d3ee";

/** A data wire: a value travelling into a pin. */
export const BLUEPRINT_DATA_EDGE_COLOR = "#f59e0b";

export const BLUEPRINT_EDGE_STROKE_WIDTH = 1.5;

/** The inline style for one edge, by what it carries. */
export function blueprintEdgeStyle(isData: boolean): { stroke: string; strokeWidth: number } {
    return {
        stroke: isData ? BLUEPRINT_DATA_EDGE_COLOR : BLUEPRINT_EXEC_EDGE_COLOR,
        strokeWidth: BLUEPRINT_EDGE_STROKE_WIDTH,
    };
}
