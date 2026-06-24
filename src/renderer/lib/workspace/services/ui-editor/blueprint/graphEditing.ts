import type { BlueprintGraphEdge, BlueprintGraphIr, BlueprintGraphNode } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_FLOW_COMMENT,
    BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE,
    BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_COLOR,
    BLUEPRINT_NODE_TYPE_LITERAL_FLOAT,
    BLUEPRINT_NODE_TYPE_LITERAL_INTEGER,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LITERAL_RECT,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D,
} from "@shared/types/blueprint/graph";
import {
    isValidBlueprintExecConnection,
    resolveBlueprintNodeEditorCatalogEntryForNode,
} from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY } from "@/lib/ui-editor/blueprint-nodes/types";

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
        type === BLUEPRINT_NODE_TYPE_LITERAL_INTEGER ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_FLOAT ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_NUMBER ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_NULL ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_COLOR ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_RECT ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_JSON ||
        type === BLUEPRINT_NODE_TYPE_ELEMENT_REF ||
        type === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL
    );
}

export function isBlueprintElementBindingNodeType(type: string): boolean {
    return type === BLUEPRINT_NODE_TYPE_ELEMENT_REF || type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH;
}

export function isBlueprintElementBindingOutputPin(type: string, port: string): boolean {
    return port === "element" && isBlueprintElementBindingNodeType(type);
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
    const allowSourceFanOut = sourceNode
        ? isBlueprintLiteralNodeType(sourceNode.type) ||
            isBlueprintElementBindingOutputPin(sourceNode.type, connection.sourceHandle)
        : false;
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
    } else if (
        type === BLUEPRINT_NODE_TYPE_LITERAL_INTEGER ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_FLOAT ||
        type === BLUEPRINT_NODE_TYPE_LITERAL_NUMBER
    ) {
        base.params = { value: 0 };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN) {
        base.params = { value: "false" };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_NULL) {
        base.params = { value: null };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_COLOR) {
        base.params = { value: { r: 255, g: 255, b: 255, a: 1 } };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D) {
        base.params = { value: { x: 0, y: 0 } };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_RECT) {
        base.params = { value: { x: 0, y: 0, width: 0, height: 0 } };
    } else if (type === BLUEPRINT_NODE_TYPE_LITERAL_JSON) {
        base.params = { value: {} };
    } else if (type === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL) {
        base.params = { asset: null };
    } else if (type === BLUEPRINT_NODE_TYPE_ELEMENT_REF || type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH) {
        base.params = {};
    } else if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT) {
        base.params = {
            __jsonObjectInputPins: ["field_1_name", "field_1_value"],
            [BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY]: ["field_1_name"],
            field_1_name: "field1",
        };
    } else if (type === BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE) {
        base.params = {};
    } else if (type === BLUEPRINT_NODE_TYPE_FLOW_COMMENT) {
        base.params = {
            text: "Comment",
            color: "amber",
            background: true,
            width: 360,
            height: 180,
        };
    }
    return base;
}
