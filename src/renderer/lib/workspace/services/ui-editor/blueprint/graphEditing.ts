import type { BlueprintGraphEdge, BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import { isValidBlueprintExecConnection } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";

export {
    ensureBlueprintEventGraphIrStructure,
    ensureBlueprintFunctionGraphIrStructure,
    graphIrHasEventHead,
    graphIrHasFunctionEntry,
} from "@shared/blueprint/normalizeBlueprintGraphIr";

/**
 * Normalize optional BlueprintGraphIr fields for in-place editing.
 */
export function ensureBlueprintGraphIr(ir: BlueprintGraphIr | undefined): BlueprintGraphIr {
    if (!ir) {
        return { nodes: {}, edges: [] };
    }
    delete (ir as { entries?: unknown }).entries;
    if (!ir.nodes) {
        ir.nodes = {};
    }
    if (!ir.edges) {
        ir.edges = [];
    }
    return ir;
}

export type EditorNodeLayout = { x: number; y: number };

const LAYOUT_KEY = "editorLayout";

export function readNodeEditorLayout(node: BlueprintGraphNode): EditorNodeLayout {
    const raw = node.meta?.[LAYOUT_KEY];
    if (raw && typeof raw === "object" && "x" in raw && "y" in raw) {
        const x = Number((raw as { x: unknown }).x);
        const y = Number((raw as { y: unknown }).y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return { x, y };
        }
    }
    return { x: 0, y: 0 };
}

export function writeNodeEditorLayout(node: BlueprintGraphNode, pos: EditorNodeLayout): void {
    node.meta = { ...node.meta, [LAYOUT_KEY]: { x: pos.x, y: pos.y } };
}

/**
 * Whether a React Flow connection is allowed (exec↔exec and data↔data with optional type match).
 */
export function isValidBlueprintIrExecConnection(
    ir: BlueprintGraphIr,
    p: {
        source: string | null | undefined;
        target: string | null | undefined;
        sourceHandle: string | null | undefined;
        targetHandle: string | null | undefined;
    },
): boolean {
    if (p.source === p.target) {
        return false;
    }
    const srcNode = ir.nodes?.[p.source ?? ""];
    const tgtNode = ir.nodes?.[p.target ?? ""];
    if (!srcNode || !tgtNode || !p.sourceHandle || !p.targetHandle) {
        return false;
    }
    return isValidBlueprintExecConnection({
        sourceType: srcNode.type,
        sourcePort: p.sourceHandle,
        targetType: tgtNode.type,
        targetPort: p.targetHandle,
        sourceParams: srcNode.params,
        targetParams: tgtNode.params,
    });
}

export function applyBlueprintIrConnection(
    ir: Pick<BlueprintGraphIr, "edges">,
    connection: {
        source: string;
        target: string;
        sourceHandle: string;
        targetHandle: string;
    },
): BlueprintGraphEdge[] {
    const edges = ir.edges ?? [];
    if (connection.source === connection.target) {
        return edges;
    }

    const sameEdge = (e: BlueprintGraphEdge) =>
        e.from.nodeId === connection.source &&
        e.from.port === connection.sourceHandle &&
        e.to.nodeId === connection.target &&
        e.to.port === connection.targetHandle;

    if (edges.some(sameEdge)) {
        return edges;
    }

    const withoutReplacedPinEdges = edges.filter(
        e =>
            !(e.from.nodeId === connection.source && e.from.port === connection.sourceHandle) &&
            !(e.to.nodeId === connection.target && e.to.port === connection.targetHandle),
    );

    return [
        ...withoutReplacedPinEdges,
        {
            from: { nodeId: connection.source, port: connection.sourceHandle },
            to: { nodeId: connection.target, port: connection.targetHandle },
        },
    ];
}

export function createGraphNodeForPalette(type: string, id: string): BlueprintGraphNode {
    const base: BlueprintGraphNode = {
        id,
        type,
        params: {},
        meta: {
            editorLayout: { x: 140 + Math.random() * 60, y: 100 + Math.random() * 60 },
        },
    };
    if (type === "blueprint.data.literal") {
        base.params = { value: "" };
    }
    return base;
}
