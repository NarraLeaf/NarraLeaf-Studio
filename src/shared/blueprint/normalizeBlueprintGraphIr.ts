/**
 * Pure IR normalization for blueprint graphs (shared: migration + renderer services).
 */

import type { BlueprintGraphIr, BlueprintGraphNode } from "../types/blueprint/document";
import {
    BLUEPRINT_GRAPH_IR_META_KIND,
    BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
    isBlueprintEventDispatchHeadType,
} from "../types/blueprint/graph";

function cloneIr(ir: BlueprintGraphIr | undefined): BlueprintGraphIr {
    if (!ir) {
        return { nodes: {}, edges: [] };
    }
    return {
        nodes: { ...(ir.nodes ?? {}) },
        edges: [...(ir.edges ?? [])],
        variables: ir.variables,
        meta: { ...ir.meta },
    };
}

/**
 * Ensure event graph IR has correct `meta.graphKind`.
 * New / empty layers stay empty (no auto-injected Event node); existing graphs are preserved as-is.
 */
export function ensureBlueprintEventGraphIrStructure(
    ir: BlueprintGraphIr | undefined,
    _generateId: () => string,
): BlueprintGraphIr {
    void _generateId;
    const g = cloneIr(ir);
    g.meta = { ...g.meta, [BLUEPRINT_GRAPH_IR_META_KIND]: "event" };

    const nodes = { ...(g.nodes ?? {}) };
    g.nodes = nodes;

    if (Object.keys(nodes).length === 0) {
        g.edges = [...(g.edges ?? [])];
        return g;
    }

    g.edges = [...(g.edges ?? [])];
    return g;
}

/**
 * Ensure a function graph has a dedicated Function entry node (execution starts from its `then` port).
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
        g.edges = [...(g.edges ?? [])];
    } else {
        g.edges = [...(g.edges ?? [])];
    }

    return g;
}

export function graphIrHasEventHead(ir: BlueprintGraphIr | undefined): boolean {
    const nodes = ir?.nodes ?? {};
    return Object.values(nodes).some(n => isBlueprintEventDispatchHeadType(n.type));
}

export function graphIrHasFunctionEntry(ir: BlueprintGraphIr | undefined): boolean {
    const nodes = ir?.nodes ?? {};
    return Object.values(nodes).some(n => n.type === BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY);
}
