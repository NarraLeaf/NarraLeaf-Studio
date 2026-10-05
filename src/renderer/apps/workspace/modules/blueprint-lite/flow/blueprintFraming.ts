/**
 * Framing the graph on the canvas as it is right now: the one place the canvas's live state is read
 * for {@link computeBlueprintZoomViewport}.
 *
 * Two callers frame a graph - the canvas when a graph is opened, and the zoom menu's modes - and they
 * have to land in the same place, or "fit" from the menu would move a graph that had only just been
 * fitted. Both also have to keep clear of the layer panel, which is drawn over the canvas's left edge:
 * React Flow's own `fitView` frames against the whole pane, so a newly opened graph (a template made
 * one a moment ago included) showed only the cards the panel did not cover. Framing one node, for
 * the ways of being sent to it, keeps clear of the panel the same way.
 *
 * Comments in English per project convention.
 */

import type { ReactFlowState } from "@xyflow/react";
import type { CanvasFitMode } from "@/lib/ui-editor/geometry";
import { measureEditorSidebarInset } from "@/lib/components/layout/editorSidebarInset";
import {
    boundsOfMeasuredNodes,
    computeBlueprintRevealViewport,
    computeBlueprintZoomViewport,
    type FlowViewport,
} from "./blueprintZoom";

type FramingState = Pick<ReactFlowState, "nodeLookup" | "width" | "height" | "minZoom" | "maxZoom" | "domNode">;

/**
 * The viewport that brings one node into the part of the canvas the layer panel leaves, keeping the
 * zoom in `current` unless the node would not fit at it; null while the node is not on the canvas,
 * has not been measured, or the pane has not been laid out.
 *
 * What every way of being sent to a node lands on - opening a blueprint at one from a writer list, a
 * search result or a diagnostic, and picking a diagnostic in the editor - so they frame alike. The
 * position read is the absolute one: a card inside a group frame stores its position relative to it.
 */
export function frameBlueprintNode(
    state: FramingState,
    nodeId: string,
    current: FlowViewport,
): FlowViewport | null {
    const node = state.nodeLookup.get(nodeId);
    const width = node?.measured.width ?? 0;
    const height = node?.measured.height ?? 0;
    if (!node || width <= 0 || height <= 0) {
        return null;
    }
    return computeBlueprintRevealViewport({
        node: { x: node.internals.positionAbsolute.x, y: node.internals.positionAbsolute.y, width, height },
        current,
        container: { width: state.width, height: state.height },
        range: { min: state.minZoom, max: state.maxZoom },
        inset: measureEditorSidebarInset(state.domNode),
    });
}

/** The viewport that answers `mode` for the graph on the canvas, or null while there is nothing to frame. */
export function frameBlueprintGraph(state: FramingState, mode: CanvasFitMode): FlowViewport | null {
    const bounds = boundsOfMeasuredNodes(
        [...state.nodeLookup.values()].map(node => ({
            x: node.internals.positionAbsolute.x,
            y: node.internals.positionAbsolute.y,
            width: node.measured.width ?? 0,
            height: node.measured.height ?? 0,
        })),
    );
    return computeBlueprintZoomViewport({
        mode,
        bounds,
        container: { width: state.width, height: state.height },
        range: { min: state.minZoom, max: state.maxZoom },
        inset: measureEditorSidebarInset(state.domNode),
    });
}
