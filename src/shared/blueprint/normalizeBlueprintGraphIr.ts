/**
 * Pure IR normalization for blueprint graphs (shared: migration + renderer services).
 * Comments in English per project convention.
 */

import type { BlueprintGraphIr, BlueprintGraphNode } from "../types/blueprint/document";
import {
    BLUEPRINT_GRAPH_IR_META_KIND,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
} from "../types/blueprint/graph";

function cloneIr(ir: BlueprintGraphIr | undefined): BlueprintGraphIr {
    if (!ir) {
        return { entries: {}, nodes: {}, edges: [] };
    }
    return {
        entries: ir.entries ?? {},
        nodes: { ...(ir.nodes ?? {}) },
        edges: [...(ir.edges ?? [])],
        variables: ir.variables,
        meta: { ...ir.meta },
    };
}

/**
 * Ensure an event graph has exactly one visible event head, correct `meta.graphKind`, and `entries.main` pointing at the head.
 * Optionally links head → previous entry target when inserting a head into a legacy graph.
 */
export function ensureBlueprintEventGraphIrStructure(
    ir: BlueprintGraphIr | undefined,
    generateId: () => string,
): BlueprintGraphIr {
    const g = cloneIr(ir);
    g.meta = { ...g.meta, [BLUEPRINT_GRAPH_IR_META_KIND]: "event" };

    const nodes = { ...(g.nodes ?? {}) };
    g.nodes = nodes;

    let headId = Object.entries(nodes).find(([, n]) => n.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD)?.[0];

    const prevMainStart = g.entries?.main?.start;

    if (!headId) {
        headId = generateId();
        const headNode: BlueprintGraphNode = {
            id: headId,
            type: BLUEPRINT_NODE_TYPE_EVENT_HEAD,
            params: {},
            meta: {
                editorLayout: { x: 80, y: 120 },
            },
        };
        nodes[headId] = headNode;

        const edges = [...(g.edges ?? [])];
        if (prevMainStart?.nodeId && nodes[prevMainStart.nodeId] && prevMainStart.nodeId !== headId) {
            const dup = edges.some(e => e.from.nodeId === headId && e.to.nodeId === prevMainStart.nodeId);
            if (!dup) {
                edges.push({
                    from: { nodeId: headId, port: "then" },
                    to: { nodeId: prevMainStart.nodeId, port: prevMainStart.port || "in" },
                });
            }
        }
        g.edges = edges;
    }

    g.entries = {
        ...(g.entries ?? {}),
        main: {
            start: { nodeId: headId, port: "then" },
        },
    };

    return g;
}

/**
 * Ensure a function graph has a dedicated entry node and `entries.main` pointing at it.
 */
export function ensureBlueprintFunctionGraphIrStructure(
    ir: BlueprintGraphIr | undefined,
    generateId: () => string,
): BlueprintGraphIr {
    const g = cloneIr(ir);
    g.meta = { ...g.meta, [BLUEPRINT_GRAPH_IR_META_KIND]: "function" };

    const nodes = { ...(g.nodes ?? {}) };
    g.nodes = nodes;

    let entryId = Object.entries(nodes).find(([, n]) => n.type === BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY)?.[0];
    const prevMainStart = g.entries?.main?.start;

    if (!entryId) {
        entryId = generateId();
        nodes[entryId] = {
            id: entryId,
            type: BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
            params: {},
            meta: {
                editorLayout: { x: 80, y: 120 },
            },
        };
        const edges = [...(g.edges ?? [])];
        if (prevMainStart?.nodeId && nodes[prevMainStart.nodeId] && prevMainStart.nodeId !== entryId) {
            const dup = edges.some(e => e.from.nodeId === entryId && e.to.nodeId === prevMainStart.nodeId);
            if (!dup) {
                edges.push({
                    from: { nodeId: entryId, port: "then" },
                    to: { nodeId: prevMainStart.nodeId, port: prevMainStart.port || "in" },
                });
            }
        }
        g.edges = edges;
    }

    g.entries = {
        ...(g.entries ?? {}),
        main: {
            start: { nodeId: entryId, port: "then" },
        },
    };

    return g;
}

export function graphIrHasEventHead(ir: BlueprintGraphIr | undefined): boolean {
    const nodes = ir?.nodes ?? {};
    return Object.values(nodes).some(n => n.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD);
}

export function graphIrHasFunctionEntry(ir: BlueprintGraphIr | undefined): boolean {
    const nodes = ir?.nodes ?? {};
    return Object.values(nodes).some(n => n.type === BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY);
}
