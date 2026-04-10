import { useMemo } from "react";
import { applyNodeChanges } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import type { BlueprintGraphEdge, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { readNodeEditorLayout } from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintFlowNodeData } from "./components/BlueprintFlowNode";

function wiredInputPortIdsByNodeId(ir: BlueprintGraphIr): Map<string, Set<string>> {
    const m = new Map<string, Set<string>>();
    for (const e of ir.edges ?? []) {
        let s = m.get(e.to.nodeId);
        if (!s) {
            s = new Set();
            m.set(e.to.nodeId, s);
        }
        s.add(e.to.port);
    }
    return m;
}

/**
 * Project IR to flow nodes without `selected` — selection must be applied via applyNodeChanges
 * so React Flow drag/selection state stays consistent (avoids error #015).
 */
export function blueprintIrToFlowNodes(
    ir: BlueprintGraphIr,
    nodeCatalog: IBlueprintNodeCatalogService,
    onPatchNodeParam?: (nodeId: string, key: string, value: unknown) => void,
    memberVariables?: Array<{ id: string; name: string }>,
): Node<BlueprintFlowNodeData>[] {
    const nodes = ir.nodes ?? {};
    const wiredIn = wiredInputPortIdsByNodeId(ir);
    return Object.values(nodes).map(n => ({
        id: n.id,
        type: "blueprint",
        position: readNodeEditorLayout(n),
        data: {
            catalog: nodeCatalog.resolveCatalogEntry(n.type),
            nodeId: n.id,
            params: n.params ?? {},
            onPatchNodeParam,
            memberVariables,
            wiredInputPortIds: wiredIn.get(n.id) ?? new Set(),
        },
    }));
}

/** Stable key for effect deps when the selected id *set* changes (order ignored). */
export function blueprintSelectedNodesDependencyKey(selectedNodeIds: readonly string[]): string {
    return [...selectedNodeIds].sort().join("\0");
}

export function blueprintSelectionIdsEqual(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((id, i) => id === sb[i]!);
}

export function applyBlueprintFlowNodeSelection<NodeType extends Node<BlueprintFlowNodeData>>(
    nodes: NodeType[],
    selectedNodeIds: readonly string[],
): NodeType[] {
    const selected = new Set(selectedNodeIds);
    return applyNodeChanges(
        nodes.map(n => ({
            type: "select" as const,
            id: n.id,
            selected: selected.has(n.id),
        })),
        nodes,
    );
}

function isDataEdge(
    ir: BlueprintGraphIr,
    e: BlueprintGraphEdge,
    nodeCatalog: IBlueprintNodeCatalogService,
): boolean {
    const fromNode = ir.nodes?.[e.from.nodeId];
    if (!fromNode) {
        return false;
    }
    const cat = nodeCatalog.resolveCatalogEntry(fromNode.type);
    const pin = cat.pins.find(p => p.id === e.from.port && p.kind === "output");
    return pin?.semantic === "data";
}

/** Stable fingerprint of edge topology so React Flow state can be preserved when IR sync is a no-op. */
export function blueprintFlowEdgesTopologySignature(edges: Pick<Edge, "source" | "target" | "sourceHandle" | "targetHandle">[]): string {
    return [...edges]
        .map(e => `${e.source}\0${e.sourceHandle ?? ""}\0${e.target}\0${e.targetHandle ?? ""}`)
        .sort()
        .join("\x1e");
}

export function blueprintIrToFlowEdges(ir: BlueprintGraphIr, nodeCatalog: IBlueprintNodeCatalogService): Edge[] {
    const edges = ir.edges ?? [];
    return edges.map((e, i) => {
        const data = isDataEdge(ir, e, nodeCatalog);
        return {
            id: `e:${i}:${e.from.nodeId}:${e.from.port}->${e.to.nodeId}:${e.to.port}`,
            source: e.from.nodeId,
            target: e.to.nodeId,
            sourceHandle: e.from.port,
            targetHandle: e.to.port,
            selectable: true,
            focusable: true,
            interactionWidth: 24,
            style: data ? { stroke: "#f59e0b", strokeWidth: 1.5 } : { stroke: "#22d3ee", strokeWidth: 1.5 },
        };
    });
}

export function useBlueprintFlowProjection(
    ir: BlueprintGraphIr,
    selectedNodeIds: readonly string[],
    nodeCatalog: IBlueprintNodeCatalogService,
    onPatchNodeParam?: (nodeId: string, key: string, value: unknown) => void,
    memberVariables?: Array<{ id: string; name: string }>,
) {
    const selectedKey = blueprintSelectedNodesDependencyKey(selectedNodeIds);
    return useMemo(
        () => ({
            nodes: applyBlueprintFlowNodeSelection(
                blueprintIrToFlowNodes(ir, nodeCatalog, onPatchNodeParam, memberVariables),
                selectedNodeIds,
            ),
            edges: blueprintIrToFlowEdges(ir, nodeCatalog),
        }),
        [ir, selectedKey, nodeCatalog, onPatchNodeParam, memberVariables, selectedNodeIds],
    );
}

/** Apply node position writes from a React Flow node list back onto BlueprintGraphNode records. */
export function applyFlowPositionsToIr(ir: BlueprintGraphIr, rfNodes: Node[]): void {
    const map = new Map(rfNodes.map(n => [n.id, n]));
    const nodes = ir.nodes ?? {};
    for (const [id, gn] of Object.entries(nodes)) {
        const rf = map.get(id);
        if (!rf) {
            continue;
        }
        gn.meta = {
            ...gn.meta,
            editorLayout: { x: rf.position.x, y: rf.position.y },
        };
    }
}
