/**
 * Blueprint graph taxonomy — kinds, node type constants, and rules for editors / validators.
 * Comments in English per project convention.
 */

import { getWidgetLogicEvent } from "@shared/types/ui-editor/widgetLogic";
import {
    resolveGlobalLifecycleEventHeadTypes,
    resolveSurfaceLifecycleEventHeadTypes,
} from "@shared/types/ui-editor/blueprintLifecycle";

/** Persisted on BlueprintGraphIr.meta to disambiguate slot semantics (events vs functions vs macros). */
export type BlueprintGraphKind = "event" | "function" | "macro";

/** Well-known blueprint node type ids (stable contract). */
/** Entry for widget `init` UI event (surface mount). */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT = "blueprint.event.head.init" as const;
/** Entry for Blueprint Value refresh evaluation. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH = "blueprint.event.head.flush" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK = "blueprint.event.head.mouseClick" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOUBLE_CLICK = "blueprint.event.head.mouseDoubleClick" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER = "blueprint.event.head.mouseEnter" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_LEAVE = "blueprint.event.head.mouseLeave" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_MOVE = "blueprint.event.head.mouseMove" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN = "blueprint.event.head.mouseDown" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP = "blueprint.event.head.mouseUp" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL = "blueprint.event.head.mouseWheel" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK = "blueprint.event.head.rightClick" as const;
/** Entry for widget `focus` UI event. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS = "blueprint.event.head.focus" as const;
/** Entry for widget `blur` UI event. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR = "blueprint.event.head.blur" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL = "blueprint.event.head.scroll" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST = "blueprint.event.head.onAnyBroadcast" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST = "blueprint.event.head.onBroadcast" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT = "blueprint.event.head.pageEvent" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER = "blueprint.event.head.itemRender" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK = "blueprint.event.head.itemClick" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER = "blueprint.event.head.itemHover" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED = "blueprint.event.head.selectionChanged" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END = "blueprint.event.head.scrollEnd" as const;
/** Entry for global `appBoot` lifecycle event (application start). */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT = "blueprint.event.head.appBoot" as const;
/** Entry for surface `surfaceInit` lifecycle event (page entered). */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT = "blueprint.event.head.surfaceInit" as const;
/** Entry for surface `surfaceUnmount` lifecycle event (page left). */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT = "blueprint.event.head.surfaceUnmount" as const;

const EVENT_DISPATCH_HEAD_TYPES: ReadonlySet<string> = new Set([
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOUBLE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_LEAVE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_MOVE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
]);

/**
 * Resolve which event-head node type(s) may run for a widget private event slot id.
 * Unknown slots fall back to all registered dispatch heads (forward-compatible).
 */
export function resolveBlueprintEventHeadTypesForUiSlot(slotId: string, widgetElementType?: string): readonly string[] {
    const eventDef = getWidgetLogicEvent(widgetElementType, slotId);
    if (!eventDef) {
        return [];
    }
    if (eventDef.headNodeTypes && eventDef.headNodeTypes.length > 0) {
        return eventDef.headNodeTypes;
    }
    return [...EVENT_DISPATCH_HEAD_TYPES];
}

/** All node type ids that may start an event graph chain (for validation / normalization). */
export function listBlueprintEventDispatchHeadTypes(): readonly string[] {
    return [...EVENT_DISPATCH_HEAD_TYPES];
}

/** True if this node type can start an event-graph execution chain for UI dispatch. */
export function isBlueprintEventDispatchHeadType(nodeType: string): boolean {
    return EVENT_DISPATCH_HEAD_TYPES.has(nodeType);
}

/**
 * Pick graph node ids that are valid entry heads for a UI dispatch `eventName` (slot id).
 */
export function collectBlueprintEventHeadNodeIdsForDispatch(
    nodes: Record<string, { type: string }> | undefined,
    eventName: string,
    widgetElementType?: string,
): string[] {
    const n = nodes ?? {};
    const allowed = new Set(resolveBlueprintEventHeadTypesForUiSlot(eventName, widgetElementType));
    if (allowed.size === 0) {
        return [];
    }
    return Object.entries(n)
        .filter(([, node]) => allowed.has(node.type))
        .map(([id]) => id)
        .sort();
}

/**
 * Resolve which event-head node types are valid for a surface lifecycle event.
 */
export function resolveSurfaceEventHeadTypes(eventName: string): readonly string[] {
    return resolveSurfaceLifecycleEventHeadTypes(eventName);
}

/**
 * Resolve which event-head node types are valid for a global lifecycle event.
 */
