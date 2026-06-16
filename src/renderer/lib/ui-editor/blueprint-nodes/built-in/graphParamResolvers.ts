/**
 * Resolve wired / inspector params for nodes that read from the graph IR.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_MATH_ADD,
    BLUEPRINT_NODE_TYPE_MATH_DECREMENT,
    BLUEPRINT_NODE_TYPE_MATH_DIVIDE,
    BLUEPRINT_NODE_TYPE_MATH_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_GREATER,
    BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_INCREMENT,
    BLUEPRINT_NODE_TYPE_MATH_LESS,
    BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_MULTIPLY,
    BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_SUBTRACT,
    BLUEPRINT_NODE_TYPE_STRING_CONCAT,
    BLUEPRINT_NODE_TYPE_STRING_LENGTH,
    BLUEPRINT_NODE_TYPE_STRING_TO_LOWER,
    BLUEPRINT_NODE_TYPE_STRING_TO_UPPER,
    BLUEPRINT_NODE_TYPE_STRING_TRIM,
} from "@shared/types/blueprint/graph";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { resolveEffectiveBlueprintNodePins } from "../effectivePins";

const MAX_RESOLVE_DEPTH = 32;

const MATH_RESULT_OPS: Record<string, "add" | "subtract" | "multiply" | "divide"> = {
    [BLUEPRINT_NODE_TYPE_MATH_ADD]: "add",
    [BLUEPRINT_NODE_TYPE_MATH_SUBTRACT]: "subtract",
    [BLUEPRINT_NODE_TYPE_MATH_MULTIPLY]: "multiply",
    [BLUEPRINT_NODE_TYPE_MATH_DIVIDE]: "divide",
};

const MATH_UNARY_OPS: Record<string, "increment" | "decrement"> = {
    [BLUEPRINT_NODE_TYPE_MATH_INCREMENT]: "increment",
    [BLUEPRINT_NODE_TYPE_MATH_DECREMENT]: "decrement",
};

const MATH_COMPARE_OPS: Record<string, "eq" | "ne" | "lt" | "lte" | "gt" | "gte"> = {
    [BLUEPRINT_NODE_TYPE_MATH_EQUAL]: "eq",
    [BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL]: "ne",
    [BLUEPRINT_NODE_TYPE_MATH_LESS]: "lt",
    [BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL]: "lte",
    [BLUEPRINT_NODE_TYPE_MATH_GREATER]: "gt",
    [BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL]: "gte",
};

type StringPureOp = "concat" | "length" | "trim" | "toUpper" | "toLower";

const STRING_RESULT_OPS: Record<string, StringPureOp> = {
    [BLUEPRINT_NODE_TYPE_STRING_CONCAT]: "concat",
    [BLUEPRINT_NODE_TYPE_STRING_LENGTH]: "length",
    [BLUEPRINT_NODE_TYPE_STRING_TRIM]: "trim",
    [BLUEPRINT_NODE_TYPE_STRING_TO_UPPER]: "toUpper",
    [BLUEPRINT_NODE_TYPE_STRING_TO_LOWER]: "toLower",
};

function toFiniteNumber(v: unknown): number {
    if (typeof v === "number" && Number.isFinite(v)) {
        return v;
    }
    if (typeof v === "boolean") {
        return v ? 1 : 0;
    }
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) {
            return n;
        }
    }
    return NaN;
}

function resolveMathAddVariadic(
    graph: DataPinGraph,
    nodeId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
): unknown {
    const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_MATH_ADD);
    if (!def) {
        return NaN;
    }
    const pins = resolveEffectiveBlueprintNodePins(def, params);
    const dataIn = pins.filter(p => p.kind === "input" && p.semantic === "data");
    let acc: number | null = null;
    for (const pin of dataIn) {
        const v = resolveDataPinValue(graph, nodeId, pin.id, params, blueprintLocals, depth + 1);
        const n = toFiniteNumber(v);
        if (Number.isNaN(n)) {
            return NaN;
        }
        acc = acc === null ? n : acc + n;
    }
    return acc === null ? NaN : acc;
}

function resolveMathNodeResult(
    graph: DataPinGraph,
    nodeId: string,
    op: "add" | "subtract" | "multiply" | "divide",
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
): unknown {
    if (op === "add" && graph.nodes?.[nodeId]?.type === BLUEPRINT_NODE_TYPE_MATH_ADD) {
        return resolveMathAddVariadic(graph, nodeId, params, blueprintLocals, depth);
    }
    const a = resolveDataPinValue(graph, nodeId, "a", params, blueprintLocals, depth + 1);
    const b = resolveDataPinValue(graph, nodeId, "b", params, blueprintLocals, depth + 1);
    const na = toFiniteNumber(a);
    const nb = toFiniteNumber(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
        return NaN;
    }
    switch (op) {
        case "add":
            return na + nb;
        case "subtract":
            return na - nb;
        case "multiply":
            return na * nb;
        case "divide":
            return na / nb;
        default:
            return NaN;
    }
}

function resolveMathUnaryResult(
    graph: DataPinGraph,
    nodeId: string,
    op: "increment" | "decrement",
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
): unknown {
    const v = resolveDataPinValue(graph, nodeId, "value", params, blueprintLocals, depth + 1);
    const n = toFiniteNumber(v);
    if (Number.isNaN(n)) {
        return NaN;
    }
    return op === "increment" ? n + 1 : n - 1;
}

function resolveMathCompareResult(
    graph: DataPinGraph,
    nodeId: string,
    op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte",
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
): unknown {
    const a = resolveDataPinValue(graph, nodeId, "a", params, blueprintLocals, depth + 1);
    const b = resolveDataPinValue(graph, nodeId, "b", params, blueprintLocals, depth + 1);
    const na = toFiniteNumber(a);
    const nb = toFiniteNumber(b);
    const aNaN = Number.isNaN(na);
    const bNaN = Number.isNaN(nb);
    if (aNaN || bNaN) {
        if (op === "eq") {
            return false;
        }
        if (op === "ne") {
            return true;
        }
        return false;
    }
    switch (op) {
        case "eq":
            return na === nb;
        case "ne":
            return na !== nb;
        case "lt":
            return na < nb;
        case "lte":
            return na <= nb;
        case "gt":
            return na > nb;
        case "gte":
            return na >= nb;
        default:
            return false;
    }
}

function toBlueprintString(v: unknown): string {
    if (v === undefined || v === null) {
        return "";
    }
    return String(v);
}

function resolveStringPureResult(
    graph: DataPinGraph,
    nodeId: string,
    op: StringPureOp,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
): unknown {
    switch (op) {
        case "concat": {
            const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_STRING_CONCAT);
            if (!def) {
                return "";
            }
            const pins = resolveEffectiveBlueprintNodePins(def, params);
            const dataIn = pins.filter(p => p.kind === "input" && p.semantic === "data");
            let s = "";
            for (const pin of dataIn) {
                s += toBlueprintString(
                    resolveDataPinValue(graph, nodeId, pin.id, params, blueprintLocals, depth + 1),
                );
            }
            return s;
        }
        case "length":
            return toBlueprintString(
                resolveDataPinValue(graph, nodeId, "value", params, blueprintLocals, depth + 1),
            ).length;
        case "trim":
            return toBlueprintString(
                resolveDataPinValue(graph, nodeId, "value", params, blueprintLocals, depth + 1),
            ).trim();
        case "toUpper":
            return toBlueprintString(
                resolveDataPinValue(graph, nodeId, "value", params, blueprintLocals, depth + 1),
            ).toUpperCase();
        case "toLower":
            return toBlueprintString(
                resolveDataPinValue(graph, nodeId, "value", params, blueprintLocals, depth + 1),
            ).toLowerCase();
        default:
            return "";
    }
}

export type DataPinGraph = {
    edges?: Array<{ from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }>;
    nodes?: Record<string, { type: string; params?: Record<string, unknown> }>;
};

/**
 * Resolve the value feeding an input data pin (literal chain, Get Var, or param fallback).
 */
