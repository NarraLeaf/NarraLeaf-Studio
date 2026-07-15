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
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK = "blueprint.event.head.mouseClick" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOUBLE_CLICK = "blueprint.event.head.mouseDoubleClick" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER = "blueprint.event.head.mouseEnter" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_LEAVE = "blueprint.event.head.mouseLeave" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_MOVE = "blueprint.event.head.mouseMove" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN = "blueprint.event.head.mouseDown" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP = "blueprint.event.head.mouseUp" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL = "blueprint.event.head.mouseWheel" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK = "blueprint.event.head.rightClick" as const;
/** Entry for owner-level global keyboard down events. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN = "blueprint.event.head.keyDown" as const;
/** Entry for owner-level global keyboard up events. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP = "blueprint.event.head.keyUp" as const;
/** Entry for owner-level global keyboard down events without a key filter. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN = "blueprint.event.head.anyKeyDown" as const;
/** Entry for owner-level global keyboard up events without a key filter. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP = "blueprint.event.head.anyKeyUp" as const;
/** Persisted on On Key event heads: keyboard binding string to match, case-insensitive. */
export const BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME = "key" as const;
/** Inspector param key selecting which Game Preference field an `On Preference Changed` head watches. */
export const BLUEPRINT_NODE_PARAM_EVENT_HEAD_PREFERENCE_KEY = "preferenceKey" as const;
/** Entry for widget `focus` UI event. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS = "blueprint.event.head.focus" as const;
/** Entry for widget `blur` UI event. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR = "blueprint.event.head.blur" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH = "blueprint.event.head.flush" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT = "blueprint.event.head.unmount" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT = "blueprint.event.head.beforeSurfaceExit" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER = "blueprint.event.head.afterSurfaceEnter" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH = "blueprint.event.head.elementFlush" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK = "blueprint.event.head.elementClick" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL = "blueprint.event.head.scroll" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST = "blueprint.event.head.onAnyBroadcast" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST = "blueprint.event.head.onBroadcast" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT = "blueprint.event.head.pageEvent" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER = "blueprint.event.head.itemRender" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK = "blueprint.event.head.itemClick" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER = "blueprint.event.head.itemHover" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH = "blueprint.event.head.listItemRefresh" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED = "blueprint.event.head.selectionChanged" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END = "blueprint.event.head.scrollEnd" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START = "blueprint.event.head.sliderDragStart" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED = "blueprint.event.head.sliderValueChanged" as const;
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END = "blueprint.event.head.sliderDragEnd" as const;
/** Entry for global `appBoot` lifecycle event (application start). */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT = "blueprint.event.head.appBoot" as const;
/** Entry for global NarraLeaf game runtime readiness. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY = "blueprint.event.head.gameReady" as const;
/** Entry for surface `surfaceInit` lifecycle event (page entered). */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT = "blueprint.event.head.surfaceInit" as const;
/** Entry for surface `surfaceUnmount` lifecycle event (page left). */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT = "blueprint.event.head.surfaceUnmount" as const;
/** Entry for a specific NarraLeaf game preference change (e.g. BGM Volume) on the active live game. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED = "blueprint.event.head.preferenceChanged" as const;
/** Entry for any NarraLeaf game preference change on the active live game. */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED = "blueprint.event.head.anyPreferenceChanged" as const;
/**
 * Entry for a Story Action Blueprint's single "On Call" event. Deliberately kept OUT of
 * EVENT_DISPATCH_HEAD_TYPES — story-action graphs run via the story compiler's Script wrapper,
 * never through the UI dispatch paths.
 */
export const BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL = "blueprint.event.head.onCall" as const;

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
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED,
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

export type BlueprintKeyboardEventLike = {
    key?: unknown;
    altKey?: unknown;
    ctrlKey?: unknown;
    shiftKey?: unknown;
    metaKey?: unknown;
};

export type BlueprintKeyboardBinding = {
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    shiftKey: boolean;
    metaKey: boolean;
    /** True when the binding text explicitly includes at least one modifier token. */
    hasExplicitModifiers: boolean;
};

type BlueprintKeyboardModifierFlag = "altKey" | "ctrlKey" | "shiftKey" | "metaKey";

const BLUEPRINT_KEYBOARD_MODIFIER_ORDER: BlueprintKeyboardModifierFlag[] = [
    "ctrlKey",
    "altKey",
    "shiftKey",
    "metaKey",
];

const BLUEPRINT_KEYBOARD_MODIFIER_LABELS: Record<BlueprintKeyboardModifierFlag, string> = {
    altKey: "Alt",
    ctrlKey: "Ctrl",
    shiftKey: "Shift",
    metaKey: "Meta",
};

const BLUEPRINT_KEYBOARD_MODIFIER_ALIASES: Record<string, BlueprintKeyboardModifierFlag> = {
    alt: "altKey",
    option: "altKey",
    ctrl: "ctrlKey",
    control: "ctrlKey",
    shift: "shiftKey",
    meta: "metaKey",
    cmd: "metaKey",
    command: "metaKey",
    win: "metaKey",
    windows: "metaKey",
};

const BLUEPRINT_KEYBOARD_MODIFIER_KEYS: Record<string, BlueprintKeyboardModifierFlag> = {
    alt: "altKey",
    control: "ctrlKey",
    shift: "shiftKey",
    meta: "metaKey",
};

