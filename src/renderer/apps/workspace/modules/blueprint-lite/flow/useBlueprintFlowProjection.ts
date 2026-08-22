import { useMemo } from "react";
import { applyNodeChanges } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import type { BlueprintGraphEdge, BlueprintGraphIr } from "@shared/types/blueprint/document";
import { readNodeEditorLayout } from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintInspectorParamSelectOption } from "@/lib/ui-editor/blueprint-nodes/types";
import { blueprintEdgeStyle } from "@/lib/ui-editor/blueprint-graph-edge-style";
import {
    blueprintFrameContains,
    readBlueprintCommentSize,
    type BlueprintFrameRect,
} from "./blueprintGroupFrame";
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

/**
 * The cards drawn behind the graph: notes the author sent back, and every group frame.
 *
 * A frame has no layer to choose. It is a rectangle stretched around other cards, so level with
 * them the document's own order would decide what it covers - everything written before it - and
 * what covers it. That is the tint an author sees over their own nodes with nothing on screen to
 * explain it, and it is not a state a frame should be able to reach. `background` stays the note's
 * switch; a document that has it set on a frame is read the same way as every other frame.
 */
function isBackgroundLayerComment(node: Node<BlueprintFlowNodeData>): boolean {
    if (node.data.catalog.role !== "comment") {
        return false;
    }
    return node.data.params.frame === true || node.data.params.background === false;
}

/**
 * The stack the canvas is drawn in.
 *
 * Group frames and notes sent behind sit under everything, then the wires, then the cards. The
 * background band is wide because the cards in it are stacked among themselves as well; anything
 * nested deeper than the band simply shares its top rung, which is nesting no author will reach.
 */
export const BLUEPRINT_FLOW_Z_BACKGROUND = 0;
export const BLUEPRINT_FLOW_Z_BACKGROUND_TOP = 99;
export const BLUEPRINT_FLOW_Z_EDGE = 100;
export const BLUEPRINT_FLOW_Z_NODE = 101;
export const BLUEPRINT_FLOW_Z_NODE_SELECTED = 102;
/** The ghost that follows the cursor while a node is being placed: above every card it passes. */
export const BLUEPRINT_FLOW_Z_PLACEMENT_PREVIEW = 103;

function readBackgroundLayerRect(node: Node<BlueprintFlowNodeData>): BlueprintFrameRect {
    return {
        x: node.position.x,
        y: node.position.y,
        ...readBlueprintCommentSize(node.data.params),
    };
}

/**
 * Where each card behind the graph goes in that band: one rung per frame enclosing it.
 *
 * A group drawn inside another group belongs on top of it. Left level with the frame around it, the
 * order would fall to whichever card the document happened to list last, and the inner group would
 * be read through the outer one's tint - the blur an author sees after grouping inside a group.
 * Depth is counted from the geometry rather than stored, the same way membership is, so dragging a
 * frame out of another one re-stacks it with no bookkeeping to go stale.
 *
 * Frames that merely overlap stay level: neither encloses the other, so there is nothing to say
 * about which is in front.
 */
function backgroundLayerZIndex(rect: BlueprintFrameRect, enclosing: readonly BlueprintFrameRect[]): number {
    const depth = enclosing.filter(other => other !== rect && blueprintFrameContains(other, rect)).length;
    return Math.min(BLUEPRINT_FLOW_Z_BACKGROUND + depth, BLUEPRINT_FLOW_Z_BACKGROUND_TOP);
}

/** Every node's place in the stack, worked out from what is drawn behind what. */
function withBlueprintFlowNodeLayering(
    nodes: Node<BlueprintFlowNodeData>[],
): Node<BlueprintFlowNodeData>[] {
    const rects = new Map<string, BlueprintFrameRect>();
    for (const node of nodes) {
        if (isBackgroundLayerComment(node)) {
            rects.set(node.id, readBackgroundLayerRect(node));
        }
    }
    const background = [...rects.values()];
    return nodes.map(node => {
        const rect = rects.get(node.id);
        return {
            ...node,
            zIndex: rect ? backgroundLayerZIndex(rect, background) : BLUEPRINT_FLOW_Z_NODE,
        };
    });
}

/**
 * A group frame is a comment card stretched around other cards, so its middle is exactly where the
 * author's nodes are. React Flow gives every node wrapper `pointer-events: all`, which over that
 * area would mean a frame that quietly ate every click aimed at what it encloses - and every
 * marquee started inside it. Switching the wrapper off hands those pixels back; the card itself
 * turns the pointer on again for the two parts a frame is actually operated by, its title row and
 * its resize corner.
 */