export function resolveGlobalEventHeadTypes(eventName: string): readonly string[] {
    return resolveGlobalLifecycleEventHeadTypes(eventName);
}

/**
 * Pick graph node ids that are valid entry heads for a surface lifecycle event.
 */
export function collectSurfaceEventHeadNodeIdsForDispatch(
    nodes: Record<string, { type: string }> | undefined,
    eventName: string,
): string[] {
    const n = nodes ?? {};
    const allowed = new Set(resolveSurfaceEventHeadTypes(eventName));
    if (allowed.size === 0) {
        return [];
    }
    return Object.entries(n)
        .filter(([, node]) => allowed.has(node.type))
        .map(([id]) => id)
        .sort();
}

/**
 * Pick graph node ids that are valid entry heads for a global lifecycle event.
 */
export function collectGlobalEventHeadNodeIdsForDispatch(
    nodes: Record<string, { type: string }> | undefined,
    eventName: string,
): string[] {
    const n = nodes ?? {};
    const allowed = new Set(resolveGlobalEventHeadTypes(eventName));
    if (allowed.size === 0) {
        return [];
    }
    return Object.entries(n)
        .filter(([, node]) => allowed.has(node.type))
        .map(([id]) => id)
        .sort();
}
export const BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY = "blueprint.function.entry" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL = "blueprint.data.literal" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_STRING = "blueprint.data.stringLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_NUMBER = "blueprint.data.numberLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN = "blueprint.data.booleanLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_NULL = "blueprint.data.nullLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_JSON = "blueprint.data.jsonLiteral" as const;
export const BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE = "blueprint.data.returnValue" as const;
export const BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT = "blueprint.data.toFloat" as const;
export const BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER = "blueprint.data.toInteger" as const;
export const BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN = "blueprint.data.toBoolean" as const;
export const BLUEPRINT_NODE_TYPE_DATA_TO_JSON = "blueprint.data.toJson" as const;
export const BLUEPRINT_NODE_TYPE_DATA_PARSE_INT = "blueprint.data.parseInt" as const;
export const BLUEPRINT_NODE_TYPE_DATA_PARSE_FLOAT = "blueprint.data.parseFloat" as const;
export const BLUEPRINT_NODE_TYPE_DATA_PARSE_JSON = "blueprint.data.parseJson" as const;
export const BLUEPRINT_NODE_TYPE_DATA_STRINGIFY_JSON = "blueprint.data.stringifyJson" as const;
export const BLUEPRINT_NODE_TYPE_DATA_JSON_GET = "blueprint.data.jsonGet" as const;
export const BLUEPRINT_NODE_TYPE_DATA_JSON_HAS = "blueprint.data.jsonHas" as const;
export const BLUEPRINT_NODE_TYPE_DATA_JSON_SET = "blueprint.data.jsonSet" as const;
export const BLUEPRINT_NODE_TYPE_DATA_JSON_REMOVE = "blueprint.data.jsonRemove" as const;
export const BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_OBJECT = "blueprint.data.jsonMakeObject" as const;
export const BLUEPRINT_NODE_TYPE_DATA_JSON_MAKE_ARRAY = "blueprint.data.jsonMakeArray" as const;
export const BLUEPRINT_NODE_TYPE_DATA_JSON_ARRAY_LENGTH = "blueprint.data.jsonArrayLength" as const;
export const BLUEPRINT_NODE_TYPE_DATA_JSON_MERGE_OBJECT = "blueprint.data.jsonMergeObject" as const;
export const BLUEPRINT_NODE_TYPE_DATA_JSON_CLONE = "blueprint.data.jsonClone" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_IF = "if" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_NOOP = "blueprint.flow.noop" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING = "blueprint.flow.switchString" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP = "blueprint.flow.forLoop" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH = "blueprint.flow.forEach" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_WHILE = "blueprint.flow.while" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_DELAY = "blueprint.flow.delay" as const;
/** Read blueprint execution local variable (pure data source). */
export const BLUEPRINT_NODE_TYPE_LOCAL_GET = "blueprint.local.get" as const;
/** Write blueprint execution local variable. */
export const BLUEPRINT_NODE_TYPE_LOCAL_SET = "blueprint.local.set" as const;
/** Persisted helper param for variableRef nodes whose pin type follows the selected variable. */
export const BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE = "__variableValueType" as const;
/** Console log from wired data pin (Studio / Dev Mode). */
export const BLUEPRINT_NODE_TYPE_LOG = "blueprint.log" as const;
/** Pure numeric math (data-only). */
export const BLUEPRINT_NODE_TYPE_MATH_ADD = "blueprint.math.add" as const;
export const BLUEPRINT_NODE_TYPE_MATH_SUBTRACT = "blueprint.math.subtract" as const;
export const BLUEPRINT_NODE_TYPE_MATH_MULTIPLY = "blueprint.math.multiply" as const;
export const BLUEPRINT_NODE_TYPE_MATH_DIVIDE = "blueprint.math.divide" as const;
/** Unary add-one: result = value + 1 (pure data). */
export const BLUEPRINT_NODE_TYPE_MATH_INCREMENT = "blueprint.math.increment" as const;
/** Unary subtract-one: result = value - 1 (pure data). */
export const BLUEPRINT_NODE_TYPE_MATH_DECREMENT = "blueprint.math.decrement" as const;
/** Pure float comparison: result is boolean (pure data). */
export const BLUEPRINT_NODE_TYPE_MATH_EQUAL = "blueprint.math.equal" as const;
export const BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL = "blueprint.math.notEqual" as const;
export const BLUEPRINT_NODE_TYPE_MATH_LESS = "blueprint.math.less" as const;
export const BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL = "blueprint.math.lessOrEqual" as const;
export const BLUEPRINT_NODE_TYPE_MATH_GREATER = "blueprint.math.greater" as const;
export const BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL = "blueprint.math.greaterOrEqual" as const;