const BLUEPRINT_KEYBOARD_KEY_ALIASES: Record<string, string> = {
    " ": "space",
    spacebar: "space",
    esc: "escape",
    return: "enter",
    del: "delete",
    plus: "+",
    add: "+",
    left: "arrowleft",
    right: "arrowright",
    up: "arrowup",
    down: "arrowdown",
};

const BLUEPRINT_KEYBOARD_KEY_LABELS: Record<string, string> = {
    "+": "Plus",
    " ": "Space",
    alt: "Alt",
    arrowdown: "Arrow Down",
    arrowleft: "Arrow Left",
    arrowright: "Arrow Right",
    arrowup: "Arrow Up",
    control: "Ctrl",
    delete: "Delete",
    enter: "Enter",
    escape: "Escape",
    meta: "Meta",
    shift: "Shift",
    space: "Space",
    tab: "Tab",
};

export function normalizeBlueprintKeyboardEventKeyName(raw: unknown): string {
    if (typeof raw !== "string" && typeof raw !== "number") {
        return "";
    }
    const text = String(raw);
    if (text.length > 0 && text.trim().length === 0) {
        return "space";
    }
    const normalized = text.trim().toLowerCase();
    return BLUEPRINT_KEYBOARD_KEY_ALIASES[normalized] ?? normalized;
}

function readKeyboardModifierToken(raw: string): BlueprintKeyboardModifierFlag | null {
    return BLUEPRINT_KEYBOARD_MODIFIER_ALIASES[raw.trim().toLowerCase()] ?? null;
}

function readKeyboardModifierFlagForKey(key: string): BlueprintKeyboardModifierFlag | null {
    return BLUEPRINT_KEYBOARD_MODIFIER_KEYS[key] ?? null;
}

function keyboardModifierKeyForFlag(flag: BlueprintKeyboardModifierFlag): string {
    switch (flag) {
        case "altKey":
            return "alt";
        case "ctrlKey":
            return "control";
        case "shiftKey":
            return "shift";
        case "metaKey":
            return "meta";
    }
}

function keyboardBindingDisplayLabelForKey(key: string): string {
    const label = BLUEPRINT_KEYBOARD_KEY_LABELS[key];
    if (label) {
        return label;
    }
    return key.length === 1 ? key.toUpperCase() : key;
}

function readKeyboardBindingTokens(raw: string): string[] {
    const trimmed = raw.trim();
    if (!trimmed && raw.length > 0) {
        return ["Space"];
    }
    if (trimmed === "+") {
        return ["Plus"];
    }
    const tokens = trimmed.split("+").map(part => part.trim()).filter(Boolean);
    if (trimmed.endsWith("+") && tokens.length > 0) {
        tokens.push("Plus");
    }
    return tokens;
}

export function parseBlueprintKeyboardBinding(raw: unknown): BlueprintKeyboardBinding | null {
    if (typeof raw !== "string" && typeof raw !== "number") {
        return null;
    }
    const tokens = readKeyboardBindingTokens(String(raw));
    if (tokens.length === 0) {
        return null;
    }

    const modifiers: Record<BlueprintKeyboardModifierFlag, boolean> = {
        altKey: false,
        ctrlKey: false,
        shiftKey: false,
        metaKey: false,
    };
    const modifierTokens: BlueprintKeyboardModifierFlag[] = [];
    let keyToken: string | null = null;

    for (const token of tokens) {
        const modifier = readKeyboardModifierToken(token);
        if (modifier) {
            modifiers[modifier] = true;
            modifierTokens.push(modifier);
            continue;
        }
        keyToken = token;
    }

    if (!keyToken && modifierTokens.length > 0) {
        keyToken = keyboardModifierKeyForFlag(modifierTokens[modifierTokens.length - 1]);
    }

    const key = normalizeBlueprintKeyboardEventKeyName(keyToken);
    if (!key) {
        return null;
    }

    return {
        key,
        altKey: modifiers.altKey,
        ctrlKey: modifiers.ctrlKey,
        shiftKey: modifiers.shiftKey,
        metaKey: modifiers.metaKey,
        hasExplicitModifiers: modifierTokens.length > 0,
    };
}

export function formatBlueprintKeyboardBinding(raw: unknown): string {
    const binding = parseBlueprintKeyboardBinding(raw);
    if (!binding) {
        return "";
    }
    const keyModifier = readKeyboardModifierFlagForKey(binding.key);
    const parts = BLUEPRINT_KEYBOARD_MODIFIER_ORDER
        .filter(flag => binding[flag])
        .map(flag => BLUEPRINT_KEYBOARD_MODIFIER_LABELS[flag]);
    if (!keyModifier || !binding[keyModifier]) {
        parts.push(keyboardBindingDisplayLabelForKey(binding.key));
    }
    return parts.join("+");
}

export function formatBlueprintKeyboardBindingFromEvent(event: BlueprintKeyboardEventLike): string {
    const key = normalizeBlueprintKeyboardEventKeyName(event.key);
    if (!key) {
        return "";
    }
    const keyModifier = readKeyboardModifierFlagForKey(key);
    const parts = BLUEPRINT_KEYBOARD_MODIFIER_ORDER
        .filter(flag => Boolean(event[flag]))
        .map(flag => BLUEPRINT_KEYBOARD_MODIFIER_LABELS[flag]);
    if (!keyModifier || !Boolean(event[keyModifier])) {
        parts.push(keyboardBindingDisplayLabelForKey(key));
    }
    return parts.join("+");
}

