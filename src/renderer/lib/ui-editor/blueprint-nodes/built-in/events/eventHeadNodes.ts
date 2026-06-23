/**
 * Event entry heads from the documented UI Editor Blueprint catalog.
 * Comments in English per project convention.
 */

import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOUBLE_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_LEAVE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_MOVE,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
} from "@shared/types/blueprint/graph";
import { BLUEPRINT_VALUE_TYPE_ELEMENT } from "@shared/types/blueprint/valueTypes";
import { BUILTIN_WIDGET_LOGIC_APIS } from "@shared/types/ui-editor/widgetLogic";
import type { BlueprintNodeDef, BlueprintNodePinDef } from "../../types";

const eventHeadExecute: BlueprintNodeDef["execute"] = () => ({ nextPort: "then" });

const THEN_PIN: BlueprintNodePinDef = { id: "then", kind: "output", semantic: "exec", label: "Then" };
const PIN_X: BlueprintNodePinDef = { id: "x", kind: "output", semantic: "data", valueType: "float", label: "X" };
const PIN_Y: BlueprintNodePinDef = { id: "y", kind: "output", semantic: "data", valueType: "float", label: "Y" };
const PIN_BUTTON: BlueprintNodePinDef = {
    id: "button",
    kind: "output",
    semantic: "data",
    valueType: "integer",
    label: "Button",
};
const PIN_DELTA_X: BlueprintNodePinDef = {
    id: "deltaX",
    kind: "output",
    semantic: "data",
    valueType: "float",
    label: "Delta X",
};
const PIN_DELTA_Y: BlueprintNodePinDef = {
    id: "deltaY",
    kind: "output",
    semantic: "data",
    valueType: "float",
    label: "Delta Y",
};
const PIN_INDEX: BlueprintNodePinDef = {
    id: "index",
    kind: "output",
    semantic: "data",
    valueType: "integer",
    label: "Index",
};
const PIN_PREVIOUS_INDEX: BlueprintNodePinDef = {
    id: "previousIndex",
    kind: "output",
    semantic: "data",
    valueType: "integer",
    label: "Previous Index",
};
const PIN_COUNT: BlueprintNodePinDef = {
    id: "count",
    kind: "output",
    semantic: "data",
    valueType: "integer",
    label: "Count",
};
const PIN_KEY: BlueprintNodePinDef = {
    id: "key",
    kind: "output",
    semantic: "data",
    valueType: "string",
    label: "Key",
};
const PIN_ITEM: BlueprintNodePinDef = {
    id: "item",
    kind: "output",
    semantic: "data",
    valueType: "json",
    label: "Item",
};
const PIN_PROPS: BlueprintNodePinDef = {
    id: "props",
    kind: "output",
    semantic: "data",
    valueType: "json",
    label: "Props",
};
const PIN_VALUE: BlueprintNodePinDef = {
    id: "value",
    kind: "output",
    semantic: "data",
    valueType: "float",
    label: "Value",
};
const PIN_PREVIOUS_VALUE: BlueprintNodePinDef = {
    id: "previousValue",
    kind: "output",
    semantic: "data",
    valueType: "float",
    label: "Previous Value",
};
const PIN_ELEMENT: BlueprintNodePinDef = {
    id: "element",
    kind: "output",
    semantic: "data",
    valueType: BLUEPRINT_VALUE_TYPE_ELEMENT,
    label: "Element",
};

function widgetTypesForHead(headType: string): string[] {
    return Object.entries(BUILTIN_WIDGET_LOGIC_APIS)
        .filter(([, api]) => api.events.some(eventDef => eventDef.headNodeTypes?.includes(headType)))
        .map(([widgetType]) => widgetType)
        .filter(widgetType => widgetType !== "nl.root");
}

function widgetEventHead(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins?: BlueprintNodePinDef[];
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
    scope?: BlueprintNodeDef["scope"];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Events",
        keywords: input.keywords,
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        scope: input.scope ?? { widgetElementTypes: widgetTypesForHead(input.type) },
        pins: input.pins ?? [THEN_PIN],
        inspectorParams: input.inspectorParams,
        execute: eventHeadExecute,
    };
}

