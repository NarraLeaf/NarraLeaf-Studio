import type { BlueprintGraphEdge, BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
} from "@shared/types/blueprint/graph";
import {
    isValidBlueprintExecConnection,
    resolveBlueprintNodeEditorCatalogEntryForNode,
} from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";

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

export function isBlueprintLiteralNodeType(type: string): boolean {
    return (
        type === BLUEPRINT_NODE_TYPE_LITERAL ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_STRING ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_NUMBER ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_NULL ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_JSON
    );
}

function isBlueprintExecInputPin(
    ir: Pick<BlueprintGraphIr, "nodes">,
    nodeId: string,
    portId: string,
): boolean {
    const node = ir.nodes?.[nodeId];
    if (!node) {
        return false;
    }
    const entry = resolveBlueprintNodeEditorCatalogEntryForNode(node.type, node.params);
    return entry.pins.some(pin => pin.id === portId && pin.kind === "input" && pin.semantic === "exec");
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
    ir: Pick<BlueprintGraphIr, "edges" | "nodes">,
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

    const sourceNode = ir.nodes?.[connection.source];
    const allowSourceFanOut = sourceNode ? isBlueprintLiteralNodeType(sourceNode.type) : false;
    const allowTargetFanIn = isBlueprintExecInputPin(ir, connection.target, connection.targetHandle);
    const withoutReplacedPinEdges = edges.filter(
        e =>
            (allowSourceFanOut ||
                !(e.from.nodeId === connection.source && e.from.port === connection.sourceHandle)) &&
            (allowTargetFanIn ||
                !(e.to.nodeId === connection.target && e.to.port === connection.targetHandle)),
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
    if (type === BLUEPRINT_NODE_TYPE_LITERAL || type === BLUEPRINT_NODE_TYPE_LITERAL_STRING) {
        base.params = { value: "" };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_NUMBER) {
        base.params = { value: 0 };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN) {
        base.params = { value: "false" };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_NULL) {
        base.params = { value: null };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_JSON) {
        base.params = { value: {} };
    }
    return base;
}