export function blueprintKeyboardBindingMatchesEvent(raw: unknown, eventPayload?: BlueprintKeyboardEventLike): boolean {
    const binding = parseBlueprintKeyboardBinding(raw);
    if (!binding) {
        return false;
    }
    const eventKey = normalizeBlueprintKeyboardEventKeyName(eventPayload?.key);
    if (binding.key !== eventKey) {
        return false;
    }
    if (!binding.hasExplicitModifiers) {
        return true;
    }
    const keyModifier = readKeyboardModifierFlagForKey(binding.key);
    return BLUEPRINT_KEYBOARD_MODIFIER_ORDER.every(flag => {
        if (flag === keyModifier && binding[flag]) {
            return true;
        }
        return Boolean(eventPayload?.[flag]) === binding[flag];
    });
}

function isFilteredKeyboardEventHeadType(nodeType: string): boolean {
    return nodeType === BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN || nodeType === BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP;
}

function matchesPreferenceChangeDispatch(
    node: { params?: Record<string, unknown> },
    eventPayload?: Record<string, unknown>,
): boolean {
    const selectedKey = String(node.params?.[BLUEPRINT_NODE_PARAM_EVENT_HEAD_PREFERENCE_KEY] ?? "").trim();
    if (!selectedKey) {
        // An unconfigured head watches nothing; use `On Any Preference Changed` for the wildcard.
        return false;
    }
    return selectedKey === String(eventPayload?.key ?? "");
}

function matchesDispatchPayload(
    node: { type: string; params?: Record<string, unknown> },
    eventPayload?: Record<string, unknown>,
): boolean {
    if (isFilteredKeyboardEventHeadType(node.type)) {
        return blueprintKeyboardBindingMatchesEvent(node.params?.[BLUEPRINT_NODE_PARAM_EVENT_HEAD_KEY_NAME], eventPayload);
    }
    if (node.type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED) {
        return matchesPreferenceChangeDispatch(node, eventPayload);
    }
    return true;
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
    nodes: Record<string, { type: string; params?: Record<string, unknown> }> | undefined,
    eventName: string,
    widgetElementType?: string,
    eventPayload?: Record<string, unknown>,
): string[] {
    const n = nodes ?? {};
    const allowed = new Set(resolveBlueprintEventHeadTypesForUiSlot(eventName, widgetElementType));
    if (allowed.size === 0) {
        return [];
    }
    return Object.entries(n)
        .filter(([, node]) => allowed.has(node.type) && matchesDispatchPayload(node, eventPayload))
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
    nodes: Record<string, { type: string; params?: Record<string, unknown> }> | undefined,
    eventName: string,
    eventPayload?: Record<string, unknown>,
): string[] {
    const n = nodes ?? {};
    const allowed = new Set(resolveSurfaceEventHeadTypes(eventName));
    if (allowed.size === 0) {
        return [];
    }
    return Object.entries(n)
        .filter(([, node]) => allowed.has(node.type) && matchesDispatchPayload(node, eventPayload))
        .map(([id]) => id)
        .sort();
}

/**
 * Pick graph node ids that are valid entry heads for a global lifecycle event.
 */
export function collectGlobalEventHeadNodeIdsForDispatch(
    nodes: Record<string, { type: string; params?: Record<string, unknown> }> | undefined,
    eventName: string,
    eventPayload?: Record<string, unknown>,
): string[] {
    const n = nodes ?? {};
    const allowed = new Set(resolveGlobalEventHeadTypes(eventName));
    if (allowed.size === 0) {
        return [];
    }
    return Object.entries(n)
        .filter(([, node]) => allowed.has(node.type) && matchesDispatchPayload(node, eventPayload))
        .map(([id]) => id)
        .sort();
}

/** True if this node type is the Story Action Blueprint "On Call" entry head. */
export function isStoryActionCallHeadType(nodeType: string): boolean {
    return nodeType === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_CALL;
}

/**
 * Pick graph node ids that are valid "On Call" entry heads for a Story Action Blueprint.
 * Kept separate from the UI dispatch collectors so the story-action world never leaks into them.
 */
export function collectStoryActionEventHeadNodeIdsForDispatch(
    nodes: Record<string, { type: string; params?: Record<string, unknown> }> | undefined,
): string[] {
    const n = nodes ?? {};
    return Object.entries(n)
        .filter(([, node]) => isStoryActionCallHeadType(node.type))
        .map(([id]) => id)
        .sort();
}

