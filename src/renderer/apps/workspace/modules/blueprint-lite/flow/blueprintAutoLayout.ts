/**
 * "Format graph": rearrange a blueprint's nodes into readable left-to-right layers.
 *
 * A blueprint reads the way its wires run - execution enters a card on the left and leaves on the
 * right - so tidying one is a layered (Sugiyama-style) layout along that same axis, not a grid.
 * Three passes, in the order they matter:
 *
 *  1. **Layers.** Longest path from the roots, then a tightening sweep that pulls every node as far
 *     right as its successors allow. Without the sweep a literal feeding step 9 lands in layer 0
 *     beside the event head, with a wire crossing the whole graph to reach the card it belongs to.
 *  2. **Order and vertical position, together.** Each pass gives a node the average height of the
 *     neighbours already placed, sorts the layer by it, then stacks the layer top to bottom with a
 *     fixed gap. Sorting by the same number that positions is what keeps the two from disagreeing -
 *     an ordering pass that ranked A above B and a placement pass that wanted B higher would
 *     produce a layer whose wires cross for no reason. Forward (from inputs) and backward (from
 *     outputs) alternate so both ends of a wire get a say.
 *  3. **Islands.** A graph is usually several disconnected pieces - an event head and its chain, a
 *     handful of helper nodes. Each is laid out on its own and they are stacked down the page in
 *     the order the author already had them, so formatting never shuffles which one is on top.
 *
 * All three describe the horizontal layout, which is the one a blueprint is drawn for. A vertical
 * one is the same layout with the page turned: transpose the cards, run those passes, transpose the
 * answer back. Doing it that way rather than parameterising every axis in the passes is what keeps
 * the two directions from drifting apart - there is one layout here, and only one of them can have
 * a bug.
 *
 * Deliberately no dependency: dagre and elk are an order of magnitude more layout than a blueprint
 * graph needs, and a pure function over boxes and edges is what makes this testable without
 * mounting React Flow.
 *
 * Cycles are expected - a loop body wiring back into its own head - and are handled by dropping the
 * back edges a depth-first walk finds before layering. Those wires still route; they just do not
 * get a vote on which layer anything lands in.
 *
 * Comments in English per project convention.
 */

/** A node as the layout sees it: identity, where it is now, and how big it measured. */
export type BlueprintLayoutBox = {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
};

export type BlueprintLayoutEdge = { from: string; to: string };

/**
 * Which way the layers run: `horizontal` walks them left to right, the way pins are drawn and the
 * way a blueprint is normally read; `vertical` walks them down the page, which suits a long chain
 * with little branching on a tall window.
 */
export type BlueprintLayoutDirection = "horizontal" | "vertical";

export type BlueprintLayoutOptions = {
    /** Which way the layers advance. Defaults to `horizontal`. */
    direction?: BlueprintLayoutDirection;
    /** Room between one layer and the next, along the direction the layers advance. */
    layerGap?: number;
    /** Room between two cards in the same layer, across that direction. */
    nodeGap?: number;
    /** Room between two disconnected islands, across that direction. */
    componentGap?: number;
};

export type BlueprintLayoutPositions = Record<string, { x: number; y: number }>;

const DEFAULT_LAYER_GAP = 90;
const DEFAULT_NODE_GAP = 40;
const DEFAULT_COMPONENT_GAP = 120;

/** Enough sweeps to settle a graph this size; further passes stop changing the answer. */
const REFINEMENT_PASSES = 3;

/**
 * Reading order for everything that has to be deterministic: down the page, then across, then by
 * id so two cards at the same point never swap between runs.
 */
