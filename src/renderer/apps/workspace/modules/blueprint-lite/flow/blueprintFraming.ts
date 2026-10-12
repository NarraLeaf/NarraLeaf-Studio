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
 * And all of them frame in the part of the pane that is on screen. The editor area keeps its content
 * at a minimum size and crops what does not fit (`EDITOR_FLOOR` in the workspace layout), so with
 * both side docks open the canvas is laid out wider than the strip that shows it - and React Flow's
 * size is the laid-out one. Centred on that, a node landed in the cropped part, under the dock.
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
    type FlowRect,
    type FlowViewport,
} from "./blueprintZoom";

type FramingState = Pick<ReactFlowState, "nodeLookup" | "width" | "height" | "minZoom" | "maxZoom" | "domNode">;

/** Whether a computed `overflow-x` / `overflow-y` cuts off what lies outside the box. */
function clips(overflow: string): boolean {
    return overflow !== "" && overflow !== "visible";
}

/**
 * The part of `element` on screen, in its own pixels, or undefined when all of it is (or none of it,
 * which leaves nothing better to aim at than the whole of it).
 *
 * Every ancestor that clips is asked, and the window itself: what lies outside any of them is not
 * drawn.
 */
export function measureVisiblePane(element: Element | null | undefined): FlowRect | undefined {
    const view = element?.ownerDocument.defaultView;
    if (!element || !view) {
        return undefined;
    }
    const own = element.getBoundingClientRect();
    if (own.width <= 0 || own.height <= 0) {
        return undefined;
    }
    let left = Math.max(own.left, 0);
    let top = Math.max(own.top, 0);
    let right = Math.min(own.right, view.innerWidth);
    let bottom = Math.min(own.bottom, view.innerHeight);
    for (let node = element.parentElement; node; node = node.parentElement) {
        const style = view.getComputedStyle(node);
        const clipsX = clips(style.overflowX);
        const clipsY = clips(style.overflowY);
        if (!clipsX && !clipsY) {
            continue;
        }
        const box = node.getBoundingClientRect();
        if (clipsX) {
            left = Math.max(left, box.left);
            right = Math.min(right, box.right);
        }
        if (clipsY) {
            top = Math.max(top, box.top);
            bottom = Math.min(bottom, box.bottom);
        }
    }
    if (right <= left || bottom <= top) {
        return undefined;
    }
    const visible = { x: left - own.left, y: top - own.top, width: right - left, height: bottom - top };
    const whole = visible.x < 0.5 && visible.y < 0.5 && own.width - visible.width < 0.5 && own.height - visible.height < 0.5;
    return whole ? undefined : visible;
}

/**
 * The viewport that brings one node into the part of the canvas on screen that the layer panel
 * leaves, keeping the zoom in `current` unless the node would not fit at it; null while the node is
 * not on the canvas, has not been measured, or the pane has not been laid out.
 *
 * What every way of being sent to a node lands on - opening a blueprint at one from a writer list, a
 * search result or a diagnostic, picking a diagnostic in the editor, and following a wire to its far
 * end - so they frame alike. The position read is the absolute one: a card inside a group frame
 * stores its position relative to it.
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
        visible: measureVisiblePane(state.domNode),
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
        visible: measureVisiblePane(state.domNode),
    });
}
