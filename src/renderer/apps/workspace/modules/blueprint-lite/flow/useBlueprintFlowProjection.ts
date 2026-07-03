import { useMemo } from "react";
import { applyNodeChanges } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import type { BlueprintGraphEdge, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { readNodeEditorLayout } from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintInspectorParamSelectOption } from "@/lib/ui-editor/blueprint-nodes/types";
import type { BlueprintFlowNodeData, BlueprintFlowNodeDiagnostic } from "./components/BlueprintFlowNode";
import {
    withInferredBlueprintVariableValueTypeParam,
    type BlueprintGraphVariableTypeInferenceContext,
} from "@/lib/workspace/services/ui-editor/blueprint/graphVariableTypeInference";

type BlueprintNodeParamHistoryOptions = { mergeKey?: string; mergeWindowMs?: number };
type BlueprintNodeParamPatch = (
    nodeId: string,
    key: string,
    value: unknown,
    history?: BlueprintNodeParamHistoryOptions,
) => void;

export type BlueprintDynamicSelectOptionsByNodeId = Record<
    string,
    Record<string, BlueprintInspectorParamSelectOption[]>
>;

function isBackgroundLayerComment(node: Node<BlueprintFlowNodeData>): boolean {
    return node.data.catalog.role === "comment" && node.data.params.background === false;
}

