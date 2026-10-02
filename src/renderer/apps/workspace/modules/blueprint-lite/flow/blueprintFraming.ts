/**
 * Framing the graph on the canvas as it is right now: the one place the canvas's live state is read
 * for {@link computeBlueprintZoomViewport}.
 *
 * Two callers frame a graph - the canvas when a graph is opened, and the zoom menu's modes - and they
 * have to land in the same place, or "fit" from the menu would move a graph that had only just been
 * fitted. Both also have to keep clear of the layer panel, which is drawn over the canvas's left edge:
 * React Flow's own `fitView` frames against the whole pane, so a newly opened graph (a template made
 * one a moment ago included) showed only the cards the panel did not cover.
 *
 * Comments in English per project convention.
 */

import type { ReactFlowState } from "@xyflow/react";
import type { CanvasFitMode } from "@/lib/ui-editor/geometry";
import { measureEditorSidebarInset } from "@/lib/components/layout/editorSidebarInset";
import { boundsOfMeasuredNodes, computeBlueprintZoomViewport, type FlowViewport } from "./blueprintZoom";

type FramingState = Pick<ReactFlowState, "nodeLookup" | "width" | "height" | "minZoom" | "maxZoom" | "domNode">;

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