function readingOrder(a: BlueprintLayoutBox, b: BlueprintLayoutBox): number {
    if (a.y !== b.y) {
        return a.y - b.y;
    }
    if (a.x !== b.x) {
        return a.x - b.x;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function mean(values: number[]): number {
    let sum = 0;
    for (const value of values) {
        sum += value;
    }
    return sum / values.length;
}

/**
 * Arrange `boxes` and answer with each one's new top-left corner.
 *
 * Anchored at the top-left of what the graph already occupied, so formatting moves the cards
 * without moving the graph out from under the viewport.
 */
export function layoutBlueprintGraph(
    boxes: readonly BlueprintLayoutBox[],
    edges: readonly BlueprintLayoutEdge[],
    options: BlueprintLayoutOptions = {},
): BlueprintLayoutPositions {
    if (boxes.length === 0) {
        return {};
    }

    if (options.direction === "vertical") {
        // Turn the page, lay the graph out the only way this file knows how, and turn it back. The
        // gaps transpose with everything else: `layerGap` still separates one layer from the next,
        // which down here means vertically.
        const turned = layoutBlueprintGraph(boxes.map(transpose), edges, { ...options, direction: "horizontal" });
        const positions: BlueprintLayoutPositions = {};
        for (const [id, point] of Object.entries(turned)) {
            positions[id] = { x: point.y, y: point.x };
        }
        return positions;
    }

    const layerGap = options.layerGap ?? DEFAULT_LAYER_GAP;
    const nodeGap = options.nodeGap ?? DEFAULT_NODE_GAP;
    const componentGap = options.componentGap ?? DEFAULT_COMPONENT_GAP;

    const ordered = [...boxes].sort(readingOrder);
    const byId = new Map(ordered.map(box => [box.id, box]));
    const rank = new Map(ordered.map((box, index) => [box.id, index]));

    const links = normalizeEdges(edges, byId);
    const islands = weaklyConnectedComponents(ordered, links);

    const originX = Math.min(...ordered.map(box => box.x));
    const originY = Math.min(...ordered.map(box => box.y));

    const positions: BlueprintLayoutPositions = {};
    let cursorY = originY;

    for (const ids of islands) {
        const local = layoutIsland(ids, byId, rank, links, { layerGap, nodeGap });
        let bottom = 0;
        for (const id of ids) {
            const point = local[id]!;
            positions[id] = { x: originX + point.x, y: cursorY + point.y };
            bottom = Math.max(bottom, point.y + byId.get(id)!.height);
        }
        cursorY += bottom + componentGap;
    }

    return positions;
}

/** Swap a box's two axes, so a layout that only runs left to right can be read top to bottom. */
function transpose(box: BlueprintLayoutBox): BlueprintLayoutBox {
    return { id: box.id, x: box.y, y: box.x, width: box.height, height: box.width };
}

/** Drop self-loops, duplicates, and edges naming a node that is not being laid out. */
function normalizeEdges(
    edges: readonly BlueprintLayoutEdge[],
    byId: ReadonlyMap<string, BlueprintLayoutBox>,
): BlueprintLayoutEdge[] {
    const seen = new Set<string>();
    const out: BlueprintLayoutEdge[] = [];
    for (const edge of edges) {
        if (edge.from === edge.to || !byId.has(edge.from) || !byId.has(edge.to)) {
            continue;
        }
        const key = `${edge.from}\u0000${edge.to}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        out.push(edge);
    }
    return out;
}

/**
 * Islands, each in reading order, the islands themselves ordered by their topmost card - which is
 * what keeps a formatted graph recognisable: the chain that was at the top is still at the top.
 */
function weaklyConnectedComponents(
    ordered: readonly BlueprintLayoutBox[],
    edges: readonly BlueprintLayoutEdge[],
): string[][] {
    const neighbours = new Map<string, string[]>();
    for (const box of ordered) {
        neighbours.set(box.id, []);
    }
    for (const edge of edges) {
        neighbours.get(edge.from)!.push(edge.to);
        neighbours.get(edge.to)!.push(edge.from);
    }

    const seen = new Set<string>();
    const islands: string[][] = [];
    for (const box of ordered) {
        if (seen.has(box.id)) {
            continue;
        }
        const island: string[] = [];
        const stack = [box.id];
        seen.add(box.id);
        while (stack.length > 0) {
            const id = stack.pop()!;
            island.push(id);
            for (const next of neighbours.get(id)!) {
                if (!seen.has(next)) {
                    seen.add(next);
                    stack.push(next);
                }
            }
        }
        islands.push(island);
    }
    return islands;
}

type IslandLinks = {
    successors: Map<string, string[]>;
    predecessors: Map<string, string[]>;
};

/**
 * Forward edges only: a depth-first walk marks the edges pointing back into the path being
 * explored and leaves them out, so what the layering sees is a DAG.
 */
function acyclicLinks(ids: readonly string[], edges: readonly BlueprintLayoutEdge[]): IslandLinks {
    const member = new Set(ids);
    const raw = new Map<string, string[]>();
    for (const id of ids) {
        raw.set(id, []);
    }
    for (const edge of edges) {
        if (member.has(edge.from) && member.has(edge.to)) {
            raw.get(edge.from)!.push(edge.to);
        }
    }

    const successors = new Map<string, string[]>();
    const predecessors = new Map<string, string[]>();
    for (const id of ids) {
        successors.set(id, []);
        predecessors.set(id, []);
    }

    const state = new Map<string, 0 | 1 | 2>();
    for (const id of ids) {
        state.set(id, 0);
    }

    // Iterative: an author's graph gets long rather than wide, which is exactly the shape that
    // overflows a recursive walk's stack.
    for (const root of ids) {
        if (state.get(root) !== 0) {
            continue;
        }
        const stack: { id: string; index: number }[] = [{ id: root, index: 0 }];
        state.set(root, 1);
        while (stack.length > 0) {
            const frame = stack[stack.length - 1]!;
            const outgoing = raw.get(frame.id)!;
            if (frame.index >= outgoing.length) {
                state.set(frame.id, 2);
                stack.pop();
                continue;
            }
            const next = outgoing[frame.index]!;
            frame.index += 1;
            if (state.get(next) === 1) {
                // A back edge closes a loop, so it cannot also decide which layer `next` is in.
                continue;
            }
            successors.get(frame.id)!.push(next);
            predecessors.get(next)!.push(frame.id);
            if (state.get(next) === 0) {
                state.set(next, 1);
                stack.push({ id: next, index: 0 });
            }
        }
    }

    return { successors, predecessors };
}

/** Kahn's algorithm over the forward edges, ties broken by reading order so the result is stable. */
function topologicalOrder(
    ids: readonly string[],
    links: IslandLinks,
    rank: ReadonlyMap<string, number>,
): string[] {
    const remaining = new Map<string, number>();
    for (const id of ids) {
        remaining.set(id, links.predecessors.get(id)!.length);
    }
    const ready = ids.filter(id => remaining.get(id) === 0).sort((a, b) => rank.get(a)! - rank.get(b)!);
    const out: string[] = [];
    while (ready.length > 0) {
        const id = ready.shift()!;
        out.push(id);
        for (const next of links.successors.get(id)!) {
            const left = remaining.get(next)! - 1;
            remaining.set(next, left);
            if (left === 0) {
                // Keep the queue in reading order rather than in push order.
                const at = ready.findIndex(other => rank.get(other)! > rank.get(next)!);
                if (at === -1) {
                    ready.push(next);
                } else {
                    ready.splice(at, 0, next);
                }
            }
        }
    }
    // A node still held back sat on a cycle the back-edge walk could not open. Append it, so the
    // layout covers every node it was handed rather than silently dropping one.
    const placed = new Set(out);
    for (const id of ids) {
        if (!placed.has(id)) {
            out.push(id);
        }
    }
    return out;
}

function layoutIsland(
    ids: readonly string[],
    byId: ReadonlyMap<string, BlueprintLayoutBox>,
    rank: ReadonlyMap<string, number>,
    edges: readonly BlueprintLayoutEdge[],
    gaps: { layerGap: number; nodeGap: number },
): Record<string, { x: number; y: number }> {
    const sorted = [...ids].sort((a, b) => rank.get(a)! - rank.get(b)!);
    const links = acyclicLinks(sorted, edges);
    const order = topologicalOrder(sorted, links, rank);

    // Longest path from the roots, then pull each node right until a successor stops it.
    const layer = new Map<string, number>();
    for (const id of order) {
        const preds = links.predecessors.get(id)!;
        layer.set(id, preds.length === 0 ? 0 : Math.max(...preds.map(p => (layer.get(p) ?? 0) + 1)));
    }
    for (let i = order.length - 1; i >= 0; i -= 1) {
        const id = order[i]!;
        const succs = links.successors.get(id)!;
        if (succs.length > 0) {
            layer.set(id, Math.min(...succs.map(s => layer.get(s)!)) - 1);
        }
    }

    const depth = Math.max(...sorted.map(id => layer.get(id)!)) + 1;
    const layers: string[][] = Array.from({ length: depth }, () => []);
    for (const id of sorted) {
        layers[layer.get(id)!]!.push(id);
    }

    // A column is as wide as its widest card, so a fat card never overlaps the next layer.
    const columnX: number[] = [];
    let x = 0;
    for (const column of layers) {
        columnX.push(x);
        x += Math.max(...column.map(id => byId.get(id)!.width)) + gaps.layerGap;
    }

    const centre = new Map<string, number>();
    for (const id of sorted) {
        const box = byId.get(id)!;
        centre.set(id, box.y + box.height / 2);
    }

    const place = (column: string[], desired: ReadonlyMap<string, number>) => {
        column.sort((a, b) => {
            const delta = desired.get(a)! - desired.get(b)!;
            return delta !== 0 ? delta : rank.get(a)! - rank.get(b)!;
        });
        let bottom = Number.NEGATIVE_INFINITY;
        for (const id of column) {
            const height = byId.get(id)!.height;
            const top = Math.max(desired.get(id)! - height / 2, bottom + gaps.nodeGap);
            centre.set(id, top + height / 2);
            bottom = top + height;
        }
        // Stacking only ever pushes down, so a layer whose cards all wanted the same height ends up
        // entirely below it - and the next layer, averaging those, wants to be lower still. Left
        // alone the whole graph walks down the page a little further on every pass and never
        // settles. Re-centring the layer on what it asked for cancels that: two branches out of one
        // card end up symmetrical about it, and the card they rejoin at lands back on its axis.
        const drift = mean(column.map(id => centre.get(id)! - desired.get(id)!));
        if (drift !== 0) {
            for (const id of column) {
                centre.set(id, centre.get(id)! - drift);
            }
        }
    };

    const desiredFrom = (column: readonly string[], side: "predecessors" | "successors") => {
        const desired = new Map<string, number>();
        for (const id of column) {
            const neighbours = links[side].get(id)!;
            desired.set(id, neighbours.length > 0 ? mean(neighbours.map(n => centre.get(n)!)) : centre.get(id)!);
        }
        return desired;
    };

    for (let pass = 0; pass < REFINEMENT_PASSES; pass += 1) {
        for (let k = 0; k < layers.length; k += 1) {
            place(layers[k]!, desiredFrom(layers[k]!, "predecessors"));
        }
        for (let k = layers.length - 1; k >= 0; k -= 1) {
            place(layers[k]!, desiredFrom(layers[k]!, "successors"));
        }
    }

    const top = Math.min(...sorted.map(id => centre.get(id)! - byId.get(id)!.height / 2));
    const positions: Record<string, { x: number; y: number }> = {};
    for (let k = 0; k < layers.length; k += 1) {
        for (const id of layers[k]!) {
            const box = byId.get(id)!;
            positions[id] = {
                x: Math.round(columnX[k]!),
                y: Math.round(centre.get(id)! - box.height / 2 - top),
            };
        }
    }
    return positions;
}