/** Concatenate two strings (pure data). */
export const BLUEPRINT_NODE_TYPE_STRING_TO_STRING = "blueprint.string.toString" as const;
export const BLUEPRINT_NODE_TYPE_STRING_CONCAT = "blueprint.string.concat" as const;
export const BLUEPRINT_NODE_TYPE_STRING_FORMAT = "blueprint.string.format" as const;
/** String length (UTF-16 code units, pure data). */
export const BLUEPRINT_NODE_TYPE_STRING_LENGTH = "blueprint.string.length" as const;
export const BLUEPRINT_NODE_TYPE_STRING_IS_EMPTY = "blueprint.string.isEmpty" as const;
export const BLUEPRINT_NODE_TYPE_STRING_IS_BLANK = "blueprint.string.isBlank" as const;
export const BLUEPRINT_NODE_TYPE_STRING_TRIM = "blueprint.string.trim" as const;
export const BLUEPRINT_NODE_TYPE_STRING_TRIM_START = "blueprint.string.trimStart" as const;
export const BLUEPRINT_NODE_TYPE_STRING_TRIM_END = "blueprint.string.trimEnd" as const;
export const BLUEPRINT_NODE_TYPE_STRING_TO_UPPER = "blueprint.string.toUpperCase" as const;
export const BLUEPRINT_NODE_TYPE_STRING_TO_LOWER = "blueprint.string.toLowerCase" as const;
export const BLUEPRINT_NODE_TYPE_STRING_CAPITALIZE = "blueprint.string.capitalize" as const;
export const BLUEPRINT_NODE_TYPE_STRING_CONTAINS = "blueprint.string.contains" as const;
export const BLUEPRINT_NODE_TYPE_STRING_STARTS_WITH = "blueprint.string.startsWith" as const;
export const BLUEPRINT_NODE_TYPE_STRING_ENDS_WITH = "blueprint.string.endsWith" as const;
export const BLUEPRINT_NODE_TYPE_STRING_EQUALS = "blueprint.string.equals" as const;
export const BLUEPRINT_NODE_TYPE_STRING_EQUALS_IGNORE_CASE = "blueprint.string.equalsIgnoreCase" as const;
export const BLUEPRINT_NODE_TYPE_STRING_INDEX_OF = "blueprint.string.indexOf" as const;
export const BLUEPRINT_NODE_TYPE_STRING_LAST_INDEX_OF = "blueprint.string.lastIndexOf" as const;
export const BLUEPRINT_NODE_TYPE_STRING_COUNT = "blueprint.string.count" as const;
export const BLUEPRINT_NODE_TYPE_STRING_CHAR_AT = "blueprint.string.charAt" as const;
export const BLUEPRINT_NODE_TYPE_STRING_SUBSTRING = "blueprint.string.substring" as const;
export const BLUEPRINT_NODE_TYPE_STRING_INSERT = "blueprint.string.insert" as const;
export const BLUEPRINT_NODE_TYPE_STRING_REPLACE = "blueprint.string.replace" as const;
export const BLUEPRINT_NODE_TYPE_STRING_REPLACE_ALL = "blueprint.string.replaceAll" as const;
export const BLUEPRINT_NODE_TYPE_STRING_SPLIT = "blueprint.string.split" as const;
export const BLUEPRINT_NODE_TYPE_STRING_JOIN = "blueprint.string.join" as const;
export const BLUEPRINT_NODE_TYPE_STRING_REPEAT = "blueprint.string.repeat" as const;
export const BLUEPRINT_NODE_TYPE_STRING_PAD_START = "blueprint.string.padStart" as const;
export const BLUEPRINT_NODE_TYPE_STRING_PAD_END = "blueprint.string.padEnd" as const;
export const BLUEPRINT_NODE_TYPE_STRING_MATCHES_REGEX = "blueprint.string.matchesRegex" as const;
export const BLUEPRINT_NODE_TYPE_STRING_EXTRACT_REGEX = "blueprint.string.extractRegex" as const;
export const BLUEPRINT_NODE_TYPE_STRING_NORMALIZE_LINE_BREAKS = "blueprint.string.normalizeLineBreaks" as const;

