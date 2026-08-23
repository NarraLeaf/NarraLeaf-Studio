/**
 * What each node is painted as in the graph overview.
 *
 * A minimap earns its corner by answering two questions at a glance - what shape is this graph, and
 * where am I in it - and it answers neither if every node is the same block of colour. Two rules
 * follow from that:
 *
 *  - **A group frame is a region, not a card.** It is the largest rectangle in the graph, and React
 *    Flow's minimap draws nodes in array order without consulting `zIndex`, so a frame painted
 *    solid covers exactly the cards it was drawn to gather. It gets its own colour at the weight of
 *    a wash, with the frame's border to say where the region ends.
 *  - **Cards are neutral.** The accent is spoken for elsewhere in this canvas - exec wires, the
 *    selected tab, a lit pin - and a grid of saturated blocks at this size outweighs the graph it
 *    summarises. Only the viewport rectangle stays bright, because "where am I" is the one thing
 *    the map is read for.
 *
 * Comments in English per project convention.
 */

import type { Node } from "@xyflow/react";
import { BLUEPRINT_COMMENT_COLORS, resolveBlueprintCommentColorKey } from "@/lib/ui-editor/blueprint-comment-colors";
import type { BlueprintFlowNodeData } from "./components/BlueprintFlowNode";

type BlueprintMinimapNode = Node<BlueprintFlowNodeData>;

function commentColor(node: BlueprintMinimapNode) {
    return BLUEPRINT_COMMENT_COLORS[resolveBlueprintCommentColorKey(node.data?.params?.color)]!;
}

function isCommentNode(node: BlueprintMinimapNode): boolean {
    return node.data?.catalog?.role === "comment";
}

/** The fill for one node: a group's own tint, a selected card, or the neutral every other card is. */
export function blueprintMinimapNodeFill(node: BlueprintMinimapNode): string {
    if (isCommentNode(node)) {
        // The title band's colour rather than the frame's body: same hue, low enough alpha that the
        // cards inside the region stay legible through it.
        return commentColor(node).header;
    }
    if (node.selected) {
        return "rgb(var(--nl-fg))";
    }
    return "rgb(var(--nl-fg-subtle))";
}

/** The outline for one node. Only a region needs one; a card is its fill. */
export function blueprintMinimapNodeStroke(node: BlueprintMinimapNode): string {
    return isCommentNode(node) ? commentColor(node).border : "transparent";
}
