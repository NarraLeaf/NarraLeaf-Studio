/**
 * Resolve wired / inspector params for nodes that read from graph IR data pins.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT,
    BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
    BLUEPRINT_NODE_TYPE_DATA_JSON_GET,
    BLUEPRINT_NODE_TYPE_DATA_JSON_HAS,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_INT,
    BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON,
    BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON,
    BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN,
    BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT,
    BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER,
    BLUEPRINT_NODE_TYPE_DATA_TO_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL,
    BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN,
    BLUEPRINT_NODE_TYPE_LITERAL_JSON,
    BLUEPRINT_NODE_TYPE_LITERAL_NULL,
    BLUEPRINT_NODE_TYPE_LITERAL_NUMBER,
    BLUEPRINT_NODE_TYPE_LITERAL_STRING,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
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
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { blueprintNodeRegistry } from "../BlueprintNodeRegistry";
import { resolveEffectiveBlueprintNodePins } from "../effectivePins";

const MAX_RESOLVE_DEPTH = 32;
const MAX_REPEAT_COUNT = 10000;

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

export type DataPinGraph = {
    edges?: Array<{ from: { nodeId: string; port: string }; to: { nodeId: string; port: string } }>;
    nodes?: Record<string, { type: string; params?: Record<string, unknown> }>;
};

export type DataPinResolveRuntime = {
    hostAdapter?: UIHostAdapter;
    eventPayload?: Record<string, unknown>;
    executionOwner?: {
        surfaceId?: string;
        elementId?: string;
        blueprintId?: string;
    };
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

function toBlueprintJson(v: unknown): unknown {
    if (v === undefined) {
        return null;
    }
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
    if (typeof v === "number") {
        return Number.isFinite(v) ? v : null;
    }
    if (typeof v === "bigint" || typeof v === "symbol" || typeof v === "function") {
        return String(v);
    }
    return v;
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
        (node.type === BLUEPRINT_NODE_TYPE_LOCAL_SET && input.portId === "value")
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

function resolveMathAddVariadic(
    graph: DataPinGraph,
    nodeId: string,
    params: Record<string, unknown>,
    blueprintLocals: Record<string, unknown> | undefined,
    depth: number,
    runtime?: DataPinResolveRuntime,
): unknown {
    const def = blueprintNodeRegistry.get(BLUEPRINT_NODE_TYPE_MATH_ADD);
    if (!def) {
        return NaN;
    }
    const pins = resolveEffectiveBlueprintNodePins(def, params);
    const dataIn = pins.filter(p => p.kind === "input" && p.semantic === "data");
    let acc: number | null = null;
    for (const pin of dataIn) {
        const n = toFiniteNumber(resolveInput(graph, nodeId, pin.id, params, blueprintLocals, depth, runtime));
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
    runtime?: DataPinResolveRuntime,
): unknown {
    if (op === "add" && graph.nodes?.[nodeId]?.type === BLUEPRINT_NODE_TYPE_MATH_ADD) {
        return resolveMathAddVariadic(graph, nodeId, params, blueprintLocals, depth, runtime);
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
    runtime?: DataPinResolveRuntime,
): unknown {
    const n = toFiniteNumber(resolveInput(graph, nodeId, "value", params, blueprintLocals, depth, runtime));
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
        return props.color;
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
            return props[portId as keyof typeof props];
        }
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
    if (portId !== "result") {
        return undefined;
    }
    const value = resolveInput(graph, nodeId, "value", params, blueprintLocals, depth, runtime);
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
    if (isBlueprintEventDispatchHeadType(selfNode.type) && portId !== "then") {
        return runtime?.eventPayload?.[portId];
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
    if (selfNode.type === BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT) {
        return resolveBroadcastNodeOutput(graph, nodeId, portId, selfNode.params ?? {}, blueprintLocals, depth, runtime);
    }
    const textOutput = resolveTextNodeOutput(selfNode.type, portId, runtime);
    if (textOutput !== undefined) {
        return textOutput;
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

    const selfOutput = resolveSelfOutput(graph, consumerNodeId, consumerPortId, params, blueprintLocals, depth, runtime);
    if (selfOutput !== undefined) {
        return selfOutput;
    }

    const edge = graph.edges?.find(e => e.to.nodeId === consumerNodeId && e.to.port === consumerPortId);
    if (!edge) {
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
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_NUMBER && edge.from.port === "value") {
        const n = Number(src.params?.value ?? 0);
        value = Number.isFinite(n) ? n : 0;
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN && edge.from.port === "value") {
        value = src.params?.value === true || src.params?.value === "true";
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_NULL && edge.from.port === "value") {
        value = null;
    } else if (src.type === BLUEPRINT_NODE_TYPE_LITERAL_JSON && edge.from.port === "value") {
        value = src.params?.value ?? null;
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