export const BLUEPRINT_NODE_TYPE_FUNCTION_ENTRY = "blueprint.function.entry" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL = "blueprint.data.literal" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_STRING = "blueprint.data.stringLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_INTEGER = "blueprint.data.integerLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_FLOAT = "blueprint.data.floatLiteral" as const;
/** Legacy float literal id kept for saved graphs created before integer/float literals split. */
export const BLUEPRINT_NODE_TYPE_LITERAL_NUMBER = "blueprint.data.numberLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_BOOLEAN = "blueprint.data.booleanLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_NULL = "blueprint.data.nullLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_COLOR = "blueprint.data.colorLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_VECTOR2D = "blueprint.data.vector2dLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_RECT = "blueprint.data.rectLiteral" as const;
export const BLUEPRINT_NODE_TYPE_LITERAL_JSON = "blueprint.data.jsonLiteral" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_REF = "blueprint.element.ref" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_CONTINUE_EVENT_BUBBLE = "blueprint.element.continueEventBubble" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_STOP_EVENT_BUBBLE = "blueprint.element.stopEventBubble" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_ASSET_LITERAL = "blueprint.image.assetLiteral" as const;
export const BLUEPRINT_NODE_TYPE_DATA_RETURN_VALUE = "blueprint.data.returnValue" as const;
export const BLUEPRINT_NODE_TYPE_DATA_TO_FLOAT = "blueprint.data.toFloat" as const;
export const BLUEPRINT_NODE_TYPE_DATA_TO_INTEGER = "blueprint.data.toInteger" as const;
export const BLUEPRINT_NODE_TYPE_DATA_TO_BOOLEAN = "blueprint.data.toBoolean" as const;
export const BLUEPRINT_NODE_TYPE_DATA_TO_JSON = "blueprint.data.toJson" as const;
export const BLUEPRINT_NODE_TYPE_DATA_IS_STRING = "blueprint.data.isString" as const;
export const BLUEPRINT_NODE_TYPE_DATA_IS_NUMBER = "blueprint.data.isNumber" as const;
export const BLUEPRINT_NODE_TYPE_DATA_IS_BOOLEAN = "blueprint.data.isBoolean" as const;
export const BLUEPRINT_NODE_TYPE_DATA_IS_ARRAY = "blueprint.data.isArray" as const;
export const BLUEPRINT_NODE_TYPE_DATA_IS_OBJECT = "blueprint.data.isObject" as const;
export const BLUEPRINT_NODE_TYPE_DATA_IS_NULL = "blueprint.data.isNull" as const;
export const BLUEPRINT_NODE_TYPE_DATA_NOT_NULL = "blueprint.data.notNull" as const;
export const BLUEPRINT_NODE_TYPE_DATA_IS_EMPTY_VALUE = "blueprint.data.isEmptyValue" as const;
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
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_LENGTH = "blueprint.collection.arrayLength" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_GET = "blueprint.collection.arrayGet" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SET = "blueprint.collection.arraySet" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_PUSH = "blueprint.collection.arrayPush" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_INSERT = "blueprint.collection.arrayInsert" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE = "blueprint.collection.arrayRemove" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_REMOVE_AT = "blueprint.collection.arrayRemoveAt" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_CONTAINS = "blueprint.collection.arrayContains" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FIND = "blueprint.collection.arrayFind" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_FILTER = "blueprint.collection.arrayFilter" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_MAP = "blueprint.collection.arrayMap" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SORT = "blueprint.collection.arraySort" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_SLICE = "blueprint.collection.arraySlice" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_ARRAY_JOIN = "blueprint.collection.arrayJoin" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_KEYS = "blueprint.collection.objectKeys" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_VALUES = "blueprint.collection.objectValues" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_MERGE = "blueprint.collection.objectMerge" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_SET_FIELD = "blueprint.collection.objectSetField" as const;
export const BLUEPRINT_NODE_TYPE_COLLECTION_OBJECT_REMOVE_FIELD = "blueprint.collection.objectRemoveField" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_IF = "if" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_IF_ELSE = "blueprint.flow.ifElse" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_NOOP = "blueprint.flow.noop" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_SEQUENCE = "blueprint.flow.sequence" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_SWITCH_STRING = "blueprint.flow.switchString" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_FOR_LOOP = "blueprint.flow.forLoop" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_FOR_EACH = "blueprint.flow.forEach" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_WHILE = "blueprint.flow.while" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_DELAY = "blueprint.flow.delay" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_SKIP_DELAY = "blueprint.flow.skipDelay" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_RETURN = "blueprint.flow.return" as const;
export const BLUEPRINT_NODE_TYPE_FLOW_COMMENT = "blueprint.flow.comment" as const;
/** Read blueprint execution local variable (pure data source). */
export const BLUEPRINT_NODE_TYPE_LOCAL_GET = "blueprint.local.get" as const;
/** Write blueprint execution local variable. */
export const BLUEPRINT_NODE_TYPE_LOCAL_SET = "blueprint.local.set" as const;
/** Declare a blueprint-scoped execution local variable from the graph canvas. */
export const BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR = "blueprint.local.declareVar" as const;
/** Async read from project-level persistent storage. */
export const BLUEPRINT_NODE_TYPE_PERSISTENT_GET = "blueprint.persistent.get" as const;
/** Async write to project-level persistent storage. */
export const BLUEPRINT_NODE_TYPE_PERSISTENT_SET = "blueprint.persistent.set" as const;
/** Read a Story scene variable (NLR Scene.local); story-action blueprints only. */
export const BLUEPRINT_NODE_TYPE_SCENE_GET = "blueprint.scene.get" as const;
/** Write a Story scene variable (NLR Scene.local); story-action blueprints only. */
export const BLUEPRINT_NODE_TYPE_SCENE_SET = "blueprint.scene.set" as const;
/** Read a Story saved variable (NLR Storable, per save-file); story-action blueprints only. */
export const BLUEPRINT_NODE_TYPE_SAVED_GET = "blueprint.saved.get" as const;
/** Write a Story saved variable (NLR Storable, per save-file); story-action blueprints only. */
export const BLUEPRINT_NODE_TYPE_SAVED_SET = "blueprint.saved.set" as const;
/** Persisted helper param for variableRef nodes whose pin type follows the selected variable. */
export const BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE = "__variableValueType" as const;
/** Console log from wired data pin (Studio / Dev Mode). */
export const BLUEPRINT_NODE_TYPE_LOG = "blueprint.log" as const;
/** Pure numeric math (data-only). */
export const BLUEPRINT_NODE_TYPE_MATH_ADD = "blueprint.math.add" as const;
export const BLUEPRINT_NODE_TYPE_MATH_SUBTRACT = "blueprint.math.subtract" as const;
export const BLUEPRINT_NODE_TYPE_MATH_MULTIPLY = "blueprint.math.multiply" as const;
export const BLUEPRINT_NODE_TYPE_MATH_DIVIDE = "blueprint.math.divide" as const;
export const BLUEPRINT_NODE_TYPE_MATH_MODULO = "blueprint.math.modulo" as const;
/** Unary add-one: result = value + 1 (pure data). */
export const BLUEPRINT_NODE_TYPE_MATH_INCREMENT = "blueprint.math.increment" as const;
/** Unary subtract-one: result = value - 1 (pure data). */
export const BLUEPRINT_NODE_TYPE_MATH_DECREMENT = "blueprint.math.decrement" as const;
export const BLUEPRINT_NODE_TYPE_MATH_ABS = "blueprint.math.abs" as const;
export const BLUEPRINT_NODE_TYPE_MATH_MIN = "blueprint.math.min" as const;
export const BLUEPRINT_NODE_TYPE_MATH_MAX = "blueprint.math.max" as const;
export const BLUEPRINT_NODE_TYPE_MATH_ROUND = "blueprint.math.round" as const;
export const BLUEPRINT_NODE_TYPE_MATH_FLOOR = "blueprint.math.floor" as const;
export const BLUEPRINT_NODE_TYPE_MATH_CEIL = "blueprint.math.ceil" as const;
export const BLUEPRINT_NODE_TYPE_MATH_RANDOM_FLOAT = "blueprint.math.randomFloat" as const;
export const BLUEPRINT_NODE_TYPE_MATH_RANDOM_INTEGER = "blueprint.math.randomInteger" as const;
/** Pure float comparison: result is boolean (pure data). */
export const BLUEPRINT_NODE_TYPE_MATH_EQUAL = "blueprint.math.equal" as const;
export const BLUEPRINT_NODE_TYPE_MATH_NOT_EQUAL = "blueprint.math.notEqual" as const;
export const BLUEPRINT_NODE_TYPE_MATH_LESS = "blueprint.math.less" as const;
export const BLUEPRINT_NODE_TYPE_MATH_LESS_OR_EQUAL = "blueprint.math.lessOrEqual" as const;
export const BLUEPRINT_NODE_TYPE_MATH_GREATER = "blueprint.math.greater" as const;
export const BLUEPRINT_NODE_TYPE_MATH_GREATER_OR_EQUAL = "blueprint.math.greaterOrEqual" as const;
export const BLUEPRINT_NODE_TYPE_BOOLEAN_AND = "blueprint.boolean.and" as const;
export const BLUEPRINT_NODE_TYPE_BOOLEAN_OR = "blueprint.boolean.or" as const;
export const BLUEPRINT_NODE_TYPE_BOOLEAN_NOT = "blueprint.boolean.not" as const;
export const BLUEPRINT_NODE_TYPE_BOOLEAN_XOR = "blueprint.boolean.xor" as const;
export const BLUEPRINT_NODE_TYPE_COMPARE_EQUAL = "blueprint.compare.equal" as const;
export const BLUEPRINT_NODE_TYPE_COMPARE_NOT_EQUAL = "blueprint.compare.notEqual" as const;
export const BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN = "blueprint.compare.greaterThan" as const;
export const BLUEPRINT_NODE_TYPE_COMPARE_GREATER_THAN_OR_EQUAL = "blueprint.compare.greaterThanOrEqual" as const;
export const BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN = "blueprint.compare.lessThan" as const;
export const BLUEPRINT_NODE_TYPE_COMPARE_LESS_THAN_OR_EQUAL = "blueprint.compare.lessThanOrEqual" as const;

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

