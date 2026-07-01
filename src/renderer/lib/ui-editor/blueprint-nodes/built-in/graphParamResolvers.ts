/**
 * Resolve wired / inspector params for nodes that read from graph IR data pins.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT,
    BLUEPRINT_NODE_TYPE_BOOLEAN_AND,
    BLUEPRINT_NODE_TYPE_BOOLEAN_NOT,
    BLUEPRINT_NODE_TYPE_BOOLEAN_OR,
    BLUEPRINT_NODE_TYPE_BOOLEAN_XOR,
    BLUEPRINT_NODE_TYPE_COMPARE_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN,
    BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_GET,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_INSERT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_JOIN,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LENGTH,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_PUSH,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE_AT,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SET,
    BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_KEYS,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_MERGE,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_REMOVE_FIELD,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_SET_FIELD,
    BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_VALUES,
    BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN,
    BLUEPRINT_NODE_TYPE_DATA_IS_EMPTY_VALUE,
    BLUEPRINT_NODE_TYPE_DATA_IS_NULL,
    BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER,
    BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_IS_STRING,
    BLUEPRINT_NODE_TYPE_DATA_NOT_NULL,
    BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
    BLUEPRINT_NODE_TYPE_DATA_JSON_SET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE,
    BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT,
    BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
    BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
    BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN,
    BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_BOUNDS,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_OPACITY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_ROTATION,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_SIZE,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_INDEX,
    BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_NORMALIZED_VALUE,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_RANGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_ALL_PROPERTIES,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_EFFECTS,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_SIZE,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_WEIGHT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_LINE_HEIGHT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_ALIGN,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_COLOR,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_VERTICAL_ALIGN,
    BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_WRAP_MODE,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_BOUNDS,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_OPACITY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_POSITION,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_ROTATION,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_SIZE,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VARIANT,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VISIBLE,
    BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH,
    BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP,
    BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW,
    BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS,
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
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_COUNT,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS,
    BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS,
    BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_INDEX,
    BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_ITEM,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_GET,
    BLUEPRINT_NODE_TYPE_PERSISTENT_SET,
    BLUEPRINT_NODE_TYPE_MATH_ABS,
    BLUEPRINT_NODE_TYPE_MATH_ADD,
    BLUEPRINT_NODE_TYPE_MATH_CEIL,
    BLUEPRINT_NODE_TYPE_MATH_DECREMENT,
    BLUEPRINT_NODE_TYPE_MATH_DIVIDE,
    BLUEPRINT_NODE_TYPE_MATH_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_FLOOR,
    BLUEPRINT_NODE_TYPE_MATH_GREATER,
    BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_INCREMENT,
    BLUEPRINT_NODE_TYPE_MATH_LESS,
    BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_MAX,
    BLUEPRINT_NODE_TYPE_MATH_MIN,
    BLUEPRINT_NODE_TYPE_MATH_MODULO,
    BLUEPRINT_NODE_TYPE_MATH_MULTIPLY,
    BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL,
    BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT,
    BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER,
    BLUEPRINT_NODE_TYPE_MATH_ROUND,
    BLUEPRINT_NODE_TYPE_MATH_SUBTRACT,
    BLUEPRINT_NODE_TYPE_STRING_CAPITALIZE,
    BLUEPRINT_NODE_TYPE_STRING_CHAR_AT,
    BLUEPRINT_NODE_TYPE_STRING_CONCAT,
    BLUEPRINT_NODE_TYPE_STRING_CONTAINS,
    BLUEPRINT_NODE_TYPE_STRING_COUNT,
    BLUEPRINT_NODE_TYPE_STRING_ENDS_WITH,
    BLUEPRINT_NODE_TYPE_STRING_EQUALS,
    BLUEPRINT_NODE_TYPE_STRING_EQUALS_IGNORE_CASE,
    BLUEPRINT_NODE_TYPE_STRING_EXTRACT_REGEX,
    BLUEPRINT_NODE_TYPE_STRING_FORMAT,
    BLUEPRINT_NODE_TYPE_STRING_INDEX_OF,
    BLUEPRINT_NODE_TYPE_STRING_INSERT,
    BLUEPRINT_NODE_TYPE_STRING_IS_BLANK,
    BLUEPRINT_NODE_TYPE_STRING_IS_EMPTY,
    BLUEPRINT_NODE_TYPE_STRING_JOIN,
    BLUEPRINT_NODE_TYPE_STRING_LAST_INDEX_OF,
    BLUEPRINT_NODE_TYPE_STRING_LENGTH,
    BLUEPRINT_NODE_TYPE_STRING_MATCHES_REGEX,
    BLUEPRINT_NODE_TYPE_STRING_NORMALIZE_LINE_BREAKS,
    BLUEPRINT_NODE_TYPE_STRING_PAD_END,
    BLUEPRINT_NODE_TYPE_STRING_PAD_START,
    BLUEPRINT_NODE_TYPE_STRING_REPEAT,
    BLUEPRINT_NODE_TYPE_STRING_REPLACE,
    BLUEPRINT_NODE_TYPE_STRING_REPLACE_ALL,
    BLUEPRINT_NODE_TYPE_STRING_SPLIT,
    BLUEPRINT_NODE_TYPE_STRING_STARTS_WITH,
    BLUEPRINT_NODE_TYPE_STRING_SUBSTRING,
    BLUEPRINT_NODE_TYPE_STRING_TO_LOWER,
    BLUEPRINT_NODE_TYPE_STRING_TO_STRING,
    BLUEPRINT_NODE_TYPE_STRING_TO_UPPER,
    BLUEPRINT_NODE_TYPE_STRING_TRIM,
    BLUEPRINT_NODE_TYPE_STRING_TRIM_END,
    BLUEPRINT_NODE_TYPE_STRING_TRIM_START,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE,
    BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE,
    BLUEPRINT_NODE_TYPE_TEXT_GET_ALL_PROPERTIES,
    BLUEPRINT_NODE_TYPE_TEXT_GET_EFFECTS,
    BLUEPRINT_NODE_TYPE_TEXT_GET_FONT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_SIZE,
    BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_WEIGHT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_LINE_HEIGHT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_ALIGN,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_COLOR,
    BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_VERTICAL_ALIGN,
    BLUEPRINT_NODE_TYPE_TEXT_GET_WRAP_MODE,
    isBlueprintEventDispatchHeadType,
} from "@shared/types/blueprint/graph";
import {
    type BlueprintElementRef,
    normalizeBlueprintImageAssetValue,
    normalizeBlueprintRGBAColor,
    normalizeBlueprintVector2D,
} from "@shared/types/blueprint/valueTypes";
import type { BehaviorGraphValueExecution } from "../../behavior-graph/BehaviorNodeRegistry";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import {
    readDynamicInputPinIds,
    readDynamicInputPinLabels,
    resolveEffectiveBlueprintNodePins,
} from "../effectivePins";
import { readBlueprintNodeOutputValue } from "../nodeOutputValues";
import {
    normalizeBlueprintElementRefValue,
    readBlueprintElementRefParams,
} from "./elementRefUtils";

const MAX_RESOLVE_DEPTH = 32;
const MAX_REPEAT_COUNT = 10000;
const MAX_JSON_ARRAY_INDEX = 10000;
const JSON_OBJECT_FIELD_NAMES_KEY = "__jsonObjectFieldNames";
const JSON_OBJECT_NAME_PIN_SUFFIX = "_name";
const JSON_OBJECT_VALUE_PIN_SUFFIX = "_value";

const MATH_RESULT_OPS: Record<string, "add" | "subtract" | "multiply" | "divide" | "modulo" | "min" | "max"> = {
    [BLUEPRINT_NODE_TYPE_MATH_ADD]: "add",
    [BLUEPRINT_NODE_TYPE_MATH_SUBTRACT]: "subtract",
    [BLUEPRINT_NODE_TYPE_MATH_MULTIPLY]: "multiply",
    [BLUEPRINT_NODE_TYPE_MATH_DIVIDE]: "divide",
    [BLUEPRINT_NODE_TYPE_MATH_MODULO]: "modulo",
    [BLUEPRINT_NODE_TYPE_MATH_MIN]: "min",
    [BLUEPRINT_NODE_TYPE_MATH_MAX]: "max",
};

const MATH_UNARY_OPS: Record<string, "increment" | "decrement" | "abs" | "round" | "floor" | "ceil"> = {
    [BLUEPRINT_NODE_TYPE_MATH_INCREMENT]: "increment",
    [BLUEPRINT_NODE_TYPE_MATH_DECREMENT]: "decrement",
    [BLUEPRINT_NODE_TYPE_MATH_ABS]: "abs",
    [BLUEPRINT_NODE_TYPE_MATH_ROUND]: "round",
    [BLUEPRINT_NODE_TYPE_MATH_FLOOR]: "floor",
    [BLUEPRINT_NODE_TYPE_MATH_CEIL]: "ceil",
};

const MATH_COMPARE_OPS: Record<string, "eq" | "ne" | "lt" | "lte" | "gt" | "gte"> = {
    [BLUEPRINT_NODE_TYPE_MATH_EQUAL]: "eq",
    [BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL]: "ne",
    [BLUEPRINT_NODE_TYPE_MATH_LESS]: "lt",
    [BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL]: "lte",
    [BLUEPRINT_NODE_TYPE_MATH_GREATER]: "gt",
    [BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL]: "gte",
};

const BOOLEAN_OPS: Record<string, "and" | "or" | "not" | "xor"> = {
    [BLUEPRINT_NODE_TYPE_BOOLEAN_AND]: "and",
    [BLUEPRINT_NODE_TYPE_BOOLEAN_OR]: "or",
    [BLUEPRINT_NODE_TYPE_BOOLEAN_NOT]: "not",
    [BLUEPRINT_NODE_TYPE_BOOLEAN_XOR]: "xor",
};

const COMPARE_OPS: Record<string, "eq" | "ne" | "gt" | "gte" | "lt" | "lte"> = {
    [BLUEPRINT_NODE_TYPE_COMPARE_EQUAL]: "eq",
    [BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL]: "ne",
    [BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN]: "gt",
    [BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL]: "gte",
    [BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN]: "lt",
    [BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL]: "lte",
};

export type DataPinGraph = {
    edges?: Array<{ from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }>;
    nodes?: Record<string, { type: string; params?: Record<string, unknown> }>;
};

export type DataPinResolveRuntime = {
    hostAdapter?: UIHostAdapter;
    eventPayload?: Record<string, unknown>;
    listItemScope?: UIListItemScope | null;
    instanceKey?: string;
    executionOwner?: {
        surfaceId?: string;
        elementId?: string;
        blueprintId?: string;
    };
    valueExecution?: BehaviorGraphValueExecution;
};

function isElementBindingOutput(type: string, portId: string): boolean {
    return (
        portId === "element" &&
        (type === BLUEPRINT_NODE_TYPE_ELEMENT_REF ||
            type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH ||
            type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK)
    );
}

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

function toInteger(v: unknown, fallback = 0): number {
    const n = toFiniteNumber(v);
    return Number.isNaN(n) ? fallback : Math.trunc(n);
}

function toBlueprintBoolean(v: unknown): boolean {
    if (typeof v === "boolean") {
        return v;
    }
    if (typeof v === "number") {
        return Number.isFinite(v) && v !== 0;
    }
    if (typeof v === "string") {
        const normalized = v.trim().toLowerCase();
        if (!normalized || normalized === "false" || normalized === "0" || normalized === "no") {
            return false;
        }
        if (normalized === "true" || normalized === "1" || normalized === "yes") {
            return true;
        }
    }
    return Boolean(v);
}

function toJsonSafeValue(v: unknown, seen = new WeakSet<object>()): unknown {
    if (v === undefined) {
        return null;
    }
    if (v === null || typeof v === "string" || typeof v === "boolean") {
        return v;
    }
    if (typeof v === "number") {
        return Number.isFinite(v) ? v : null;
    }
    if (typeof v === "bigint" || typeof v === "symbol" || typeof v === "function") {
        return String(v);
    }
    if (Array.isArray(v)) {
        if (seen.has(v)) {
            return null;
        }
        seen.add(v);
        const out = v.map(item => toJsonSafeValue(item, seen));
        seen.delete(v);
        return out;
    }
    if (typeof v === "object") {
        if (seen.has(v)) {
            return null;
        }
        seen.add(v);
        const out: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(v as Record<string, unknown>)) {
            out[key] = toJsonSafeValue(value, seen);
        }
        seen.delete(v);
        return out;
    }
    return null;
}

function toBlueprintJson(v: unknown): unknown {
    if (typeof v === "string") {
        const trimmed = v.trim();
        if (!trimmed) {
            return "";
        }
        try {
            return JSON.parse(trimmed) as unknown;
        } catch {
            return v;
        }
    }
    return toJsonSafeValue(v);
}

function parseBlueprintJson(v: unknown): unknown {
    if (typeof v !== "string") {
        return toBlueprintJson(v);
    }
    const trimmed = v.trim();
    if (!trimmed) {
        return null;
    }
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        return null;
    }
}

function stringifyBlueprintJson(v: unknown): string {
    if (v === undefined) {
        return "null";
    }
    try {
        const text = JSON.stringify(v);
        return text === undefined ? "null" : text;
    } catch {
        return "";
    }
}

function clampInteger(v: unknown, min: number, max: number, fallback = min): number {
    const n = toInteger(v, fallback);
    return Math.max(min, Math.min(max, n));
}

function toBlueprintString(v: unknown): string {
    if (v === undefined || v === null) {
        return "";
    }
    if (typeof v === "string") {
        return v;
    }
    if (typeof v === "object") {
        try {
            return JSON.stringify(v);
        } catch {
            return String(v);
        }
    }
    return String(v);
}

function readParamString(params: Record<string, unknown> | undefined, key: string): string | undefined {
    const value = params?.[key];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function isNumericValueType(valueType: string | undefined): boolean {
    return valueType === "integer" || valueType === "float";
}

function resolveNodePinValueType(input: {
    graph: DataPinGraph;
    nodeId: string;
    portId: string;
    kind: "input" | "output";
    fallbackParams?: Record<string, unknown>;
}): string | undefined {
    const node = input.graph.nodes?.[input.nodeId];
    if (!node) {
        return undefined;
    }
    const params = node.params ?? input.fallbackParams;
    const entry = blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, params);
    const pin = entry.pins.find(p => p.id === input.portId && p.kind === input.kind);
    if (!pin) {
        return undefined;
    }
    if (
        (node.type === BLUEPRINT_NODE_TYPE_LOCAL_GET && input.portId === "value") ||
        (node.type === BLUEPRINT_NODE_TYPE_LOCAL_SET && input.portId === "value") ||
        (node.type === BLUEPRINT_NODE_TYPE_PERSISTENT_GET && input.portId === "value") ||
        (node.type === BLUEPRINT_NODE_TYPE_PERSISTENT_SET && input.portId === "value")
    ) {
        return readParamString(params, BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE) ?? pin.valueType;
    }
    return pin.valueType;
}

function coerceEdgeValueForTarget(input: {
    value: unknown;
    graph: DataPinGraph;
    edge: { from: { nodeId: string; port: string }; to: { nodeId: string; port: string } };
    consumerParams: Record<string, unknown>;
}): unknown {
    const sourceType = resolveNodePinValueType({
        graph: input.graph,
        nodeId: input.edge.from.nodeId,
        portId: input.edge.from.port,
        kind: "output",
    });
    const targetType = resolveNodePinValueType({
        graph: input.graph,
        nodeId: input.edge.to.nodeId,
        portId: input.edge.to.port,
        kind: "input",
        fallbackParams: input.consumerParams,
    });
    if (targetType === "string" && isNumericValueType(sourceType)) {
        return toBlueprintString(input.value);
    }
    return input.value;
}

function resolveInput(
    graph: DataPinGraph,
    nodeId: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    return resolveDataPinValue(graph, nodeId, portId, params, blueprintLocals, depth + 1, runtime);
}

function resolveMathVariadicNumbers(
    graph: DataPinGraph,
    nodeId: string,
    nodeType: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): number[] | null {
    const def = blueprintNodeRegistry.get(nodeType);
    if (!def) {
        return null;
    }
    const pins = resolveEffectiveBlueprintNodePins(def, params);
    const dataIn = pins.filter(p => p.kind === "input" && p.semantic === "data");
    const values: number[] = [];
    for (const pin of dataIn) {
        const n = toFiniteNumber(resolveInput(graph, nodeId, pin.id, params, blueprintLocals, depth, runtime));
        if (Number.isNaN(n)) {
            return null;
        }
        values.push(n);
    }
    return values;
}

function resolveMathAddVariadic(
    graph: DataPinGraph,
    nodeId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const values = resolveMathVariadicNumbers(
        graph,
        nodeId,
        BLUEPRINT_NODE_TYPE_MATH_ADD,
        params,
        blueprintLocals,
        depth,
        runtime,
    );
    return values && values.length > 0 ? values.reduce((acc, value) => acc + value, 0) : NaN;
}

function resolveMathNodeResult(
    graph: DataPinGraph,
    nodeId: string,
    op: "add" | "subtract" | "multiply" | "divide" | "modulo" | "min" | "max",
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    if (op === "add" && graph.nodes?.[nodeId]?.type === BLUEPRINT_NODE_TYPE_MATH_ADD) {
        return resolveMathAddVariadic(graph, nodeId, params, blueprintLocals, depth, runtime);
    }
    if (op === "min" || op === "max") {
        const values = resolveMathVariadicNumbers(
            graph,
            nodeId,
            graph.nodes?.[nodeId]?.type ?? "",
            params,
            blueprintLocals,
            depth,
            runtime,
        );
        if (!values || values.length === 0) {
            return NaN;
        }
        return op === "min" ? Math.min(...values) : Math.max(...values);
    }
    const a = resolveInput(graph, nodeId, "a", params, blueprintLocals, depth, runtime);
    const b = resolveInput(graph, nodeId, "b", params, blueprintLocals, depth, runtime);
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
        case "modulo":
            return na % nb;
        default:
            return NaN;
    }
}

function resolveMathUnaryResult(
    graph: DataPinGraph,
    nodeId: string,
    op: "increment" | "decrement" | "abs" | "round" | "floor" | "ceil",
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const n = toFiniteNumber(resolveInput(graph, nodeId, "value", params, blueprintLocals, depth, runtime));
    if (Number.isNaN(n)) {
        return NaN;
    }
    switch (op) {
        case "increment":
            return n + 1;
        case "decrement":
            return n - 1;
        case "abs":
            return Math.abs(n);
        case "round":
            return Math.round(n);
        case "floor":
            return Math.floor(n);
        case "ceil":
            return Math.ceil(n);
        default:
            return NaN;
    }
}

function resolveMathCompareResult(
    graph: DataPinGraph,
    nodeId: string,
    op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte",
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const a = resolveInput(graph, nodeId, "a", params, blueprintLocals, depth, runtime);
    const b = resolveInput(graph, nodeId, "b", params, blueprintLocals, depth, runtime);
    const na = toFiniteNumber(a);
    const nb = toFiniteNumber(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
        return op === "ne";
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

function resolveMathRandomResult(
    graph: DataPinGraph,
    nodeId: string,
    integer: boolean,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const minRaw = toFiniteNumber(resolveInput(graph, nodeId, "min", params, blueprintLocals, depth, runtime));
    const maxRaw = toFiniteNumber(resolveInput(graph, nodeId, "max", params, blueprintLocals, depth, runtime));
    const min = Number.isNaN(minRaw) ? 0 : minRaw;
    const max = Number.isNaN(maxRaw) ? 1 : maxRaw;
    const lower = Math.min(min, max);
    const upper = Math.max(min, max);
    if (!integer) {
        return lower + Math.random() * (upper - lower);
    }
    const lowerInt = Math.ceil(lower);
    const upperInt = Math.floor(upper);
    if (upperInt < lowerInt) {
        return lowerInt;
    }
    return Math.floor(lowerInt + Math.random() * (upperInt - lowerInt + 1));
}

function resolveBooleanNodeResult(
    graph: DataPinGraph,
    nodeId: string,
    op: "and" | "or" | "not" | "xor",
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const a = toBlueprintBoolean(resolveInput(graph, nodeId, "a", params, blueprintLocals, depth, runtime));
    if (op === "not") {
        return !a;
    }
    const b = toBlueprintBoolean(resolveInput(graph, nodeId, "b", params, blueprintLocals, depth, runtime));
    switch (op) {
        case "and":
            return a && b;
        case "or":
            return a || b;
        case "xor":
            return a !== b;
        default:
            return false;
    }
}

function resolveCompareNodeResult(
    graph: DataPinGraph,
    nodeId: string,
    op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte",
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const a = resolveInput(graph, nodeId, "a", params, blueprintLocals, depth, runtime);
    const b = resolveInput(graph, nodeId, "b", params, blueprintLocals, depth, runtime);
    if (op === "eq") {
        return a === b;
    }
    if (op === "ne") {
        return a !== b;
    }
    const na = toFiniteNumber(a);
    const nb = toFiniteNumber(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) {
        return false;
    }
    switch (op) {
        case "gt":
            return na > nb;
        case "gte":
            return na >= nb;
        case "lt":
            return na < nb;
        case "lte":
            return na <= nb;
        default:
            return false;
    }
}

function formatString(template: string, values: unknown): string {
    return template.replace(/\{([^{}]+)\}/g, (_full, keyRaw: string) => {
        const key = keyRaw.trim();
        if (Array.isArray(values)) {
            const idx = Number(key);
            return Number.isInteger(idx) ? toBlueprintString(values[idx]) : "";
        }
        if (values && typeof values === "object") {
            return toBlueprintString((values as Record<string, unknown>)[key]);
        }
        return "";
    });
}

function countOccurrences(value: string, search: string): number {
    if (search.length === 0) {
        return 0;
    }
    let count = 0;
    let cursor = 0;
    while (cursor <= value.length) {
        const next = value.indexOf(search, cursor);
        if (next === -1) {
            return count;
        }
        count += 1;
        cursor = next + search.length;
    }
    return count;
}

function splitJsonPath(path: string): string[] {
    const out: string[] = [];
    let current = "";
    let escaping = false;
    for (const ch of path) {
        if (escaping) {
            current += ch;
            escaping = false;
            continue;
        }
        if (ch === "\\") {
            escaping = true;
            continue;
        }
        if (ch === ".") {
            out.push(current);
            current = "";
            continue;
        }
        current += ch;
    }
    if (escaping) {
        current += "\\";
    }
    out.push(current);
    return out.filter(segment => segment.length > 0);
}

function readJsonPath(value: unknown, path: string): { exists: boolean; value: unknown } {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
        return { exists: true, value };
    }

    let current: unknown = value;
    for (const segment of splitJsonPath(normalizedPath)) {
        if (Array.isArray(current) && /^\d+$/.test(segment)) {
            const index = Number(segment);
            if (index < current.length) {
                current = current[index];
                continue;
            }
            return { exists: false, value: undefined };
        }
        if (current && typeof current === "object") {
            const record = current as Record<string, unknown>;
            if (Object.prototype.hasOwnProperty.call(record, segment)) {
                current = record[segment];
                continue;
            }
        }
        return { exists: false, value: undefined };
    }
    return { exists: true, value: current };
}

function isJsonObjectRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isEmptyBlueprintValue(value: unknown): boolean {
    if (value == null) {
        return true;
    }
    if (typeof value === "string") {
        return value.length === 0;
    }
    if (Array.isArray(value)) {
        return value.length === 0;
    }
    if (isJsonObjectRecord(value)) {
        return Object.keys(value).length === 0;
    }
    return false;
}

function isJsonContainer(value: unknown): value is Record<string, unknown> | unknown[] {
    return Array.isArray(value) || isJsonObjectRecord(value);
}

function isJsonArrayIndex(segment: string): boolean {
    return /^\d+$/.test(segment) && Number(segment) <= MAX_JSON_ARRAY_INDEX;
}

function createJsonContainerForNextSegment(nextSegment: string | undefined): Record<string, unknown> | unknown[] {
    return nextSegment !== undefined && isJsonArrayIndex(nextSegment) ? [] : {};
}

function setJsonContainerChild(
    container: Record<string, unknown> | unknown[],
    segment: string,
    value: unknown,
): boolean {
    if (Array.isArray(container)) {
        if (!isJsonArrayIndex(segment)) {
            return false;
        }
        container[Number(segment)] = value;
        return true;
    }
    container[segment] = value;
    return true;
}

function readJsonContainerChild(
    container: Record<string, unknown> | unknown[],
    segment: string,
): unknown {
    if (Array.isArray(container)) {
        if (!isJsonArrayIndex(segment)) {
            return undefined;
        }
        return container[Number(segment)];
    }
    return container[segment];
}

function resolveMutableJsonRoot(value: unknown, firstSegment: string | undefined): unknown {
    const safe = toJsonSafeValue(value);
    return isJsonContainer(safe) ? safe : createJsonContainerForNextSegment(firstSegment);
}

function setJsonPath(value: unknown, path: string, nextValue: unknown): unknown {
    const segments = splitJsonPath(path.trim());
    const safeNextValue = toJsonSafeValue(nextValue);
    if (segments.length === 0) {
        return safeNextValue;
    }

    const root = resolveMutableJsonRoot(value, segments[0]);
    if (!isJsonContainer(root)) {
        return root;
    }

    let current: Record<string, unknown> | unknown[] = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
        const segment = segments[i];
        const nextSegment = segments[i + 1];
        const child = readJsonContainerChild(current, segment);
        let nextContainer: Record<string, unknown> | unknown[];
        if (isJsonContainer(child)) {
            nextContainer = child;
        } else {
            nextContainer = createJsonContainerForNextSegment(nextSegment);
            if (!setJsonContainerChild(current, segment, nextContainer)) {
                return root;
            }
        }
        current = nextContainer;
    }

    setJsonContainerChild(current, segments[segments.length - 1], safeNextValue);
    return root;
}

function removeJsonPath(value: unknown, path: string): unknown {
    const root = toJsonSafeValue(value);
    const segments = splitJsonPath(path.trim());
    if (!isJsonContainer(root) || segments.length === 0) {
        return root;
    }

    let current: unknown = root;
    for (let i = 0; i < segments.length - 1; i += 1) {
        if (!isJsonContainer(current)) {
            return root;
        }
        current = readJsonContainerChild(current, segments[i]);
    }

    if (!isJsonContainer(current)) {
        return root;
    }
    const lastSegment = segments[segments.length - 1];
    if (Array.isArray(current)) {
        if (isJsonArrayIndex(lastSegment)) {
            const index = Number(lastSegment);
            if (index < current.length) {
                current.splice(index, 1);
            }
        }
        return root;
    }
    delete current[lastSegment];
    return root;
}

function mergeJsonObjectValues(a: unknown, b: unknown): Record<string, unknown> {
    const left = toJsonSafeValue(a);
    const right = toJsonSafeValue(b);
    return {
        ...(isJsonObjectRecord(left) ? left : {}),
        ...(isJsonObjectRecord(right) ? right : {}),
    };
}

function normalizeArrayValue(value: unknown): unknown[] {
    const safe = toJsonSafeValue(value);
    return Array.isArray(safe) ? safe : [];
}

function jsonValueEquals(a: unknown, b: unknown): boolean {
    const left = toJsonSafeValue(a);
    const right = toJsonSafeValue(b);
    try {
        return JSON.stringify(left) === JSON.stringify(right);
    } catch {
        return left === right;
    }
}

function setObjectFieldValue(value: unknown, field: string, nextValue: unknown): Record<string, unknown> {
    const safe = toJsonSafeValue(value);
    const out = isJsonObjectRecord(safe) ? { ...safe } : {};
    const key = field.trim();
    if (key) {
        out[key] = toJsonSafeValue(nextValue);
    }
    return out;
}

function removeObjectFieldValue(value: unknown, field: string): Record<string, unknown> {
    const safe = toJsonSafeValue(value);
    const out = isJsonObjectRecord(safe) ? { ...safe } : {};
    const key = field.trim();
    if (key) {
        delete out[key];
    }
    return out;
}

function listItemPropsValue(item: unknown): Record<string, unknown> {
    const safe = toJsonSafeValue(item);
    return isJsonObjectRecord(safe) ? safe : { value: safe };
}

function readJsonObjectFieldPair(
    pinId: string,
    dynamicIdSet: ReadonlySet<string>,
): { nameId: string; valueId: string } | undefined {
    if (pinId.endsWith(JSON_OBJECT_NAME_PIN_SUFFIX)) {
        const baseId = pinId.slice(0, -JSON_OBJECT_NAME_PIN_SUFFIX.length);
        const valueId = `${baseId}${JSON_OBJECT_VALUE_PIN_SUFFIX}`;
        return dynamicIdSet.has(valueId) ? { nameId: pinId, valueId } : undefined;
    }
    if (pinId.endsWith(JSON_OBJECT_VALUE_PIN_SUFFIX)) {
        const baseId = pinId.slice(0, -JSON_OBJECT_VALUE_PIN_SUFFIX.length);
        const nameId = `${baseId}${JSON_OBJECT_NAME_PIN_SUFFIX}`;
        return dynamicIdSet.has(nameId) ? { nameId, valueId: pinId } : undefined;
    }
    return undefined;
}

function resolveJsonMakeObjectResult(
    graph: DataPinGraph,
    nodeId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): Record<string, unknown> {
    const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT);
    if (!def) {
        return {};
    }
    const dynamicPinIds = def.dynamicInputPins
        ? readDynamicInputPinIds(params, def.dynamicInputPins.storageKey)
        : [];
    const dynamicPinIdSet = new Set(dynamicPinIds);
    const labels = readDynamicInputPinLabels(params, JSON_OBJECT_FIELD_NAMES_KEY);
    const handledPinIds = new Set<string>();
    const out: Record<string, unknown> = {};
    for (const pinId of dynamicPinIds) {
        if (handledPinIds.has(pinId)) {
            continue;
        }
        const pair = readJsonObjectFieldPair(pinId, dynamicPinIdSet);
        if (!pair) {
            continue;
        }
        handledPinIds.add(pair.nameId);
        handledPinIds.add(pair.valueId);
        const key = toBlueprintString(
            resolveInput(graph, nodeId, pair.nameId, params, blueprintLocals, depth, runtime),
        ).trim();
        if (!key || Object.prototype.hasOwnProperty.call(out, key)) {
            continue;
        }
        out[key] = toJsonSafeValue(
            resolveInput(graph, nodeId, pair.valueId, params, blueprintLocals, depth, runtime),
        );
    }

    for (const pin of resolveEffectiveBlueprintNodePins(def, params)) {
        if (pin.kind !== "input" || pin.semantic !== "data") {
            continue;
        }
        if (handledPinIds.has(pin.id)) {
            continue;
        }
        const key = (labels[pin.id] ?? pin.label ?? pin.id).trim();
        if (!key || Object.prototype.hasOwnProperty.call(out, key)) {
            continue;
        }
        out[key] = toJsonSafeValue(resolveInput(graph, nodeId, pin.id, params, blueprintLocals, depth, runtime));
    }
    return out;
}

function resolveJsonMakeArrayResult(
    graph: DataPinGraph,
    nodeId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown[] {
    const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY);
    if (!def) {
        return [];
    }
    return resolveEffectiveBlueprintNodePins(def, params)
        .filter(pin => pin.kind === "input" && pin.semantic === "data")
        .map(pin => toJsonSafeValue(resolveInput(graph, nodeId, pin.id, params, blueprintLocals, depth, runtime)));
}

function resolveStringNodeOutput(
    graph: DataPinGraph,
    nodeId: string,
    type: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const s = (pin: string) => toBlueprintString(resolveInput(graph, nodeId, pin, params, blueprintLocals, depth, runtime));
    const any = (pin: string) => resolveInput(graph, nodeId, pin, params, blueprintLocals, depth, runtime);
    if (type === BLUEPRINT_NODE_TYPE_STRING_TO_STRING && portId === "result") {
        return toBlueprintString(any("value"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_CONCAT && portId === "result") {
        const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_STRING_CONCAT);
        if (!def) {
            return "";
        }
        return resolveEffectiveBlueprintNodePins(def, params)
            .filter(p => p.kind === "input" && p.semantic === "data")
            .map(pin => s(pin.id))
            .join("");
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_FORMAT && portId === "result") {
        return formatString(s("template"), any("values"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_LENGTH && portId === "length") {
        return s("value").length;
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_IS_EMPTY && portId === "result") {
        return s("value").length === 0;
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_IS_BLANK && portId === "result") {
        return s("value").trim().length === 0;
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_TRIM && portId === "result") {
        return s("value").trim();
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_TRIM_START && portId === "result") {
        return s("value").trimStart();
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_TRIM_END && portId === "result") {
        return s("value").trimEnd();
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_TO_UPPER && portId === "result") {
        return s("value").toUpperCase();
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_TO_LOWER && portId === "result") {
        return s("value").toLowerCase();
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_CAPITALIZE && portId === "result") {
        const value = s("value");
        return value.length === 0 ? "" : value.charAt(0).toUpperCase() + value.slice(1);
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_CONTAINS && portId === "result") {
        return s("value").includes(s("search"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_STARTS_WITH && portId === "result") {
        return s("value").startsWith(s("search"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_ENDS_WITH && portId === "result") {
        return s("value").endsWith(s("search"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_EQUALS && portId === "result") {
        return s("a") === s("b");
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_EQUALS_IGNORE_CASE && portId === "result") {
        return s("a").toLowerCase() === s("b").toLowerCase();
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_INDEX_OF && portId === "index") {
        const value = s("value");
        const start = clampInteger(any("start"), 0, value.length, 0);
        return value.indexOf(s("search"), start);
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_LAST_INDEX_OF && portId === "index") {
        return s("value").lastIndexOf(s("search"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_COUNT && portId === "count") {
        return countOccurrences(s("value"), s("search"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_CHAR_AT && portId === "char") {
        const value = s("value");
        const index = toInteger(any("index"), -1);
        return index >= 0 && index < value.length ? value.charAt(index) : "";
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_SUBSTRING && portId === "result") {
        const value = s("value");
        const start = clampInteger(any("start"), 0, value.length, 0);
        const length = clampInteger(any("length"), 0, value.length - start, value.length - start);
        return value.slice(start, start + length);
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_INSERT && portId === "result") {
        const value = s("value");
        const index = clampInteger(any("index"), 0, value.length, value.length);
        return `${value.slice(0, index)}${s("insert")}${value.slice(index)}`;
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_REPLACE && portId === "result") {
        const search = s("search");
        return search.length === 0 ? s("value") : s("value").replace(search, s("replacement"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_REPLACE_ALL && portId === "result") {
        const search = s("search");
        return search.length === 0 ? s("value") : s("value").split(search).join(s("replacement"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_SPLIT && portId === "result") {
        return s("value").split(s("separator"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_JOIN && portId === "result") {
        const values = any("values");
        return Array.isArray(values) ? values.map(toBlueprintString).join(s("separator")) : "";
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_REPEAT && portId === "result") {
        const count = clampInteger(any("count"), 0, MAX_REPEAT_COUNT, 0);
        return s("value").repeat(count);
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_PAD_START && portId === "result") {
        return s("value").padStart(Math.max(0, toInteger(any("length"), 0)), s("pad"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_PAD_END && portId === "result") {
        return s("value").padEnd(Math.max(0, toInteger(any("length"), 0)), s("pad"));
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_MATCHES_REGEX && portId === "result") {
        try {
            return new RegExp(s("pattern")).test(s("value"));
        } catch {
            return false;
        }
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_EXTRACT_REGEX && portId === "result") {
        try {
            const match = s("value").match(new RegExp(s("pattern")));
            return match?.[1] ?? match?.[0] ?? "";
        } catch {
            return "";
        }
    }
    if (type === BLUEPRINT_NODE_TYPE_STRING_NORMALIZE_LINE_BREAKS && portId === "result") {
        return s("value").replace(/\r\n?/g, "\n");
    }
    return undefined;
}

function resolveBroadcastNodeOutput(
    graph: DataPinGraph,
    nodeId: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    if (portId !== "count") {
        return undefined;
    }
    const eventName = toBlueprintString(resolveInput(graph, nodeId, "event", params, blueprintLocals, depth, runtime)).trim();
    if (!eventName) {
        return 0;
    }
    return runtime?.hostAdapter?.blueprintRuntime?.getBroadcastListenerCount?.(eventName) ?? 0;
}

function resolveFrameNodeOutput(
    graph: DataPinGraph,
    nodeId: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    if (portId !== "value") {
        return undefined;
    }
    const api = runtime?.hostAdapter?.blueprintRuntime?.hostApi;
    if (!api) {
        return undefined;
    }
    const key = toBlueprintString(resolveInput(graph, nodeId, "key", params, blueprintLocals, depth, runtime)).trim();
    return key ? api.frame.getParam(key) : null;
}

function resolveGameNodeOutput(
    portId: string,
    runtime?: DataPinResolveRuntime,
): unknown {
    if (portId !== "nametag") {
        return undefined;
    }
    return runtime?.hostAdapter?.blueprintRuntime?.hostApi?.game.getNametag() ?? null;
}

function trackElementDependency(
    runtime: DataPinResolveRuntime | undefined,
    ref: BlueprintElementRef,
    propPath: string,
): void {
    runtime?.valueExecution?.trackDependency?.({
        surfaceId: ref.surfaceId,
        elementId: ref.elementId,
        propPath,
    });
}

function sameSurfaceElementRef(ref: BlueprintElementRef | undefined, runtime?: DataPinResolveRuntime): BlueprintElementRef | undefined {
    if (!ref) {
        return undefined;
    }
    const ownerSurfaceId = runtime?.executionOwner?.surfaceId;
    if (ownerSurfaceId && ref.surfaceId !== ownerSurfaceId) {
        return undefined;
    }
    return ref;
}

function resolveElementInputRef(
    graph: DataPinGraph,
    nodeId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): BlueprintElementRef | undefined {
    return sameSurfaceElementRef(
        normalizeBlueprintElementRefValue(resolveInput(graph, nodeId, "element", params, blueprintLocals, depth, runtime)),
        runtime,
    );
}

function resolveListElementIdInput(
    graph: DataPinGraph,
    nodeId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
    target: "self" | "element" = "element",
): string | undefined {
    if (target === "self") {
        return runtime?.executionOwner?.elementId;
    }
    const ref = sameSurfaceElementRef(
        normalizeBlueprintElementRefValue(resolveInput(graph, nodeId, "list", params, blueprintLocals, depth, runtime)),
        runtime,
    );
    return ref?.elementType === "nl.list" ? ref.elementId : undefined;
}

function resolveElementTextNodeOutput(
    graph: DataPinGraph,
    nodeId: string,
    type: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const ref = resolveElementInputRef(graph, nodeId, params, blueprintLocals, depth, runtime);
    const api = runtime?.hostAdapter?.blueprintRuntime?.hostApi;
    if (!ref || !api || ref.elementType !== "nl.text") {
        return undefined;
    }
    let props: ReturnType<typeof api.widget.getTextProperties>;
    try {
        props = api.widget.getTextProperties(ref.elementId);
    } catch {
        return undefined;
    }

    const read = (propPath: string, value: unknown) => {
        trackElementDependency(runtime, ref, propPath);
        return value;
    };

    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT && portId === "text") {
        return read("props.text", props.text);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT && portId === "fontAssetId") {
        return read("props.fontAssetId", props.fontAssetId ?? "");
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_SIZE && portId === "fontSize") {
        return read("props.fontSize", props.fontSize);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_WEIGHT && portId === "fontWeight") {
        return read("props.fontWeight", props.fontWeight);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_COLOR && portId === "color") {
        return read("props.color", normalizeBlueprintRGBAColor(props.color));
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_ALIGN && portId === "textAlign") {
        return read("props.textAlign", props.textAlign);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_VERTICAL_ALIGN && portId === "textVerticalAlign") {
        return read("props.textVerticalAlign", props.textVerticalAlign);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_LINE_HEIGHT && portId === "lineHeight") {
        return read("props.lineHeight", props.lineHeight);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_WRAP_MODE && portId === "textWrapMode") {
        return read("props.textWrapMode", props.textWrapMode);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_EFFECTS && portId === "effects") {
        return read("props.effects", props.effects);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_ALL_PROPERTIES) {
        if (portId === "fontAssetId") {
            return read("props.fontAssetId", props.fontAssetId ?? "");
        }
        if (portId in props) {
            const propPath = `props.${portId}`;
            if (portId === "color") {
                return read(propPath, normalizeBlueprintRGBAColor(props.color));
            }
            return read(propPath, props[portId as keyof typeof props]);
        }
    }
    return undefined;
}

function resolveElementDisplayableNodeOutput(
    graph: DataPinGraph,
    nodeId: string,
    type: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const ref = resolveElementInputRef(graph, nodeId, params, blueprintLocals, depth, runtime);
    const api = runtime?.hostAdapter?.blueprintRuntime?.hostApi;
    if (!ref || !api) {
        return undefined;
    }
    let props: ReturnType<typeof api.widget.getDisplayableProperties>;
    try {
        props = api.widget.getDisplayableProperties(ref.elementId);
    } catch {
        return undefined;
    }

    const read = (propPath: string, value: unknown) => {
        trackElementDependency(runtime, ref, propPath);
        return value;
    };

    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION && portId === "position") {
        trackElementDependency(runtime, ref, "layout.x");
        trackElementDependency(runtime, ref, "layout.y");
        return props.position;
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_SIZE && portId === "size") {
        trackElementDependency(runtime, ref, "layout.width");
        trackElementDependency(runtime, ref, "layout.height");
        return props.size;
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_BOUNDS && portId === "bounds") {
        trackElementDependency(runtime, ref, "layout.x");
        trackElementDependency(runtime, ref, "layout.y");
        trackElementDependency(runtime, ref, "layout.width");
        trackElementDependency(runtime, ref, "layout.height");
        return props.bounds;
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_ROTATION && portId === "rotation") {
        return read("layout.rotation", props.rotation);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_OPACITY && portId === "opacity") {
        return read("layout.opacity", props.opacity);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE && portId === "visible") {
        return read("layout.visible", props.visible);
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VARIANT && portId === "variantId") {
        return read("props.appearance.defaultVariantId", api.widget.getCommonProperties(ref.elementId).variantId ?? "");
    }
    if (type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY && portId === "value") {
        const property = toBlueprintString(params.property || "position");
        switch (property) {
            case "position":
                trackElementDependency(runtime, ref, "layout.x");
                trackElementDependency(runtime, ref, "layout.y");
                return props.position;
            case "size":
                trackElementDependency(runtime, ref, "layout.width");
                trackElementDependency(runtime, ref, "layout.height");
                return props.size;
            case "bounds":
                trackElementDependency(runtime, ref, "layout.x");
                trackElementDependency(runtime, ref, "layout.y");
                trackElementDependency(runtime, ref, "layout.width");
                trackElementDependency(runtime, ref, "layout.height");
                return props.bounds;
            case "x":
                return read("layout.x", props.position.x);
            case "y":
                return read("layout.y", props.position.y);
            case "width":
                return read("layout.width", props.size.width);
            case "height":
                return read("layout.height", props.size.height);
            case "rotation":
                return read("layout.rotation", props.rotation);
            case "opacity":
                return read("layout.opacity", props.opacity);
            case "visible":
                return read("layout.visible", props.visible);
            default:
                return undefined;
        }
    }
    return undefined;
}

function resolveSelfDisplayableNodeOutput(
    type: string,
    portId: string,
    params: Record<string, unknown>,
    runtime?: DataPinResolveRuntime,
): unknown {
    const isDisplayableNode =
        type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_POSITION ||
        type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_SIZE ||
        type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_BOUNDS ||
        type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_ROTATION ||
        type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_OPACITY ||
        type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VISIBLE ||
        type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VARIANT ||
        type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY;
    if (!isDisplayableNode) {
        return undefined;
    }
    const elementId = runtime?.executionOwner?.elementId;
    const api = runtime?.hostAdapter?.blueprintRuntime?.hostApi;
    if (!elementId || !api) {
        return undefined;
    }
    let props: ReturnType<typeof api.widget.getDisplayableProperties>;
    try {
        props = api.widget.getDisplayableProperties(elementId);
    } catch {
        return undefined;
    }
    if (type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_POSITION && portId === "position") {
        return props.position;
    }
    if (type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_SIZE && portId === "size") {
        return props.size;
    }
    if (type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_BOUNDS && portId === "bounds") {
        return props.bounds;
    }
    if (type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_ROTATION && portId === "rotation") {
        return props.rotation;
    }
    if (type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_OPACITY && portId === "opacity") {
        return props.opacity;
    }
    if (type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VISIBLE && portId === "visible") {
        return props.visible;
    }
    if (type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VARIANT && portId === "variantId") {
        try {
            return api.widget.getCommonProperties(elementId).variantId ?? "";
        } catch {
            return undefined;
        }
    }
    if (type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY && portId === "value") {
        const property = toBlueprintString(params.property || "position");
        switch (property) {
            case "position":
                return props.position;
            case "size":
                return props.size;
            case "bounds":
                return props.bounds;
            case "x":
                return props.position.x;
            case "y":
                return props.position.y;
            case "width":
                return props.size.width;
            case "height":
                return props.size.height;
            case "rotation":
                return props.rotation;
            case "opacity":
                return props.opacity;
            case "visible":
                return props.visible;
            default:
                return undefined;
        }
    }
    return undefined;
}

function resolveTextNodeOutput(type: string, portId: string, runtime?: DataPinResolveRuntime): unknown {
    const elementId = runtime?.executionOwner?.elementId;
    const api = runtime?.hostAdapter?.blueprintRuntime?.hostApi;
    if (!elementId || !api) {
        return undefined;
    }
    let props: ReturnType<typeof api.widget.getTextProperties>;
    try {
        props = api.widget.getTextProperties(elementId);
    } catch {
        return undefined;
    }

    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT && portId === "text") {
        return props.text;
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_FONT && portId === "fontAssetId") {
        return props.fontAssetId ?? "";
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_SIZE && portId === "fontSize") {
        return props.fontSize;
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_WEIGHT && portId === "fontWeight") {
        return props.fontWeight;
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_COLOR && portId === "color") {
        return normalizeBlueprintRGBAColor(props.color);
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_ALIGN && portId === "textAlign") {
        return props.textAlign;
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_VERTICAL_ALIGN && portId === "textVerticalAlign") {
        return props.textVerticalAlign;
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_LINE_HEIGHT && portId === "lineHeight") {
        return props.lineHeight;
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_WRAP_MODE && portId === "textWrapMode") {
        return props.textWrapMode;
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_EFFECTS && portId === "effects") {
        return props.effects;
    }
    if (type === BLUEPRINT_NODE_TYPE_TEXT_GET_ALL_PROPERTIES) {
        if (portId === "fontAssetId") {
            return props.fontAssetId ?? "";
        }
        if (portId in props) {
            if (portId === "color") {
                return normalizeBlueprintRGBAColor(props.color);
            }
            return props[portId as keyof typeof props];
        }
    }
    return undefined;
}

function resolveSliderNodeOutput(
    graph: DataPinGraph,
    nodeId: string,
    type: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const isElementTarget =
        type === BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE ||
        type === BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_NORMALIZED_VALUE ||
        type === BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_RANGE;
    const ref = isElementTarget
        ? sameSurfaceElementRef(
            normalizeBlueprintElementRefValue(resolveInput(graph, nodeId, "slider", params, blueprintLocals, depth, runtime)),
            runtime,
        )
        : undefined;
    if (isElementTarget && ref?.elementType !== "nl.slider") {
        return undefined;
    }
    const elementId = isElementTarget ? ref?.elementId : runtime?.executionOwner?.elementId;
    const api = runtime?.hostAdapter?.blueprintRuntime?.hostApi;
    if (!elementId || !api) {
        return undefined;
    }
    let props: ReturnType<typeof api.widget.getSliderProperties>;
    try {
        props = api.widget.getSliderProperties(elementId);
    } catch {
        return undefined;
    }

    const read = (propPath: string, value: unknown) => {
        if (ref) {
            trackElementDependency(runtime, ref, propPath);
        }
        return value;
    };

    if ((type === BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE || type === BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE) && portId === "value") {
        return read("props.value", props.value);
    }
    if (
        (type === BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE ||
            type === BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_NORMALIZED_VALUE) &&
        portId === "normalizedValue"
    ) {
        return read("props.value", props.normalizedValue);
    }
    if (type === BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE || type === BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_RANGE) {
        if (portId === "min") {
            return read("props.min", props.min);
        }
        if (portId === "max") {
            return read("props.max", props.max);
        }
        if (portId === "step") {
            return read("props.step", props.step);
        }
    }
    return undefined;
}

function resolveListNodeOutput(
    graph: DataPinGraph,
    nodeId: string,
    type: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const isElementTarget =
        type === BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEMS ||
        type === BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_INDEX ||
        type === BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_ITEM;
    const elementId = resolveListElementIdInput(
        graph,
        nodeId,
        params,
        blueprintLocals,
        depth,
        runtime,
        isElementTarget ? "element" : "self",
    );
    const api = runtime?.hostAdapter?.blueprintRuntime?.hostApi;
    if (!elementId || !api) {
        return undefined;
    }
    let props: ReturnType<typeof api.widget.getListProperties>;
    try {
        props = api.widget.getListProperties(elementId);
    } catch {
        return undefined;
    }

    if ((type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS || type === BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEMS) && portId === "items") {
        return props.items;
    }
    if (
        (type === BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_INDEX ||
            type === BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_INDEX) &&
        portId === "index"
    ) {
        return props.selectedIndex;
    }
    if (
        (type === BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_ITEM ||
            type === BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_ITEM) &&
        portId === "item"
    ) {
        return props.selectedIndex >= 0 && props.selectedIndex < props.items.length
            ? props.items[props.selectedIndex]
            : null;
    }
    return undefined;
}

const WIDGET_PROPERTY_ELEMENT_TYPES: Record<string, string> = {
    container: "nl.container",
    text: "nl.text",
    image: "nl.image",
    button: "nl.button",
    slider: "nl.slider",
    list: "nl.list",
    frame: "nl.frame",
    frameWidget: "nl.frame",
};

function resolveWidgetPropertyNodeOutput(
    graph: DataPinGraph,
    nodeId: string,
    type: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    if (!type.startsWith("blueprint.")) {
        return undefined;
    }
    const parts = type.split(".");
    const elementTarget = parts[1] === "element";
    const key = elementTarget ? parts[2] : parts[1];
    const action = elementTarget ? parts[3] : parts[2];
    if (!key || !action?.startsWith("get")) {
        return undefined;
    }
    const expectedType = WIDGET_PROPERTY_ELEMENT_TYPES[key];
    if (!expectedType) {
        return undefined;
    }
    const api = runtime?.hostAdapter?.blueprintRuntime?.hostApi;
    if (!api) {
        return undefined;
    }

    let elementId: string | undefined;
    let ref: BlueprintElementRef | undefined;
    if (elementTarget) {
        ref = sameSurfaceElementRef(
            normalizeBlueprintElementRefValue(resolveInput(graph, nodeId, "element", params, blueprintLocals, depth, runtime)),
            runtime,
        );
        if (ref?.elementType !== expectedType) {
            return undefined;
        }
        elementId = ref.elementId;
    } else {
        elementId = runtime?.executionOwner?.elementId;
    }
    if (!elementId) {
        return undefined;
    }

    const read = (propPath: string, value: unknown) => {
        if (ref) {
            trackElementDependency(runtime, ref, propPath);
        }
        return value;
    };

    try {
        if (action === "getVisible" && portId === "visible") {
            return read("layout.visible", api.widget.getCommonProperties(elementId).visible);
        }
        if (action === "getEnabled" && portId === "enabled") {
            return read("props.interactionDisabled", api.widget.getCommonProperties(elementId).enabled);
        }
        if (action === "getVariant" && portId === "variantId") {
            return read("props.appearance.defaultVariantId", api.widget.getCommonProperties(elementId).variantId ?? "");
        }
        if (key === "button" && action === "getLabel" && portId === "label") {
            return read("props.label", api.widget.getButtonProperties(elementId).label);
        }
        if (key === "container" && action === "getClipContent" && portId === "clipContent") {
            return read("props.clipContent", api.widget.getContainerProperties(elementId).clipContent);
        }
        if (key === "image" && action === "getImageAsset" && portId === "asset") {
            return read("props.imageFill.assetId", api.widget.getImageProperties(elementId).asset ?? null);
        }
        if (key === "image" && action === "getImageAsset" && portId === "assetId") {
            const asset = api.widget.getImageProperties(elementId).asset;
            return read("props.imageFill.assetId", asset?.assetId ?? "");
        }
        if ((key === "frame" || key === "frameWidget") && action === "getTargetPage" && portId === "targetSurfaceId") {
            return read("props.targetSurfaceId", api.widget.getFrameProperties(elementId).targetSurfaceId ?? "");
        }
        if ((key === "frame" || key === "frameWidget") && action === "getParams" && portId === "params") {
            return read("props.params", api.widget.getFrameProperties(elementId).params);
        }
    } catch {
        return undefined;
    }
    return undefined;
}

function resolveDataNodeOutput(
    graph: DataPinGraph,
    nodeId: string,
    type: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LENGTH && portId === "length") {
        return normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime)).length;
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_GET && portId === "item") {
        const array = normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime));
        const index = toInteger(resolveInput(graph, nodeId, "index", params, blueprintLocals, depth, runtime), -1);
        return index >= 0 && index < array.length ? array[index] : null;
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH && portId === "length") {
        const value = resolveInput(graph, nodeId, "value", params, blueprintLocals, depth, runtime);
        return Array.isArray(value) ? value.length : 0;
    }
    if (portId !== "result") {
        return undefined;
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SET) {
        const array = normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime));
        const index = toInteger(resolveInput(graph, nodeId, "index", params, blueprintLocals, depth, runtime), -1);
        if (index < 0 || index > MAX_JSON_ARRAY_INDEX) {
            return array;
        }
        const out = [...array];
        out[index] = toJsonSafeValue(resolveInput(graph, nodeId, "item", params, blueprintLocals, depth, runtime));
        return out;
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_PUSH) {
        const array = normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime));
        return [
            ...array,
            toJsonSafeValue(resolveInput(graph, nodeId, "item", params, blueprintLocals, depth, runtime)),
        ];
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_INSERT) {
        const array = normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime));
        const index = clampInteger(resolveInput(graph, nodeId, "index", params, blueprintLocals, depth, runtime), 0, array.length, array.length);
        const out = [...array];
        out.splice(index, 0, toJsonSafeValue(resolveInput(graph, nodeId, "item", params, blueprintLocals, depth, runtime)));
        return out;
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE) {
        const array = normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime));
        const item = resolveInput(graph, nodeId, "item", params, blueprintLocals, depth, runtime);
        const index = array.findIndex(value => jsonValueEquals(value, item));
        if (index < 0) {
            return array;
        }
        const out = [...array];
        out.splice(index, 1);
        return out;
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE_AT) {
        const array = normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime));
        const index = toInteger(resolveInput(graph, nodeId, "index", params, blueprintLocals, depth, runtime), -1);
        if (index < 0 || index >= array.length) {
            return array;
        }
        const out = [...array];
        out.splice(index, 1);
        return out;
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS) {
        const array = normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime));
        const item = resolveInput(graph, nodeId, "item", params, blueprintLocals, depth, runtime);
        return array.some(value => jsonValueEquals(value, item));
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE) {
        const array = normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime));
        const start = clampInteger(resolveInput(graph, nodeId, "start", params, blueprintLocals, depth, runtime), 0, array.length, 0);
        const end = clampInteger(resolveInput(graph, nodeId, "end", params, blueprintLocals, depth, runtime), start, array.length, array.length);
        return array.slice(start, end);
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_JOIN) {
        const array = normalizeArrayValue(resolveInput(graph, nodeId, "array", params, blueprintLocals, depth, runtime));
        const separator = toBlueprintString(resolveInput(graph, nodeId, "separator", params, blueprintLocals, depth, runtime));
        return array.map(toBlueprintString).join(separator);
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_KEYS) {
        const object = toJsonSafeValue(resolveInput(graph, nodeId, "object", params, blueprintLocals, depth, runtime));
        return isJsonObjectRecord(object) ? Object.keys(object) : [];
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_VALUES) {
        const object = toJsonSafeValue(resolveInput(graph, nodeId, "object", params, blueprintLocals, depth, runtime));
        return isJsonObjectRecord(object) ? Object.values(object).map(value => toJsonSafeValue(value)) : [];
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_MERGE) {
        const a = resolveInput(graph, nodeId, "a", params, blueprintLocals, depth, runtime);
        const b = resolveInput(graph, nodeId, "b", params, blueprintLocals, depth, runtime);
        return mergeJsonObjectValues(a, b);
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_SET_FIELD) {
        const object = resolveInput(graph, nodeId, "object", params, blueprintLocals, depth, runtime);
        const field = toBlueprintString(resolveInput(graph, nodeId, "field", params, blueprintLocals, depth, runtime));
        const value = resolveInput(graph, nodeId, "value", params, blueprintLocals, depth, runtime);
        return setObjectFieldValue(object, field, value);
    }
    if (type === BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_REMOVE_FIELD) {
        const object = resolveInput(graph, nodeId, "object", params, blueprintLocals, depth, runtime);
        const field = toBlueprintString(resolveInput(graph, nodeId, "field", params, blueprintLocals, depth, runtime));
        return removeObjectFieldValue(object, field);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT) {
        return resolveJsonMakeObjectResult(graph, nodeId, params, blueprintLocals, depth, runtime);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY) {
        return resolveJsonMakeArrayResult(graph, nodeId, params, blueprintLocals, depth, runtime);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_SET) {
        const json = resolveInput(graph, nodeId, "json", params, blueprintLocals, depth, runtime);
        const path = toBlueprintString(resolveInput(graph, nodeId, "path", params, blueprintLocals, depth, runtime));
        const nextValue = resolveInput(graph, nodeId, "value", params, blueprintLocals, depth, runtime);
        return setJsonPath(json, path, nextValue);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE) {
        const json = resolveInput(graph, nodeId, "json", params, blueprintLocals, depth, runtime);
        const path = toBlueprintString(resolveInput(graph, nodeId, "path", params, blueprintLocals, depth, runtime));
        return removeJsonPath(json, path);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT) {
        const a = resolveInput(graph, nodeId, "a", params, blueprintLocals, depth, runtime);
        const b = resolveInput(graph, nodeId, "b", params, blueprintLocals, depth, runtime);
        return mergeJsonObjectValues(a, b);
    }
    const value = resolveInput(graph, nodeId, "value", params, blueprintLocals, depth, runtime);
    if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE) {
        return toJsonSafeValue(value);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_IS_STRING) {
        return typeof value === "string";
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER) {
        return typeof value === "number" && Number.isFinite(value);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN) {
        return typeof value === "boolean";
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY) {
        return Array.isArray(value);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT) {
        return isJsonObjectRecord(value);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_IS_NULL) {
        return value == null;
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_NOT_NULL) {
        return value != null;
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_IS_EMPTY_VALUE) {
        return isEmptyBlueprintValue(value);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT) {
        const n = toFiniteNumber(value);
        return Number.isNaN(n) ? 0 : n;
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER) {
        return toInteger(value, 0);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN) {
        return toBlueprintBoolean(value);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_TO_JSON) {
        return toBlueprintJson(value);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_PARSE_INT) {
        const parsed = parseInt(toBlueprintString(value).trim(), 10);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT) {
        const parsed = parseFloat(toBlueprintString(value).trim());
        return Number.isFinite(parsed) ? parsed : 0;
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON) {
        return parseBlueprintJson(value);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON) {
        return stringifyBlueprintJson(value);
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_GET) {
        const json = resolveInput(graph, nodeId, "json", params, blueprintLocals, depth, runtime);
        const path = toBlueprintString(resolveInput(graph, nodeId, "path", params, blueprintLocals, depth, runtime));
        const result = readJsonPath(json, path);
        return result.exists && result.value !== undefined ? result.value : null;
    }
    if (type === BLUEPRINT_NODE_TYPE_DATA_JSON_HAS) {
        const json = resolveInput(graph, nodeId, "json", params, blueprintLocals, depth, runtime);
        const path = toBlueprintString(resolveInput(graph, nodeId, "path", params, blueprintLocals, depth, runtime));
        return readJsonPath(json, path).exists;
    }
    return undefined;
}

function resolveSelfOutput(
    graph: DataPinGraph,
    nodeId: string,
    portId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const selfNode = graph.nodes?.[nodeId];
    if (!selfNode) {
        return undefined;
    }
    if (isElementBindingOutput(selfNode.type, portId)) {
        return readBlueprintElementRefParams(selfNode.params);
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL && portId === "value") {
        return normalizeBlueprintImageAssetValue(selfNode.params?.asset);
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS && portId === "props") {
        return listItemPropsValue(runtime?.listItemScope?.item);
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX && portId === "index") {
        return runtime?.listItemScope?.index ?? -1;
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_COUNT && portId === "count") {
        return runtime?.listItemScope?.count ?? 0;
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY && portId === "key") {
        return runtime?.listItemScope?.key ?? "";
    }
    if (portId === "value") {
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL) {
            return selfNode.params?.value;
        }
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_STRING) {
            return String(selfNode.params?.value ?? "");
        }
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_INTEGER) {
            return toInteger(selfNode.params?.value, 0);
        }
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_FLOAT || selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_NUMBER) {
            const n = Number(selfNode.params?.value ?? 0);
            return Number.isFinite(n) ? n : 0;
        }
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN) {
            return selfNode.params?.value === true || selfNode.params?.value === "true";
        }
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_NULL) {
            return null;
        }
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_COLOR) {
            return normalizeBlueprintRGBAColor(selfNode.params?.value);
        }
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D) {
            return normalizeBlueprintVector2D(selfNode.params?.value);
        }
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_RECT) {
            return toJsonSafeValue(selfNode.params?.value ?? { x: 0, y: 0, width: 0, height: 0 });
        }
        if (selfNode.type === BLUEPRINT_NODE_TYPE_LITERAL_JSON) {
            return selfNode.params?.value ?? null;
        }
    }
    if (isBlueprintEventDispatchHeadType(selfNode.type) && portId !== "then") {
        return runtime?.eventPayload?.[portId] ?? null;
    }
    if (
        (selfNode.type === BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP ||
            selfNode.type === BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH ||
            selfNode.type === BLUEPRINT_NODE_TYPE_PERSISTENT_GET ||
            selfNode.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS ||
            selfNode.type === BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW) &&
        (portId === "index" || portId === "item" || portId === "value" || portId === "ids" || portId === "preview")
    ) {
        return readBlueprintNodeOutputValue(blueprintLocals, nodeId, portId);
    }
    const mathOp = MATH_RESULT_OPS[selfNode.type];
    if (mathOp && portId === "result") {
        return resolveMathNodeResult(graph, nodeId, mathOp, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    const mathUnary = MATH_UNARY_OPS[selfNode.type];
    if (mathUnary && portId === "result") {
        return resolveMathUnaryResult(graph, nodeId, mathUnary, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    const mathCompare = MATH_COMPARE_OPS[selfNode.type];
    if (mathCompare && portId === "result") {
        return resolveMathCompareResult(graph, nodeId, mathCompare, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT && portId === "result") {
        return resolveMathRandomResult(graph, nodeId, false, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER && portId === "result") {
        return resolveMathRandomResult(graph, nodeId, true, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    const booleanOp = BOOLEAN_OPS[selfNode.type];
    if (booleanOp && portId === "result") {
        return resolveBooleanNodeResult(graph, nodeId, booleanOp, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    const compareOp = COMPARE_OPS[selfNode.type];
    if (compareOp && portId === "result") {
        return resolveCompareNodeResult(graph, nodeId, compareOp, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT) {
        return resolveBroadcastNodeOutput(graph, nodeId, portId, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM) {
        return resolveFrameNodeOutput(graph, nodeId, portId, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    if (selfNode.type === BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG) {
        return resolveGameNodeOutput(portId, runtime);
    }
    const elementTextOutput = resolveElementTextNodeOutput(
        graph,
        nodeId,
        selfNode.type,
        portId,
        selfNode.params ?? {},
        blueprintLocals,
        depth,
        runtime,
    );
    if (elementTextOutput !== undefined) {
        return elementTextOutput;
    }
    const elementDisplayableOutput = resolveElementDisplayableNodeOutput(
        graph,
        nodeId,
        selfNode.type,
        portId,
        selfNode.params ?? {},
        blueprintLocals,
        depth,
        runtime,
    );
    if (elementDisplayableOutput !== undefined) {
        return elementDisplayableOutput;
    }
    const selfDisplayableOutput = resolveSelfDisplayableNodeOutput(selfNode.type, portId, selfNode.params ?? {}, runtime);
    if (selfDisplayableOutput !== undefined) {
        return selfDisplayableOutput;
    }
    const textOutput = resolveTextNodeOutput(selfNode.type, portId, runtime);
    if (textOutput !== undefined) {
        return textOutput;
    }
    const sliderOutput = resolveSliderNodeOutput(
        graph,
        nodeId,
        selfNode.type,
        portId,
        selfNode.params ?? {},
        blueprintLocals,
        depth,
        runtime,
    );
    if (sliderOutput !== undefined) {
        return sliderOutput;
    }
    const listOutput = resolveListNodeOutput(
        graph,
        nodeId,
        selfNode.type,
        portId,
        selfNode.params ?? {},
        blueprintLocals,
        depth,
        runtime,
    );
    if (listOutput !== undefined) {
        return listOutput;
    }
    const widgetPropertyOutput = resolveWidgetPropertyNodeOutput(
        graph,
        nodeId,
        selfNode.type,
        portId,
        selfNode.params ?? {},
        blueprintLocals,
        depth,
        runtime,
    );
    if (widgetPropertyOutput !== undefined) {
        return widgetPropertyOutput;
    }
    const dataOutput = resolveDataNodeOutput(
        graph,
        nodeId,
        selfNode.type,
        portId,
        selfNode.params ?? {},
        blueprintLocals,
        depth,
        runtime,
    );
    if (dataOutput !== undefined) {
        return dataOutput;
    }
    return resolveStringNodeOutput(
        graph,
        nodeId,
        selfNode.type,
        portId,
        selfNode.params ?? {},
        blueprintLocals,
        depth,
        runtime,
    );
}

function isOutputPort(
    graph: DataPinGraph,
    nodeId: string,
    portId: string,
    params: Record<string, unknown>,
): boolean {
    const node = graph.nodes?.[nodeId];
    if (!node) {
        return false;
    }
    const def = blueprintNodeRegistry.get(node.type);
    if (!def) {
        return false;
    }
    return resolveEffectiveBlueprintNodePins(def, node.params ?? params).some(
        pin => pin.kind === "output" && pin.id === portId,
    );
}

/**
 * Resolve the value feeding an input data pin, or an output value for pure data nodes.
 */
