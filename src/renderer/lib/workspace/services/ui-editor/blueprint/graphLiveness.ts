/**
 * Which nodes of a graph something will actually ask to work.
 *
 * A report about a node that never runs is noise twice over: the author is told about a draft they
 * have not finished wiring, and `blueprint/unreachable-node` has already said the one thing worth
 * saying about it. Every check that judges a node's *contents* rather than its wiring asks this
 * first, so the canvas and the lint report agree about which nodes are in play.
 *
 * Comments in English per project convention.
 */

import type { BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_FN_HEAD,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    isBlueprintEventDispatchHeadType,
    isStoryActionCallHeadType,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";
import { collectExecReachableNodeIds } from "./fnCatalog";

/** A node execution can start at: an event head, a story action head, a Fn head, a function entry. */
export function isBlueprintGraphEntryNode(node: BlueprintGraphNode): boolean {
    return (
        isBlueprintEventDispatchHeadType(node.type) ||
        isStoryActionCallHeadType(node.type) ||
        node.type === BLUEPRINT_NODE_TYPE_FN_HEAD ||
        node.type === BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY
    );
}

/**
 * The nodes of one graph that will run, or be read by something that runs.
 *
 * Three cases, and the third is the one that is easy to forget:
 *
 *  - **Exec-reachable from an entry head.** The ordinary case.
 *  - **In a graph with no entry head at all** - a macro, whose entry is whoever invokes it - a node
 *    counts when anything is wired into it, because there is no head to walk from and refusing to
 *    judge the whole graph would be worse than reading its wiring.
 *  - **Read by a live node.** A value node has no exec input and is never "reached"; it runs when
 *    someone asks for its output. So liveness flows backwards along data edges from the nodes that
 *    are already live - one pass, because a chain of value nodes is walked to its far end.
 */
export function collectLiveBlueprintGraphNodeIds(ir: BlueprintGraphIr): ReadonlySet<string> {
    const nodes = ir.nodes ?? {};
    const edges = ir.edges ?? [];
    const entries = Object.values(nodes).filter(isBlueprintGraphEntryNode);
    const live = new Set<string>();
    if (entries.length > 0) {
        for (const entry of entries) {
            for (const nodeId of collectExecReachableNodeIds(ir, entry.id)) {
                live.add(nodeId);
            }
        }
    } else {
        for (const edge of edges) {
            live.add(edge.to.nodeId);
        }
    }
    // Backwards along DATA edges only. An exec edge into a live node comes from upstream in a chain
    // that was already walked forwards - except where it comes from an abandoned chain that happens
    // to join this one, and following that would mark a draft live and report its unfinished nodes.
    const queue = [...live];
    while (queue.length > 0) {
        const nodeId = queue.pop() as string;
        const dataInputPortIds = dataInputPortIdsOf(nodes[nodeId]);
        if (!dataInputPortIds) {
            continue;
        }
        for (const edge of edges) {
            if (edge.to.nodeId !== nodeId || !dataInputPortIds.has(edge.to.port) || live.has(edge.from.nodeId)) {
                continue;
            }
            live.add(edge.from.nodeId);
            queue.push(edge.from.nodeId);
        }
    }
    return live;
}

/** The node's data input pin ids, or null when the registry cannot resolve its type. */
function dataInputPortIdsOf(node: BlueprintGraphNode | undefined): ReadonlySet<string> | null {
    if (!node) {
        return null;
    }
    try {
        registerCoreBlueprintNodes();
        const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, node.params);
        return new Set(
            entry.pins.filter(pin => pin.kind === "input" && pin.semantic === "data").map(pin => pin.id),
        );
    } catch {
        return null;
    }
}
