/**
 * Canvas positions for nodes the text format did not place.
 *
 * A `.bp` file says nothing about where a card sits, and a graph whose nodes all land on 0,0 is
 * unreadable the moment someone opens it in Studio - so a compiled node gets a position from the
 * shape of the graph itself: how far it is from an entry point across the edges. The spacing
 * matches what the shipped skeleton uses, so a hand-written blueprint and a generated one look
 * alike on the canvas.
 *
 * Comments in English per project convention.
 */

const COLUMN_WIDTH = 280;
const ROW_HEIGHT = 150;

export type LayoutEdge = { from: string; to: string };

export function autoLayout(
    nodeIds: readonly string[],
    edges: readonly LayoutEdge[],
): Record<string, { x: number; y: number }> {
    const known = new Set(nodeIds);
    const real = edges.filter(edge => known.has(edge.from) && known.has(edge.to) && edge.from !== edge.to);

    // Longest path from a node with no inputs, relaxed rather than sorted topologically: these
    // graphs do contain cycles (a For Loop feeds its own body), and a sort would have to refuse
    // one instead of merely placing it a little arbitrarily.
    const depth = new Map<string, number>(nodeIds.map(id => [id, 0]));
    for (let round = 0; round < nodeIds.length; round += 1) {
        let changed = false;
        for (const edge of real) {
            const next = (depth.get(edge.from) as number) + 1;
            if (next > (depth.get(edge.to) as number)) {
                depth.set(edge.to, next);
                changed = true;
            }
        }
        if (!changed) {
            break;
        }
    }

    const perColumn = new Map<number, number>();
    const out: Record<string, { x: number; y: number }> = {};
    for (const id of nodeIds) {
        const column = depth.get(id) as number;
        const row = perColumn.get(column) ?? 0;
        perColumn.set(column, row + 1);
        out[id] = { x: column * COLUMN_WIDTH, y: row * ROW_HEIGHT };
    }
    return out;
}