export function resolveDataPinValue(
    graph: DataPinGraph,
    consumerNodeId: string,
    consumerPortId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth = 0,
): unknown {
    if (depth > MAX_RESOLVE_DEPTH) {
        return undefined;
    }
    const selfNode = graph.nodes?.[consumerNodeId];
    if (selfNode && consumerPortId === "result") {
        const mathOp = MATH_RESULT_OPS[selfNode.type];
        if (mathOp) {
            return resolveMathNodeResult(
                graph,
                consumerNodeId,
                mathOp,
                selfNode.params ?? {},
                blueprintLocals,
                depth,
            );
        }
        const mathUnary = MATH_UNARY_OPS[selfNode.type];
        if (mathUnary) {
            return resolveMathUnaryResult(
                graph,
                consumerNodeId,
                mathUnary,
                selfNode.params ?? {},
                blueprintLocals,
                depth,
            );
        }
        const mathCompare = MATH_COMPARE_OPS[selfNode.type];
        if (mathCompare) {
            return resolveMathCompareResult(
                graph,
                consumerNodeId,
                mathCompare,
                selfNode.params ?? {},
                blueprintLocals,
                depth,
            );
        }
        const stringOp = STRING_RESULT_OPS[selfNode.type];
        if (stringOp) {
            return resolveStringPureResult(
                graph,
                consumerNodeId,
                stringOp,
                selfNode.params ?? {},
                blueprintLocals,
                depth,
            );
        }
    }
    const edge = graph.edges?.find(e => e.to.nodeId === consumerNodeId && e.to.port === consumerPortId);
    if (!edge) {
        // Condition and log payload must come from wired data inputs, not ad-hoc node params.
        if (consumerPortId === "condition") {
            return false;
        }
        if (consumerPortId === "value") {
            return params.value;
        }
        return params[consumerPortId];
    }
    const src = graph.nodes?.[edge.from.nodeId];
    if (!src) {
        return undefined;
    }
    if (src.type === BLUEPRINT_NODE_TYPE_LITERAL && edge.from.port === "value") {
        return src.params?.value;
    }
    if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_STRING && edge.from.port === "value") {
        return String(src.params?.value ?? "");
    }
    if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_NUMBER && edge.from.port === "value") {
        const n = Number(src.params?.value ?? 0);
        return Number.isFinite(n) ? n : 0;
    }
    if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN && edge.from.port === "value") {
        return src.params?.value === true || src.params?.value === "true";
    }
    if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_NULL && edge.from.port === "value") {
        return null;
    }
    if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_JSON && edge.from.port === "value") {
        return src.params?.value ?? null;
    }
    if (src.type === BLUEPRINT_NODE_TYPE_LOCAL_GET && edge.from.port === "value") {
        const vid = String(src.params?.variableId ?? "").trim();
        if (!vid || !blueprintLocals) {
            return undefined;
        }
        return blueprintLocals[vid];
    }
    return resolveDataPinValue(graph, edge.from.nodeId, edge.from.port, src.params ?? {}, blueprintLocals, depth + 1);
}

export function resolveIfCondition(
    graph: DataPinGraph,
    node: { id: string },
    params: Record<string, unknown>,
    blueprintLocals?: Record<string, unknown>,
): unknown {
    return resolveDataPinValue(graph, node.id, "condition", params, blueprintLocals);
}
