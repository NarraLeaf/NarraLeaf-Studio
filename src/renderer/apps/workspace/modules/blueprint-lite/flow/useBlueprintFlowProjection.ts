import { useMemo } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { readNodeEditorLayout } from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import { resolveBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import type { BlueprintFlowNodeData } from "./components/BlueprintFlowNode";

export function blueprintIrToFlowNodes(
    ir: BlueprintGraphIr,
    selectedNodeId: string | null,
): Node<BlueprintFlowNodeData>[] {
    const nodes = ir.nodes ?? {};
    return Object.values(nodes).map(n => ({
        id: n.id,
        type: "blueprint",
        position: readNodeEditorLayout(n),
        data: {
            catalog: resolveBlueprintNodeEditorCatalogEntry(n.type),
        },
        selected: selectedNodeId === n.id,
    }));
}

export function blueprintIrToFlowEdges(ir: BlueprintGraphIr): Edge[] {
    const edges = ir.edges ?? [];
    return edges.map((e, i) => ({
        id: `e:${i}:${e.from.nodeId}:${e.from.port}->${e.to.nodeId}:${e.to.port}`,
        source: e.from.nodeId,
        target: e.to.nodeId,
        sourceHandle: e.from.port,
        targetHandle: e.to.port,
    }));
}

export function useBlueprintFlowProjection(ir: BlueprintGraphIr, selectedNodeId: string | null) {
    return useMemo(
        () => ({
            nodes: blueprintIrToFlowNodes(ir, selectedNodeId),
            edges: blueprintIrToFlowEdges(ir),
        }),
        [ir, selectedNodeId],
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
