/**
 * What the four zoom modes mean for a node graph.
 *
 * The surface editor answers them against an interface's authored size, which never changes while
 * the author looks at it. A graph has no such size: the thing being fitted is the bounding box of
 * whatever nodes exist right now, and that box moves every time a node is dragged. So here the
 * modes are one-shot actions rather than the standing modes the surface editor keeps live - a "fit"
 * that re-ran on every node drag would yank the canvas out from under the author mid-gesture.
 *
 * Comments in English per project convention.
 */

import type { CanvasFitMode, ZoomRange } from "@/lib/ui-editor/geometry";

/** React Flow's viewport: the graph is drawn at `flowPoint * zoom + {x, y}`. */
export type FlowViewport = { x: number; y: number; zoom: number };

export type FlowRect = { x: number; y: number; width: number; height: number };

/**
 * Breathing room around a fitted graph, as the fraction React Flow's `fitView` reads a bare number
 * as: the content gets `size / (1 + padding)` of the pane on each axis.
 *
 * The same 0.18 the canvas opens a graph at, so "fit" from the menu lands where opening it does.
 */
export const BLUEPRINT_FIT_PADDING = 0.18;

/** One node, reduced to what framing it needs: where it sits and how big it turned out. */
export type MeasuredNode = { x: number; y: number; width: number; height: number };

/**
 * The box containing every node, or `null` when there is nothing measurable in the graph.
 *
 * Hand-rolled rather than `getNodesBounds`, in either of its two forms. Both read `measured` off
 * the node they are handed, and the nodes this canvas rebuilds on each document revision carry no
 * measurement - so both answer with the span of the node *positions*, every box collapsed to a
 * point. That answer is a plausible-looking rectangle, centred where the real one is and merely
 * smaller, so a fit computed from it reads as "the zoom overshoots" rather than as a wrong box.
 * The sizes only ever exist on the internal nodes in the store's lookup, so that is what the caller
 * passes in.
 */
export function boundsOfMeasuredNodes(nodes: Iterable<MeasuredNode>): FlowRect | null {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of nodes) {
        if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
            continue;
        }
        const width = Number.isFinite(node.width) ? node.width : 0;
        const height = Number.isFinite(node.height) ? node.height : 0;
        minX = Math.min(minX, node.x);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x + width);
        maxY = Math.max(maxY, node.y + height);
    }
    if (minX === Infinity) {
        return null;
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export type ComputeBlueprintZoomParams = {
    mode: CanvasFitMode;
    /** Bounding box of the nodes, in graph coordinates; `null` for a graph with nothing in it. */
    bounds: FlowRect | null;
    /** The pane the graph is drawn in, in screen pixels. */
    container: { width: number; height: number };
    /** What the canvas will accept; React Flow clamps to this anyway, so the caller must not lie. */
    range: ZoomRange;
    padding?: number;
};

/**
 * The viewport that answers `mode` for a graph, centred on its nodes.
 *
 * Returns `null` when there is nothing to measure - an empty graph has no bounding box worth
 * pointing a camera at, and a pane that has not been laid out yet reports 0x0.
 */
export function computeBlueprintZoomViewport({
    mode,
    bounds,
    container,
    range,
    padding = BLUEPRINT_FIT_PADDING,
}: ComputeBlueprintZoomParams): FlowViewport | null {
    if (
        !Number.isFinite(container.width) ||
        !Number.isFinite(container.height) ||
        container.width <= 0 ||
        container.height <= 0
    ) {
        return null;
    }
    if (
        !bounds ||
        !Number.isFinite(bounds.width) ||
        !Number.isFinite(bounds.height) ||
        bounds.width <= 0 ||
        bounds.height <= 0
    ) {
        return null;
    }

    // Padding is breathing room, and a mode whose whole point is to leave no empty side must not
    // have any: "fill" that stopped short of the edges would be answering a different question.
    const padded = mode === "cover" ? 1 : 1 + padding;
    const byWidth = container.width / (padded * bounds.width);
    const byHeight = container.height / (padded * bounds.height);
    const rawZoom =
        mode === "actual" ? 1
            : mode === "width" ? byWidth
                : mode === "cover" ? Math.max(byWidth, byHeight)
                    : Math.min(byWidth, byHeight);
    const zoom = Math.max(range.min, Math.min(range.max, rawZoom));

    return {
        zoom,
        x: container.width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: container.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    };
}

/** Holds a zoom inside what the canvas accepts, so the box never shows a value it cannot reach. */
export function clampBlueprintZoom(scale: number, range: ZoomRange): number {
    if (!Number.isFinite(scale)) {
        return range.min;
    }
    return Math.max(range.min, Math.min(range.max, scale));
}