export const BLUEPRINT_NODE_TYPE_BROADCAST_SEND = "blueprint.broadcast.send" as const;
export const BLUEPRINT_NODE_TYPE_BROADCAST_GET_LISTENER_COUNT = "blueprint.broadcast.getListenerCount" as const;
export const BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM = "blueprint.frame.getParam" as const;
export const BLUEPRINT_NODE_TYPE_FRAME_EMIT = "blueprint.frame.emit" as const;

export const BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT = "blueprint.text.getText" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT = "blueprint.text.setText" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_APPEND_TEXT = "blueprint.text.appendText" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_CLEAR_TEXT = "blueprint.text.clearText" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_FONT = "blueprint.text.getFont" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_FONT = "blueprint.text.setFont" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_SIZE = "blueprint.text.getFontSize" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_FONT_SIZE = "blueprint.text.setFontSize" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_FONT_WEIGHT = "blueprint.text.getFontWeight" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_FONT_WEIGHT = "blueprint.text.setFontWeight" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_COLOR = "blueprint.text.getTextColor" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_COLOR = "blueprint.text.setTextColor" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_ALIGN = "blueprint.text.getTextAlign" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_ALIGN = "blueprint.text.setTextAlign" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_TEXT_VERTICAL_ALIGN = "blueprint.text.getTextVerticalAlign" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_TEXT_VERTICAL_ALIGN = "blueprint.text.setTextVerticalAlign" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_LINE_HEIGHT = "blueprint.text.getLineHeight" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_LINE_HEIGHT = "blueprint.text.setLineHeight" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_WRAP_MODE = "blueprint.text.getWrapMode" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_WRAP_MODE = "blueprint.text.setWrapMode" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_EFFECTS = "blueprint.text.getEffects" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_EFFECTS = "blueprint.text.setEffects" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_GET_ALL_PROPERTIES = "blueprint.text.getAllProperties" as const;
export const BLUEPRINT_NODE_TYPE_TEXT_SET_ALL_PROPERTIES = "blueprint.text.setAllProperties" as const;

/** IR meta key for graph kind (string value matches BlueprintGraphKind). */
export const BLUEPRINT_GRAPH_IR_META_KIND = "graphKind" as const;

export type BlueprintGraphKindRules = {
    /** Graph kind id */
    kind: BlueprintGraphKind;
    /** Whether effectful / Host API nodes are allowed */
    allowsEffectfulNodes: boolean;
    /** Whether a dedicated entry node type is required at runtime */
    requiresDedicatedEntryNode: boolean;
    /** Node type id for the entry node, if required (event graphs may use several head types). */
    entryNodeType?:
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT
        | typeof BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY;
    /** Whether UI may bind widget events directly to this graph slot */
    bindableFromWidgetUi: boolean;
};

const RULES: Record<BlueprintGraphKind, BlueprintGraphKindRules> = {
    event: {
        kind: "event",
        allowsEffectfulNodes: true,
        requiresDedicatedEntryNode: false,
        entryNodeType: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
        bindableFromWidgetUi: true,
    },
    function: {
        kind: "function",
        allowsEffectfulNodes: false,
        requiresDedicatedEntryNode: true,
        entryNodeType: BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY,
        bindableFromWidgetUi: false,
    },
    macro: {
        kind: "macro",
        allowsEffectfulNodes: true,
        requiresDedicatedEntryNode: false,
        bindableFromWidgetUi: false,
    },
};

export function getBlueprintGraphKindRules(kind: BlueprintGraphKind): BlueprintGraphKindRules {
    return RULES[kind];
}

export function parseBlueprintGraphKind(raw: unknown): BlueprintGraphKind | undefined {
    if (raw === "event" || raw === "function" || raw === "macro") {
        return raw;
    }
    return undefined;
}