export function resolveDataPinValue(
    graph: DataPinGraph,
    consumerNodeId: string,
    consumerPortId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth = 0,
    runtime?: DataPinResolveRuntime,
): unknown {
    if (depth > MAX_RESOLVE_DEPTH) {
        return undefined;
    }

    const edge = graph.edges?.find(e => e.to.nodeId === consumerNodeId && e.to.port === consumerPortId);
    if (!edge) {
        if (isOutputPort(graph, consumerNodeId, consumerPortId, params)) {
            const selfOutput = resolveSelfOutput(
                graph,
                consumerNodeId,
                consumerPortId,
                params,
                blueprintLocals,
                depth,
                runtime,
            );
            if (selfOutput !== undefined) {
                return selfOutput;
            }
        }
        if (consumerPortId === "condition") {
            return false;
        }
        return params[consumerPortId];
    }

    const src = graph.nodes?.[edge.from.nodeId];
    if (!src) {
        return undefined;
    }
    let value: unknown;
    if (src.type === BLUEPRINT_NODE_TYPE_LITERAL && edge.from.port === "value") {
        value = src.params?.value;
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_STRING && edge.from.port === "value") {
        value = String(src.params?.value ?? "");
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_INTEGER && edge.from.port === "value") {
        value = toInteger(src.params?.value, 0);
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_FLOAT && edge.from.port === "value") {
        const n = Number(src.params?.value ?? 0);
        value = Number.isFinite(n) ? n : 0;
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_NUMBER && edge.from.port === "value") {
        const n = Number(src.params?.value ?? 0);
        value = Number.isFinite(n) ? n : 0;
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN && edge.from.port === "value") {
        value = src.params?.value === true || src.params?.value === "true";
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_NULL && edge.from.port === "value") {
        value = null;
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_COLOR && edge.from.port === "value") {
        value = normalizeBlueprintRGBAColor(src.params?.value);
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D && edge.from.port === "value") {
        value = normalizeBlueprintVector2D(src.params?.value);
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_RECT && edge.from.port === "value") {
        value = toJsonSafeValue(src.params?.value ?? { x: 0, y: 0, width: 0, height: 0 });
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_JSON && edge.from.port === "value") {
        value = src.params?.value ?? null;
    } else if (isElementBindingOutput(src.type, edge.from.port)) {
        value = readBlueprintElementRefParams(src.params);
    } else if (src.type === BLUEPRINT_NODE_TYPE_LOCAL_GET && edge.from.port === "value") {
        const vid = String(src.params?.variableId ?? "").trim();
        if (!vid || !blueprintLocals) {
            return undefined;
        }
        value = blueprintLocals[vid];
    } else {
        value = resolveDataPinValue(
            graph,
            edge.from.nodeId,
            edge.from.port,
            src.params ?? {},
            blueprintLocals,
            depth + 1,
            runtime,
        );
    }
    return coerceEdgeValueForTarget({
        value,
        graph,
        edge,
        consumerParams: params,
    });
}

export function resolveIfCondition(
    graph: DataPinGraph,
    node: { id: string },
    params: Record<string, unknown>,
    blueprintLocals?: Record<string, unknown>,
    runtime?: DataPinResolveRuntime,
): unknown {
    return resolveDataPinValue(graph, node.id, "condition", params, blueprintLocals, 0, runtime);
}