function broadcastEventHead(input: {
    type: string;
    displayName: string;
    keywords: string[];
    pins: BlueprintNodePinDef[];
    inspectorParams?: BlueprintNodeDef["inspectorParams"];
}): BlueprintNodeDef {
    return {
        type: input.type,
        displayName: input.displayName,
        category: "Events",
        keywords: input.keywords,
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        scope: { ownerKinds: ["widgetMain", "surfaceMain"] },
        pins: input.pins,
        inspectorParams: input.inspectorParams,
        execute: eventHeadExecute,
    };
}

export const eventHeadBlueprintNodes: BlueprintNodeDef[] = [
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
        displayName: "App Boot",
        category: "Events",
        keywords: ["app", "boot", "startup", "global"],
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        scope: { ownerKinds: ["globalMain"] },
        pins: [THEN_PIN],
        execute: eventHeadExecute,
    },
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
        displayName: "Surface Init",
        category: "Events",
        keywords: ["surface", "page", "init", "mount", "open"],
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        scope: { ownerKinds: ["surfaceMain"] },
        pins: [THEN_PIN],
        execute: eventHeadExecute,
    },
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
        displayName: "Surface Unmount",
        category: "Events",
        keywords: ["surface", "page", "unmount", "close", "leave"],
        graphKinds: ["event"],
        isPure: false,
        role: "eventHead",
        scope: { ownerKinds: ["surfaceMain"] },
        pins: [THEN_PIN],
        execute: eventHeadExecute,
    },
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
        displayName: "Init",
        keywords: ["init", "initialize", "component", "mount", "widget", "setup"],
        scope: {
            anyOf: [
                { widgetElementTypes: widgetTypesForHead(BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT) },
                { ownerKinds: ["widgetValue"] },
            ],
        },
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK,
        displayName: "Mouse Click",
        keywords: ["click", "mouse", "tap", "press"],
        pins: [THEN_PIN, PIN_X, PIN_Y],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOUBLE_CLICK,
        displayName: "Mouse Double Click",
        keywords: ["double", "click", "mouse"],
        pins: [THEN_PIN, PIN_X, PIN_Y],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER,
        displayName: "Mouse Enter",
        keywords: ["mouse", "enter", "hover", "over"],
        pins: [THEN_PIN, PIN_X, PIN_Y],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_LEAVE,
        displayName: "Mouse Leave",
        keywords: ["mouse", "leave", "exit", "out"],
        pins: [THEN_PIN, PIN_X, PIN_Y],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_MOVE,
        displayName: "Mouse Move",
        keywords: ["mouse", "move", "pointer"],
        pins: [THEN_PIN, PIN_X, PIN_Y],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN,
        displayName: "Mouse Down",
        keywords: ["mouse", "down", "press", "button"],
        pins: [THEN_PIN, PIN_X, PIN_Y, PIN_BUTTON],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP,
        displayName: "Mouse Up",
        keywords: ["mouse", "up", "release", "button"],
        pins: [THEN_PIN, PIN_X, PIN_Y, PIN_BUTTON],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL,
        displayName: "Mouse Wheel",
        keywords: ["mouse", "wheel", "scroll", "delta"],
        pins: [THEN_PIN, PIN_X, PIN_Y, PIN_DELTA_X, PIN_DELTA_Y],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
        displayName: "Right Click",
        keywords: ["right", "click", "context", "menu", "mouse"],
        pins: [THEN_PIN, PIN_X, PIN_Y],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS,
        displayName: "Focus",
        keywords: ["focus", "keyboard", "gamepad"],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR,
        displayName: "Blur",
        keywords: ["blur", "focus", "keyboard", "gamepad"],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
        displayName: "On Flush",
        keywords: ["flush", "render", "redraw", "update", "current"],
        pins: [THEN_PIN, PIN_ELEMENT],
    }),
    {
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
        displayName: "Element Flush",
        category: "Events",
        keywords: ["element", "flush", "listen", "render", "redraw", "update"],
        graphKinds: ["event"],
        isPure: false,
        role: "elementEventHead",
        scope: { ownerKinds: ["widgetMain", "surfaceMain"] },
        pins: [THEN_PIN, PIN_ELEMENT],
        execute: eventHeadExecute,
    },
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL,
        displayName: "Scroll",
        keywords: ["scroll", "list", "offset", "progress"],
        pins: [
            THEN_PIN,
            { id: "offset", kind: "output", semantic: "data", valueType: "float", label: "Offset" },
            { id: "maxOffset", kind: "output", semantic: "data", valueType: "float", label: "Max Offset" },
            { id: "progress", kind: "output", semantic: "data", valueType: "float", label: "Progress" },
        ],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END,
        displayName: "Scroll End",
        keywords: ["scroll", "end", "list", "bottom", "edge"],
        pins: [
            THEN_PIN,
            { id: "offset", kind: "output", semantic: "data", valueType: "float", label: "Offset" },
            { id: "maxOffset", kind: "output", semantic: "data", valueType: "float", label: "Max Offset" },
            { id: "progress", kind: "output", semantic: "data", valueType: "float", label: "Progress" },
        ],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
        displayName: "Item Render",
        keywords: ["item", "render", "list", "repeater", "row"],
        pins: [THEN_PIN, PIN_INDEX, PIN_COUNT, PIN_KEY, PIN_ITEM],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
        displayName: "Item Click",
        keywords: ["item", "click", "list", "select", "row"],
        pins: [THEN_PIN, PIN_INDEX, PIN_COUNT, PIN_KEY, PIN_ITEM],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
        displayName: "Item Hover",
        keywords: ["item", "hover", "enter", "list", "row"],
        pins: [THEN_PIN, PIN_INDEX, PIN_COUNT, PIN_KEY, PIN_ITEM],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH,
        displayName: "List Item Refresh",
        keywords: ["list", "item", "refresh", "props", "row", "context"],
        pins: [THEN_PIN, PIN_PROPS, PIN_ITEM, PIN_INDEX, PIN_COUNT, PIN_KEY],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
        displayName: "Selection Changed",
        keywords: ["selection", "selected", "change", "list", "item"],
        pins: [THEN_PIN, PIN_INDEX, PIN_PREVIOUS_INDEX, PIN_COUNT, PIN_KEY, PIN_ITEM],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START,
        displayName: "Drag Start",
        keywords: ["slider", "drag", "start", "value"],
        pins: [THEN_PIN, PIN_VALUE],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED,
        displayName: "Value Changed",
        keywords: ["slider", "value", "change"],
        pins: [THEN_PIN, PIN_VALUE, PIN_PREVIOUS_VALUE],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END,
        displayName: "Drag End",
        keywords: ["slider", "drag", "end", "value"],
        pins: [THEN_PIN, PIN_VALUE],
    }),
    broadcastEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
        displayName: "On Any Broadcast",
        keywords: ["broadcast", "event", "receive", "any", "message"],
        pins: [
            THEN_PIN,
            { id: "event", kind: "output", semantic: "data", valueType: "string", label: "Event" },
            { id: "data", kind: "output", semantic: "data", valueType: "json", label: "Data" },
            { id: "sender", kind: "output", semantic: "data", valueType: "string", label: "Sender" },
        ],
    }),
    broadcastEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
        displayName: "On Broadcast",
        keywords: ["broadcast", "event", "receive", "message"],
        pins: [
            THEN_PIN,
            { id: "data", kind: "output", semantic: "data", valueType: "json", label: "Data" },
            { id: "sender", kind: "output", semantic: "data", valueType: "string", label: "Sender" },
        ],
        inspectorParams: [{ key: "event", label: "Event", kind: "string" }],
    }),
    widgetEventHead({
        type: BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT,
        displayName: "Page Event",
        keywords: ["page", "frame", "event", "emit", "message"],
        pins: [
            THEN_PIN,
            { id: "event", kind: "output", semantic: "data", valueType: "string", label: "Event" },
            { id: "data", kind: "output", semantic: "data", valueType: "json", label: "Data" },
        ],
    }),
];