/**
 * Fn nodes: surface-scoped callable functions declared by a head node in event graphs.
 * The fn identity is the head node id; callers reference it via an encoded fnRef param.
 * Deliberately NOT part of EVENT_DISPATCH_HEAD_TYPES — fn bodies only run via explicit invocation.
 */
export const BLUEPRINT_NODE_TYPE_FN_HEAD = "blueprint.fn.head" as const;
export const BLUEPRINT_NODE_TYPE_FN_CALL = "blueprint.fn.call" as const;
export const BLUEPRINT_NODE_TYPE_FN_RETURN = "blueprint.fn.return" as const;
/** Fn head inspector param: user-visible function name. */
export const BLUEPRINT_NODE_PARAM_FN_NAME = "name" as const;
/** Call Fn inspector param: encoded (blueprintId, headNodeId) reference. */
export const BLUEPRINT_NODE_PARAM_FN_REF = "fnRef" as const;
/** Call Fn cached signature { name, params[], returns[] } used to render pins without document access. */
export const BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT = "__fnSignatureSnapshot" as const;
/** Fn head dynamic parameter pins: ordered ids / labels by id / value types by id. */
export const BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_IDS = "__fnParamPinIds" as const;
export const BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_LABELS = "__fnParamPinLabels" as const;
export const BLUEPRINT_NODE_PARAMS_FN_PARAM_PIN_TYPES = "__fnParamPinTypes" as const;
/** Fn Return dynamic result pins: ordered ids / labels by id / value types by id. */
export const BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_IDS = "__fnReturnPinIds" as const;
export const BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_LABELS = "__fnReturnPinLabels" as const;
export const BLUEPRINT_NODE_PARAMS_FN_RETURN_PIN_TYPES = "__fnReturnPinTypes" as const;

export type BlueprintFnPinSnapshot = {
    pinId: string;
    name: string;
    valueType: string;
};