export function blueprintFlowNodeStyle(
    role: string,
    params: Record<string, unknown>,
): { pointerEvents: "none" } | undefined {
    return role === "comment" && params.frame === true ? { pointerEvents: "none" } : undefined;
}

function readBlueprintFlowNodeZIndex(node: Node<BlueprintFlowNodeData>): number {
    if (isBackgroundLayerComment(node)) {
        // Selecting a frame leaves it where it is drawn. Lifting it over the cards it encloses
        // would hide them behind its tint for as long as it stayed picked.
        return typeof node.zIndex === "number" ? node.zIndex : BLUEPRINT_FLOW_Z_BACKGROUND;
    }
    return node.selected ? BLUEPRINT_FLOW_Z_NODE_SELECTED : BLUEPRINT_FLOW_Z_NODE;
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
 * Project IR to flow nodes without `selected` - selection must be applied via applyNodeChanges
 * so React Flow drag/selection state stays consistent (avoids error #015).
 */
export function blueprintIrToFlowNodes(
    ir: BlueprintGraphIr,
    nodeCatalog: IBlueprintNodeCatalogService,
    onPatchNodeParam?: BlueprintNodeParamPatch,
    memberVariables?: BlueprintFlowNodeData["memberVariables"],
    persistentVariables?: BlueprintFlowNodeData["persistentVariables"],
    savedVariables?: BlueprintFlowNodeData["savedVariables"],
    onAddDynamicInputPin?: (nodeId: string) => void,
    onRemoveDynamicInputPin?: (nodeId: string, pinId: string) => void,
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>,
    dynamicSelectOptionsByNodeId?: BlueprintDynamicSelectOptionsByNodeId,
    nodeDiagnosticsByNodeId?: ReadonlyMap<string, readonly BlueprintFlowNodeDiagnostic[]>,
    elementPreviews?: Record<string, BlueprintFlowNodeData["elementPreview"]>,
    displayableTargetVariantsByNodeId?: Record<string, BlueprintFlowNodeData["displayableTargetVariants"]>,
    onBindElementLiteral?: (nodeId: string) => void,
    onEditSaveSchema?: () => void,
): Node<BlueprintFlowNodeData>[] {
    const nodes = ir.nodes ?? {};
    const wiredIn = wiredInputPortIdsByNodeId(ir);
    const variableTypeContext: BlueprintGraphVariableTypeInferenceContext = {
        memberVariables,
        persistentVariables,
    };
    const flowNodes = Object.values(nodes).map(n => {
        const params = n.params ?? {};
        const inferredParams =
            withInferredBlueprintVariableValueTypeParam(n.type, params, variableTypeContext) ?? params;
        const catalog = nodeCatalog.resolveCatalogEntryForNode(n.type, inferredParams);
        return {
            id: n.id,
            type: "blueprint",
            position: readNodeEditorLayout(n),
            style: blueprintFlowNodeStyle(catalog.role ?? "", inferredParams),
            data: {
                catalog,
                nodeId: n.id,
                params: inferredParams,
                onPatchNodeParam,
                onAddDynamicInputPin,
                onRemoveDynamicInputPin,
                memberVariables,
                persistentVariables,
                savedVariables,
                wiredInputPortIds: wiredIn.get(n.id) ?? new Set(),
                dynamicSelectOptions: dynamicSelectOptionsByNodeId?.[n.id]
                    ? { ...dynamicSelectOptions, ...dynamicSelectOptionsByNodeId[n.id] }
                    : dynamicSelectOptions,
                nodeDiagnostics: nodeDiagnosticsByNodeId?.get(n.id) ?? [],
                elementPreview: elementPreviews?.[n.id],
                displayableTargetVariants: displayableTargetVariantsByNodeId?.[n.id],
                onBindElementLiteral,
                onEditSaveSchema,
            },
        };
    });
    return withBlueprintFlowNodeLayering(flowNodes);
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
            // Above every group frame: a wire crossing a group has to stay readable through it.
            zIndex: BLUEPRINT_FLOW_Z_EDGE,
            style: blueprintEdgeStyle(data),
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
    savedVariables?: BlueprintFlowNodeData["savedVariables"],
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
                        savedVariables,
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
            savedVariables,
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