function readBlueprintFlowNodeZIndex(node: Node<BlueprintFlowNodeData>): number {
    if (isBackgroundLayerComment(node)) {
        return 0;
    }
    return node.selected ? 2 : 1;
}

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
    onPatchNodeParam?: BlueprintNodeParamPatch,
    memberVariables?: BlueprintFlowNodeData["memberVariables"],
    persistentVariables?: BlueprintFlowNodeData["persistentVariables"],
    onAddDynamicInputPin?: (nodeId: string) => void,
    onRemoveDynamicInputPin?: (nodeId: string, pinId: string) => void,
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>,
    dynamicSelectOptionsByNodeId?: BlueprintDynamicSelectOptionsByNodeId,
    nodeDiagnosticsByNodeId?: ReadonlyMap<string, readonly BlueprintFlowNodeDiagnostic[]>,
    elementPreviews?: Record<string, BlueprintFlowNodeData["elementPreview"]>,
    displayableTargetVariantsByNodeId?: Record<string, BlueprintFlowNodeData["displayableTargetVariants"]>,
    onBindElementLiteral?: (nodeId: string) => void,
): Node<BlueprintFlowNodeData>[] {
    const nodes = ir.nodes ?? {};
    const wiredIn = wiredInputPortIdsByNodeId(ir);
    const variableTypeContext: BlueprintGraphVariableTypeInferenceContext = {
        memberVariables,
        persistentVariables,
    };
    return Object.values(nodes).map(n => {
        const params = n.params ?? {};
        const inferredParams =
            withInferredBlueprintVariableValueTypeParam(n.type, params, variableTypeContext) ?? params;
        const catalog = nodeCatalog.resolveCatalogEntryForNode(n.type, inferredParams);
        const backgroundEnabled = params.background !== false;
        return {
            id: n.id,
            type: "blueprint",
            position: readNodeEditorLayout(n),
            zIndex: catalog.role === "comment" && !backgroundEnabled ? 0 : 1,
            data: {
                catalog,
                nodeId: n.id,
                params: inferredParams,
                onPatchNodeParam,
                onAddDynamicInputPin,
                onRemoveDynamicInputPin,
                memberVariables,
                persistentVariables,
                wiredInputPortIds: wiredIn.get(n.id) ?? new Set(),
                dynamicSelectOptions: dynamicSelectOptionsByNodeId?.[n.id]
                    ? { ...dynamicSelectOptions, ...dynamicSelectOptionsByNodeId[n.id] }
                    : dynamicSelectOptions,
                nodeDiagnostics: nodeDiagnosticsByNodeId?.get(n.id) ?? [],
                elementPreview: elementPreviews?.[n.id],
                displayableTargetVariants: displayableTargetVariantsByNodeId?.[n.id],
                onBindElementLiteral,
            },
        };
    });
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

export function applyBlueprintFlowNodeSelection(
    nodes: Node<BlueprintFlowNodeData>[],
    selectedNodeIds: readonly string[],
): Node<BlueprintFlowNodeData>[] {
    const selected = new Set(selectedNodeIds);
    const withSelection = applyNodeChanges(
        nodes.map(n => ({
            type: "select" as const,
            id: n.id,
            selected: selected.has(n.id),
        })),
        nodes,
    );
    return withSelection.map(n => ({ ...n, zIndex: readBlueprintFlowNodeZIndex(n) }));
}

export function blueprintElementPreviewsSignature(
    elementPreviews: Record<string, BlueprintFlowNodeData["elementPreview"]> | undefined,
): string {
    return Object.entries(elementPreviews ?? {})
        .map(([nodeId, item]) =>
            `${nodeId}:${item?.revisionKey ?? ""}:${item?.name ?? ""}:${item?.type ?? ""}:${item?.text ?? ""}:${
                item?.layout?.width ?? ""
            }:${item?.layout?.height ?? ""}`,
        )
        .sort()
        .join("\x1e");
}

export function blueprintDynamicSelectOptionsByNodeSignature(
    optionsByNodeId: BlueprintDynamicSelectOptionsByNodeId | undefined,
): string {
    return Object.entries(optionsByNodeId ?? {})
        .flatMap(([nodeId, sources]) =>
            Object.entries(sources).map(([sourceId, options]) =>
                `${nodeId}:${sourceId}:${options.map(option => `${option.value}:${option.label}`).join("\x1f")}`,
            ),
        )
        .sort()
        .join("\x1e");
}

function isDataEdge(
    ir: BlueprintGraphIr,
    e: BlueprintGraphEdge,
    nodeCatalog: IBlueprintNodeCatalogService,
    variableTypeContext?: BlueprintGraphVariableTypeInferenceContext,
): boolean {
    const fromNode = ir.nodes?.[e.from.nodeId];
    if (!fromNode) {
        return false;
    }
    const params =
        withInferredBlueprintVariableValueTypeParam(fromNode.type, fromNode.params ?? {}, variableTypeContext) ??
        fromNode.params ??
        {};
    const cat = nodeCatalog.resolveCatalogEntryForNode(fromNode.type, params);
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

export function blueprintIrToFlowEdges(
    ir: BlueprintGraphIr,
    nodeCatalog: IBlueprintNodeCatalogService,
    variableTypeContext?: BlueprintGraphVariableTypeInferenceContext,
): Edge[] {
    const edges = ir.edges ?? [];
    return edges.map((e, i) => {
        const data = isDataEdge(ir, e, nodeCatalog, variableTypeContext);
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
    onPatchNodeParam?: BlueprintNodeParamPatch,
    memberVariables?: BlueprintFlowNodeData["memberVariables"],
    persistentVariables?: BlueprintFlowNodeData["persistentVariables"],
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>,
    dynamicSelectOptionsByNodeId?: BlueprintDynamicSelectOptionsByNodeId,
    nodeDiagnosticsByNodeId?: ReadonlyMap<string, readonly BlueprintFlowNodeDiagnostic[]>,
    displayableTargetVariantsByNodeId?: Record<string, BlueprintFlowNodeData["displayableTargetVariants"]>,
) {
    const selectedKey = blueprintSelectedNodesDependencyKey(selectedNodeIds);
    return useMemo(
        () => {
            const variableTypeContext: BlueprintGraphVariableTypeInferenceContext = {
                memberVariables,
                persistentVariables,
            };
            return {
                nodes: applyBlueprintFlowNodeSelection(
                    blueprintIrToFlowNodes(
                        ir,
                        nodeCatalog,
                        onPatchNodeParam,
                        memberVariables,
                        persistentVariables,
                        undefined,
                        undefined,
                        dynamicSelectOptions,
                        dynamicSelectOptionsByNodeId,
                        nodeDiagnosticsByNodeId,
                        undefined,
                        displayableTargetVariantsByNodeId,
                    ),
                    selectedNodeIds,
                ),
                edges: blueprintIrToFlowEdges(ir, nodeCatalog, variableTypeContext),
            };
        },
        [
            ir,
            selectedKey,
            nodeCatalog,
            onPatchNodeParam,
            memberVariables,
            persistentVariables,
            selectedNodeIds,
            dynamicSelectOptions,
            dynamicSelectOptionsByNodeId,
            nodeDiagnosticsByNodeId,
            displayableTargetVariantsByNodeId,
        ],
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