/** Serialized on Call Fn node params so pins render without resolving the target fn. */
export type BlueprintFnSignatureSnapshot = {
    name: string;
    params: BlueprintFnPinSnapshot[];
    returns: BlueprintFnPinSnapshot[];
};

function sanitizeBlueprintFnPinSnapshots(raw: unknown): BlueprintFnPinSnapshot[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out: BlueprintFnPinSnapshot[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const pinId = (entry as { pinId?: unknown }).pinId;
        if (typeof pinId !== "string" || pinId.trim().length === 0) {
            continue;
        }
        const name = (entry as { name?: unknown }).name;
        const valueType = (entry as { valueType?: unknown }).valueType;
        out.push({
            pinId,
            name: typeof name === "string" && name.trim().length > 0 ? name : pinId,
            valueType: typeof valueType === "string" && valueType.trim().length > 0 ? valueType : "any",
        });
    }
    return out;
}

/** Tolerant reader for the Call Fn signature snapshot param (serialized user data). */
export function readBlueprintFnSignatureSnapshot(
    params: Record<string, unknown> | undefined,
): BlueprintFnSignatureSnapshot | undefined {
    const raw = params?.[BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const name = (raw as { name?: unknown }).name;
    return {
        name: typeof name === "string" && name.trim().length > 0 ? name : "Fn",
        params: sanitizeBlueprintFnPinSnapshots((raw as { params?: unknown }).params),
        returns: sanitizeBlueprintFnPinSnapshots((raw as { returns?: unknown }).returns),
    };
}
export const BLUEPRINT_NODE_TYPE_PAGE_GO = "blueprint.page.go" as const;
export const BLUEPRINT_NODE_TYPE_PAGE_GET_PROPS = "blueprint.page.getProps" as const;
export const BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_EXITING = "blueprint.page.isSurfaceExiting" as const;
export const BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_ENTERING = "blueprint.page.isSurfaceEntering" as const;
export const BLUEPRINT_NODE_TYPE_PAGE_IS_SURFACE_TRANSITIONING = "blueprint.page.isSurfaceTransitioning" as const;
export const BLUEPRINT_NODE_TYPE_PAGE_QUIT = "blueprint.page.quit" as const;
export const BLUEPRINT_NODE_TYPE_GAME_START_STORY = "blueprint.game.startStory" as const;
export const BLUEPRINT_NODE_TYPE_GAME_IS_IN_GAME = "blueprint.game.isInGame" as const;
export const BLUEPRINT_NODE_TYPE_GAME_IS_GAME_OVERLAY = "blueprint.game.isGameOverlay" as const;
export const BLUEPRINT_NODE_TYPE_GAME_QUIT = "blueprint.game.quit" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SAVE_WRITE = "blueprint.game.save.write" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SAVE_LOAD = "blueprint.game.save.load" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SAVE_LIST_IDS = "blueprint.game.save.listIds" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_PREVIEW = "blueprint.game.save.getPreview" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SAVE_DELETE = "blueprint.game.save.delete" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SAVE_GET_METADATA = "blueprint.game.save.getMetadata" as const;
export const BLUEPRINT_NODE_TYPE_GAME_HISTORY_GET = "blueprint.game.history.get" as const;
export const BLUEPRINT_NODE_TYPE_GAME_HISTORY_RESTORE = "blueprint.game.history.restore" as const;
export const BLUEPRINT_NODE_TYPE_GAME_HISTORY_UNDO_LAST = "blueprint.game.history.undoLast" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_NAMETAG = "blueprint.game.getNametag" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_NOTIFICATIONS = "blueprint.game.getNotifications" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_CHOICE_COUNT = "blueprint.game.getChoiceCount" as const;
export const BLUEPRINT_NODE_TYPE_GAME_IS_NVL_MODE = "blueprint.game.isNvlMode" as const;
/** True while a dialog line is on screen and its message is read (seen before, or display finished). */
export const BLUEPRINT_NODE_TYPE_GAME_IS_TEXT_READ = "blueprint.game.isTextRead" as const;
/** Wipe the persisted text-read record (all stories); works with or without a running game. */
export const BLUEPRINT_NODE_TYPE_GAME_CLEAR_TEXT_READ = "blueprint.game.clearTextRead" as const;
export const BLUEPRINT_NODE_TYPE_GAME_CHOOSE = "blueprint.game.choose" as const;
export const BLUEPRINT_NODE_TYPE_GAME_NEXT = "blueprint.game.next" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SKIP = "blueprint.game.skip" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SHOW_DIALOG = "blueprint.game.showDialog" as const;
export const BLUEPRINT_NODE_TYPE_GAME_HIDE_DIALOG = "blueprint.game.hideDialog" as const;
export const BLUEPRINT_NODE_TYPE_GAME_TOGGLE_DIALOG_DISPLAY = "blueprint.game.toggleDialogDisplay" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_SENTENCE_SPEED = "blueprint.game.setSentenceSpeed" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_AUTO_FORWARD = "blueprint.game.getAutoForward" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_AUTO_FORWARD = "blueprint.game.setAutoForward" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_ENABLED = "blueprint.game.getSkip" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_ENABLED = "blueprint.game.setSkip" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_GAME_SPEED = "blueprint.game.getGameSpeed" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_GAME_SPEED = "blueprint.game.setGameSpeed" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_SENTENCE_SPEED = "blueprint.game.getCps" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_VOLUME = "blueprint.game.getVoiceVolume" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_VOLUME = "blueprint.game.setVoiceVolume" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_FADE_DURATION = "blueprint.game.getVoiceFadeDuration" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_FADE_DURATION = "blueprint.game.setVoiceFadeDuration" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_VOICE_END_MODE = "blueprint.game.getVoiceEndMode" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_VOICE_END_MODE = "blueprint.game.setVoiceEndMode" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_BGM_VOLUME = "blueprint.game.getBgmVolume" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_BGM_VOLUME = "blueprint.game.setBgmVolume" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_SOUND_VOLUME = "blueprint.game.getSoundVolume" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_SOUND_VOLUME = "blueprint.game.setSoundVolume" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_GLOBAL_VOLUME = "blueprint.game.getGlobalVolume" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_GLOBAL_VOLUME = "blueprint.game.setGlobalVolume" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_DELAY = "blueprint.game.getSkipDelay" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_DELAY = "blueprint.game.setSkipDelay" as const;
export const BLUEPRINT_NODE_TYPE_GAME_GET_SKIP_INTERVAL = "blueprint.game.getSkipInterval" as const;
export const BLUEPRINT_NODE_TYPE_GAME_SET_SKIP_INTERVAL = "blueprint.game.setSkipInterval" as const;
export const BLUEPRINT_NODE_TYPE_FRAME_GET_PARAM = "blueprint.frame.getParam" as const;
export const BLUEPRINT_NODE_TYPE_FRAME_EMIT = "blueprint.frame.emit" as const;
export const BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE = "blueprint.frameWidget.setTargetPage" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE = "blueprint.element.frame.setTargetPage" as const;

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

export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT = "blueprint.element.text.getText" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT = "blueprint.element.text.setText" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_APPEND_TEXT = "blueprint.element.text.appendText" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_CLEAR_TEXT = "blueprint.element.text.clearText" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT = "blueprint.element.text.getFont" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT = "blueprint.element.text.setFont" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_SIZE = "blueprint.element.text.getFontSize" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT_SIZE = "blueprint.element.text.setFontSize" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_FONT_WEIGHT = "blueprint.element.text.getFontWeight" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_FONT_WEIGHT = "blueprint.element.text.setFontWeight" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_COLOR = "blueprint.element.text.getTextColor" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT_COLOR = "blueprint.element.text.setTextColor" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_ALIGN = "blueprint.element.text.getTextAlign" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT_ALIGN = "blueprint.element.text.setTextAlign" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_TEXT_VERTICAL_ALIGN = "blueprint.element.text.getTextVerticalAlign" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_TEXT_VERTICAL_ALIGN = "blueprint.element.text.setTextVerticalAlign" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_LINE_HEIGHT = "blueprint.element.text.getLineHeight" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_LINE_HEIGHT = "blueprint.element.text.setLineHeight" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_WRAP_MODE = "blueprint.element.text.getWrapMode" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_WRAP_MODE = "blueprint.element.text.setWrapMode" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_EFFECTS = "blueprint.element.text.getEffects" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_EFFECTS = "blueprint.element.text.setEffects" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_GET_ALL_PROPERTIES = "blueprint.element.text.getAllProperties" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_TEXT_SET_ALL_PROPERTIES = "blueprint.element.text.setAllProperties" as const;

export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_POSITION = "blueprint.element.displayable.getPosition" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_SIZE = "blueprint.element.displayable.getSize" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_BOUNDS = "blueprint.element.displayable.getBounds" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_ROTATION = "blueprint.element.displayable.getRotation" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_OPACITY = "blueprint.element.displayable.getOpacity" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VISIBLE = "blueprint.element.displayable.getVisible" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_DISPLAY = "blueprint.element.displayable.getDisplay" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_PROPERTY = "blueprint.element.displayable.getProperty" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_DISPLAY = "blueprint.element.displayable.setDisplay" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_PROPERTY = "blueprint.element.displayable.setProperty" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_GET_VARIANT = "blueprint.element.displayable.getVariant" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT = "blueprint.element.displayable.setVariant" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY = "blueprint.element.displayable.animateProperty" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_STOP_ANIMATION = "blueprint.element.displayable.stopAnimation" as const;

export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_POSITION = "blueprint.displayable.getPosition" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_SIZE = "blueprint.displayable.getSize" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_BOUNDS = "blueprint.displayable.getBounds" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_ROTATION = "blueprint.displayable.getRotation" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_OPACITY = "blueprint.displayable.getOpacity" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VISIBLE = "blueprint.displayable.getVisible" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_DISPLAY = "blueprint.displayable.getDisplay" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_PROPERTY = "blueprint.displayable.getProperty" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_DISPLAY = "blueprint.displayable.setDisplay" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_PROPERTY = "blueprint.displayable.setProperty" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_GET_VARIANT = "blueprint.displayable.getVariant" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT = "blueprint.displayable.setVariant" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY = "blueprint.displayable.animateProperty" as const;
export const BLUEPRINT_NODE_TYPE_DISPLAYABLE_STOP_ANIMATION = "blueprint.displayable.stopAnimation" as const;

export const BLUEPRINT_NODE_TYPE_SLIDER_GET_VALUE = "blueprint.slider.getValue" as const;
export const BLUEPRINT_NODE_TYPE_SLIDER_GET_NORMALIZED_VALUE = "blueprint.slider.getNormalizedValue" as const;
export const BLUEPRINT_NODE_TYPE_SLIDER_GET_RANGE = "blueprint.slider.getRange" as const;
export const BLUEPRINT_NODE_TYPE_SLIDER_SET_VALUE = "blueprint.slider.setValue" as const;
export const BLUEPRINT_NODE_TYPE_SLIDER_SET_RANGE = "blueprint.slider.setRange" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_VALUE = "blueprint.element.slider.getValue" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_NORMALIZED_VALUE = "blueprint.element.slider.getNormalizedValue" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_GET_RANGE = "blueprint.element.slider.getRange" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_SET_VALUE = "blueprint.element.slider.setValue" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_SLIDER_SET_RANGE = "blueprint.element.slider.setRange" as const;

export const BLUEPRINT_NODE_TYPE_LIST_SET_ITEMS = "blueprint.list.setItems" as const;
export const BLUEPRINT_NODE_TYPE_LIST_GET_ITEMS = "blueprint.list.getItems" as const;
export const BLUEPRINT_NODE_TYPE_LIST_CLEAR = "blueprint.list.clear" as const;
export const BLUEPRINT_NODE_TYPE_LIST_APPEND_ITEM = "blueprint.list.appendItem" as const;
export const BLUEPRINT_NODE_TYPE_LIST_INSERT_ITEM = "blueprint.list.insertItem" as const;
export const BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM = "blueprint.list.removeItem" as const;
export const BLUEPRINT_NODE_TYPE_LIST_REMOVE_ITEM_AT = "blueprint.list.removeItemAt" as const;
export const BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_ITEM = "blueprint.list.getSelectedItem" as const;
export const BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_ITEM = "blueprint.list.setSelectedItem" as const;
export const BLUEPRINT_NODE_TYPE_LIST_GET_SELECTED_INDEX = "blueprint.list.getSelectedIndex" as const;
export const BLUEPRINT_NODE_TYPE_LIST_SET_SELECTED_INDEX = "blueprint.list.setSelectedIndex" as const;
export const BLUEPRINT_NODE_TYPE_LIST_REFRESH_ITEMS = "blueprint.list.refreshItems" as const;
export const BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_INDEX = "blueprint.list.scrollToIndex" as const;
export const BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_TOP = "blueprint.list.scrollToTop" as const;
export const BLUEPRINT_NODE_TYPE_LIST_SCROLL_TO_BOTTOM = "blueprint.list.scrollToBottom" as const;
export const BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_PROPS = "blueprint.list.getItemProps" as const;
export const BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_INDEX = "blueprint.list.getItemIndex" as const;
export const BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_COUNT = "blueprint.list.getItemCount" as const;
export const BLUEPRINT_NODE_TYPE_LIST_GET_ITEM_KEY = "blueprint.list.getItemKey" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_ITEMS = "blueprint.element.list.setItems" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_ITEMS = "blueprint.element.list.getItems" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_CLEAR = "blueprint.element.list.clear" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_APPEND_ITEM = "blueprint.element.list.appendItem" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_INSERT_ITEM = "blueprint.element.list.insertItem" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REMOVE_ITEM = "blueprint.element.list.removeItem" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REMOVE_ITEM_AT = "blueprint.element.list.removeItemAt" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_ITEM = "blueprint.element.list.getSelectedItem" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_ITEM = "blueprint.element.list.setSelectedItem" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_GET_SELECTED_INDEX = "blueprint.element.list.getSelectedIndex" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SET_SELECTED_INDEX = "blueprint.element.list.setSelectedIndex" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_REFRESH_ITEMS = "blueprint.element.list.refreshItems" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SCROLL_TO_INDEX = "blueprint.element.list.scrollToIndex" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SCROLL_TO_TOP = "blueprint.element.list.scrollToTop" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_LIST_SCROLL_TO_BOTTOM = "blueprint.element.list.scrollToBottom" as const;

export const BLUEPRINT_NODE_TYPE_IMAGE_GET_ASSET = "blueprint.image.getImageAsset" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_SET_ASSET = "blueprint.image.setImageAsset" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_CLEAR_ASSET = "blueprint.image.clearImageAsset" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_GET_FIT_MODE = "blueprint.image.getFitMode" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_SET_FIT_MODE = "blueprint.image.setFitMode" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_GET_CROP_RECT = "blueprint.image.getCropRect" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_SET_CROP_RECT = "blueprint.image.setCropRect" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_X = "blueprint.image.getFlipX" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_X = "blueprint.image.setFlipX" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_GET_FLIP_Y = "blueprint.image.getFlipY" as const;
export const BLUEPRINT_NODE_TYPE_IMAGE_SET_FLIP_Y = "blueprint.image.setFlipY" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_ASSET = "blueprint.element.image.getImageAsset" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_ASSET = "blueprint.element.image.setImageAsset" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_CLEAR_ASSET = "blueprint.element.image.clearImageAsset" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FIT_MODE = "blueprint.element.image.getFitMode" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FIT_MODE = "blueprint.element.image.setFitMode" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_CROP_RECT = "blueprint.element.image.getCropRect" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_CROP_RECT = "blueprint.element.image.setCropRect" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_X = "blueprint.element.image.getFlipX" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_X = "blueprint.element.image.setFlipX" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_GET_FLIP_Y = "blueprint.element.image.getFlipY" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_IMAGE_SET_FLIP_Y = "blueprint.element.image.setFlipY" as const;

export const BLUEPRINT_NODE_TYPE_BUTTON_SET_POINTER = "blueprint.button.setPointer" as const;
export const BLUEPRINT_NODE_TYPE_ELEMENT_BUTTON_SET_POINTER = "blueprint.element.button.setPointer" as const;

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
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT
        | typeof BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY
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
