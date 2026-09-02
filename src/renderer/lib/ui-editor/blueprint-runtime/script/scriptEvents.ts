/**
 * The exports a script blueprint may have, and what each is handed.
 *
 * A visual graph is entered through a head node; a script is entered through a named export. So
 * the set of heads a slot admits becomes the set of export names a module for that slot may have,
 * and each head's data output pins become the shape of the handler's `event` argument. Both are
 * facts the node catalogue already states, and `scriptEvents.test.ts` holds this file to it: every
 * registered head maps to an event here, every payload lists exactly that head's pins, and every
 * per-anchor and per-widget export list is what the palette would offer that slot.
 *
 * # Folds
 *
 * Four heads exist in a filtered form and an unfiltered one: `On Key Down` is `Any Key Down` with a
 * key binding on the card, `On Preference Changed` is the any-preference head with a key chosen,
 * `On Broadcast` is `On Any Broadcast` with an event name typed in. The filter is a field the
 * author fills because a graph cannot branch cheaply; a script can, so each pair is one export
 * whose payload is the unfiltered head's pins and whose filter is a line of the author's code.
 * `On Action` is the same shape with no unfiltered twin, so its `actionId` field joins the payload.
 *
 * # What is not an export
 *
 * `On Call` is the story row's one entry and becomes the module's default export
 * (`scriptModules.ts`), as `Init` and `On Flush` on a value binding become its default export -
 * neither slot has a second thing to listen for.
 */

import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP,
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
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SWITCH_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SWITCH_TURNED_OFF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_SWITCH_TURNED_ON,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_TEXT_INPUT_SUBMIT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_TEXT_INPUT_VALUE_CHANGED,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_CLOSE_REQUESTED,
} from "@shared/types/blueprint/graph";
import type { BlueprintElementRef } from "@shared/types/blueprint/valueTypes";
import type {
    BlueprintGamePreferenceKey,
    BlueprintGamePreferenceValue,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import type {
    GameScriptContext,
    ScriptSelf,
    StoryScriptContext,
    StorySyncScriptContext,
    ValueScriptContext,
    ScriptWidgetType,
    StoryActionHandler,
    StoryConditionHandler,
    StoryValueHandler,
    ValueHandler,
} from "./scriptContext";

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

/**
 * How a head's output pin is typed for a script.
 *
 * The pin's `valueType` is the coarse graph type (`float`, `json`, ...); the two preference kinds
 * are where the host API already has a narrower name for what the pin carries.
 */
export type ScriptPinKind = "number" | "string" | "boolean" | "unknown" | "element" | "preferenceKey" | "preferenceValue";

/** Unconstrained so it can be applied inside a mapped type; an unknown kind decodes to `unknown`. */
type DecodePin<K> = K extends "number"
    ? number
    : K extends "string"
      ? string
      : K extends "boolean"
        ? boolean
        : K extends "element"
          ? BlueprintElementRef
          : K extends "preferenceKey"
            ? BlueprintGamePreferenceKey
            : K extends "preferenceValue"
              ? BlueprintGamePreferenceValue
              : unknown;

const POINT = { x: "number", y: "number" } as const;
const KEY = { key: "string", altKey: "boolean", ctrlKey: "boolean", shiftKey: "boolean", metaKey: "boolean" } as const;
const ROW = { index: "number", count: "number", key: "string", item: "unknown" } as const;
const SCROLL = { offset: "number", maxOffset: "number", progress: "number" } as const;

/**
 * Every script event, with the shape of its `event` argument: field name to pin kind.
 *
 * Runtime data rather than a type alone so the test can compare each entry with the head's pins,
 * and so the runtime that builds an `event` from a dispatch payload has one table to read.
 */
export const SCRIPT_EVENT_PAYLOADS = {
    appBoot: {},
    gameReady: {},
    windowCloseRequested: {},
    fullscreenChanged: { isFullscreen: "boolean" },
    windowFocusChanged: { isFocused: "boolean" },
    keyDown: KEY,
    keyUp: KEY,
    preferenceChanged: { key: "preferenceKey", value: "preferenceValue", previousValue: "preferenceValue" },
    action: { actionId: "string", source: "string", ...POINT },
    surfaceInit: {},
    surfaceUnmount: {},
    beforeSurfaceExit: {},
    afterSurfaceEnter: {},
    init: {},
    unmount: {},
    flush: { element: "element" },
    mouseClick: POINT,
    mouseDoubleClick: POINT,
    mouseEnter: POINT,
    mouseLeave: POINT,
    mouseMove: POINT,
    mouseDown: { ...POINT, button: "number" },
    mouseUp: { ...POINT, button: "number" },
    mouseWheel: { ...POINT, deltaX: "number", deltaY: "number" },
    rightClick: POINT,
    focus: {},
    blur: {},
    broadcast: { event: "string", data: "unknown", sender: "string" },
    elementClick: { element: "element", ...POINT, button: "number" },
    elementFlush: { element: "element" },
    itemClick: ROW,
    itemHover: ROW,
    itemRender: ROW,
    selectionChanged: { ...ROW, previousIndex: "number" },
    scroll: SCROLL,
    scrollEnd: SCROLL,
    listItemRefresh: { props: "unknown", ...ROW },
    sliderDragStart: { value: "number" },
    sliderDragEnd: { value: "number" },
    sliderValueChanged: { value: "number", previousValue: "number" },
    switchChanged: { checked: "boolean", previousChecked: "boolean" },
    switchTurnedOn: {},
    switchTurnedOff: {},
    textInputSubmit: { value: "string" },
    textInputValueChanged: { value: "string", previousValue: "string" },
    pageEvent: { event: "string", data: "unknown" },
} as const satisfies Record<string, Record<string, ScriptPinKind>>;

export type ScriptEventId = keyof typeof SCRIPT_EVENT_PAYLOADS;

export type ScriptEventPayload<E extends ScriptEventId> = {
    readonly [K in keyof (typeof SCRIPT_EVENT_PAYLOADS)[E]]: DecodePin<(typeof SCRIPT_EVENT_PAYLOADS)[E][K]>;
};

/** `mouseClick` is exported as `onMouseClick`; the rule, not a table. */
export type ScriptEventExportName<E extends ScriptEventId> = `on${Capitalize<E>}`;

export function scriptEventExportName<E extends ScriptEventId>(eventId: E): ScriptEventExportName<E> {
    return `on${eventId.charAt(0).toUpperCase()}${eventId.slice(1)}` as ScriptEventExportName<E>;
}

// ---------------------------------------------------------------------------
// Heads
// ---------------------------------------------------------------------------

/**
 * Which script event each head node starts. The folded pairs share an entry; see the file comment.
 *
 * `On Call` is absent on purpose - it is not an export - and the test asserts that this is the
 * only registered head absent here.
 */
export const SCRIPT_EVENT_HEADS: Readonly<Record<string, ScriptEventId>> = {
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_APP_BOOT]: "appBoot",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_GAME_READY]: "gameReady",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_CLOSE_REQUESTED]: "windowCloseRequested",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_FULLSCREEN_CHANGED]: "fullscreenChanged",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_WINDOW_FOCUS_CHANGED]: "windowFocusChanged",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_DOWN]: "keyDown",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_DOWN]: "keyDown",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_KEY_UP]: "keyUp",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_KEY_UP]: "keyUp",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_PREFERENCE_CHANGED]: "preferenceChanged",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ANY_PREFERENCE_CHANGED]: "preferenceChanged",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ACTION]: "action",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_INIT]: "surfaceInit",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SURFACE_UNMOUNT]: "surfaceUnmount",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_BEFORE_SURFACE_EXIT]: "beforeSurfaceExit",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_AFTER_SURFACE_ENTER]: "afterSurfaceEnter",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_INIT]: "init",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_UNMOUNT]: "unmount",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_FLUSH]: "flush",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_CLICK]: "mouseClick",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOUBLE_CLICK]: "mouseDoubleClick",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_ENTER]: "mouseEnter",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_LEAVE]: "mouseLeave",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_MOVE]: "mouseMove",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_DOWN]: "mouseDown",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_UP]: "mouseUp",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_MOUSE_WHEEL]: "mouseWheel",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_RIGHT_CLICK]: "rightClick",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_FOCUS]: "focus",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_BLUR]: "blur",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST]: "broadcast",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST]: "broadcast",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK]: "elementClick",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH]: "elementFlush",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_CLICK]: "itemClick",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_HOVER]: "itemHover",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_ITEM_RENDER]: "itemRender",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SELECTION_CHANGED]: "selectionChanged",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL]: "scroll",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SCROLL_END]: "scrollEnd",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_LIST_ITEM_REFRESH]: "listItemRefresh",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_START]: "sliderDragStart",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_DRAG_END]: "sliderDragEnd",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SLIDER_VALUE_CHANGED]: "sliderValueChanged",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SWITCH_CHANGED]: "switchChanged",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SWITCH_TURNED_ON]: "switchTurnedOn",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_SWITCH_TURNED_OFF]: "switchTurnedOff",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_TEXT_INPUT_SUBMIT]: "textInputSubmit",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_TEXT_INPUT_VALUE_CHANGED]: "textInputValueChanged",
    [BLUEPRINT_NODE_TYPE_EVENT_HEAD_PAGE_EVENT]: "pageEvent",
};

// ---------------------------------------------------------------------------
// Which events each slot may export
// ---------------------------------------------------------------------------

/**
 * Events a project script and a surface script may export.
 *
 * Written by hand and held to the palette: the test derives the same lists from the registry by
 * asking `isBlueprintNodeAllowedInGraphContext` about every head, and fails on any difference.
 * This is the half of the declarations the generator (B3) will eventually write; until then the
 * test is what stops it drifting.
 */
export const SCRIPT_EVENTS_BY_ANCHOR = {
    project: [
        "appBoot",
        "gameReady",
        "keyDown",
        "keyUp",
        "preferenceChanged",
        "fullscreenChanged",
        "windowFocusChanged",
        "windowCloseRequested",
        "action",
    ],
    surface: [
        "surfaceInit",
        "surfaceUnmount",
        "beforeSurfaceExit",
        "afterSurfaceEnter",
        "mouseClick",
        "rightClick",
        "keyDown",
        "keyUp",
        "preferenceChanged",
        "fullscreenChanged",
        "windowFocusChanged",
        "windowCloseRequested",
        "action",
        "broadcast",
        "elementClick",
        "elementFlush",
    ],
} as const satisfies Record<"project" | "surface", readonly ScriptEventId[]>;

const DISPLAYABLE_EVENTS = [
    "init",
    "unmount",
    "flush",
    "beforeSurfaceExit",
    "afterSurfaceEnter",
    "keyDown",
    "keyUp",
    "fullscreenChanged",
    "windowFocusChanged",
    "broadcast",
    "elementClick",
    "elementFlush",
] as const;

const POINTER_EVENTS = [
    "mouseClick",
    "mouseDoubleClick",
    "mouseEnter",
    "mouseLeave",
    "mouseMove",
    "mouseDown",
    "mouseUp",
    "mouseWheel",
    "rightClick",
    "focus",
    "blur",
] as const;

const ROW_WIDGET_EVENTS = [...DISPLAYABLE_EVENTS, ...POINTER_EVENTS, "listItemRefresh"] as const;

const LIST_EVENTS = [
    ...DISPLAYABLE_EVENTS,
    "itemClick",
    "itemHover",
    "itemRender",
    "selectionChanged",
    "scroll",
    "scrollEnd",
] as const;

/**
 * Events a widget script may export, by widget type. Same discipline as {@link SCRIPT_EVENTS_BY_ANCHOR}.
 */
export const SCRIPT_EVENTS_BY_WIDGET = {
    "nl.container": ROW_WIDGET_EVENTS,
    "nl.text": ROW_WIDGET_EVENTS,
    "nl.image": ROW_WIDGET_EVENTS,
    "nl.video": [...DISPLAYABLE_EVENTS, ...POINTER_EVENTS],
    "nl.puppet": [...DISPLAYABLE_EVENTS, ...POINTER_EVENTS],
    "nl.button": ROW_WIDGET_EVENTS,
    "nl.textInput": [...DISPLAYABLE_EVENTS, "focus", "blur", "textInputSubmit", "textInputValueChanged"],
    "nl.slider": [...DISPLAYABLE_EVENTS, "sliderDragStart", "sliderDragEnd", "sliderValueChanged"],
    "nl.switch": [...DISPLAYABLE_EVENTS, ...POINTER_EVENTS, "switchChanged", "switchTurnedOn", "switchTurnedOff"],
    "nl.list": LIST_EVENTS,
    "nl.frame": [...DISPLAYABLE_EVENTS, "pageEvent"],
    "nl.dialog.sentence": ROW_WIDGET_EVENTS,
    "nl.notification.list": LIST_EVENTS,
    "nl.choice.list": LIST_EVENTS,
    "nl.nvl.list": LIST_EVENTS,
    "nl.nvl.texts": ROW_WIDGET_EVENTS,
} as const satisfies Record<ScriptWidgetType, readonly ScriptEventId[]>;

/**
 * Events a widget script loses inside a component definition.
 *
 * The palette keeps a definition's graph to "this widget acting on itself": the keyboard heads,
 * the broadcast pair and the two heads that name a *different* element are left out, and whether
 * a definition should reach them is a question with its own answer, not a leftover to tidy here.
 */
export const COMPONENT_EXCLUDED_EVENTS = [
    "keyDown",
    "keyUp",
    "fullscreenChanged",
    "windowFocusChanged",
    "broadcast",
    "elementClick",
    "elementFlush",
] as const satisfies readonly ScriptEventId[];

type ComponentExcludedEvent = (typeof COMPONENT_EXCLUDED_EVENTS)[number];

// ---------------------------------------------------------------------------
// Module shapes
// ---------------------------------------------------------------------------

export type ScriptEventHandler<Self extends ScriptSelf, E extends ScriptEventId> = (
    ctx: GameScriptContext<Self>,
    event: ScriptEventPayload<E>,
) => void | Promise<void>;

// ---------------------------------------------------------------------------
// What an author writes
// ---------------------------------------------------------------------------

/**
 * The names an author annotates a handler with.
 *
 * A script's handlers are named exports - `export function onMouseClick(...)` - so each one states
 * its own types, and these are what it states them as. The module types below describe the
 * namespace those exports add up to; nothing has to be written in that shape.
 *
 * Two forms, because the two ways of writing a function want different things:
 *
 *     export function onSliderValueChanged(ctx: WidgetCtx<"nl.slider">, event: ScriptEvent<"sliderValueChanged">) {}
 *
 *     export const onSliderValueChanged: WidgetHandler<"nl.slider", "sliderValueChanged"> = (ctx, event) => {};
 *
 * The first is a declaration and annotates each parameter; the second annotates the whole function
 * once and infers both. The generated half of the declarations (B3) narrows the widget type per
 * element, so a real project's script names the element rather than its type.
 */
export type ScriptEvent<E extends ScriptEventId> = ScriptEventPayload<E>;

export type GlobalCtx = GameScriptContext<{ kind: "project" }>;
/** A story row's context. The synchronous modes get {@link StorySyncCtx} instead. */
export type StoryCtx = StoryScriptContext;
export type StorySyncCtx = StorySyncScriptContext;
/** A value binding's context: the host API's reads, and nothing that waits. */
export type ValueCtx = ValueScriptContext;
export type SurfaceCtx = GameScriptContext<SurfaceSelf>;
export type WidgetCtx<W extends ScriptWidgetType> = GameScriptContext<ElementSelf<W>>;
export type ComponentWidgetCtx<W extends ScriptWidgetType> = GameScriptContext<ComponentElementSelf<W>>;

export type GlobalHandler<E extends (typeof SCRIPT_EVENTS_BY_ANCHOR)["project"][number]> = ScriptEventHandler<
    { kind: "project" },
    E
>;
export type SurfaceHandler<E extends (typeof SCRIPT_EVENTS_BY_ANCHOR)["surface"][number]> = ScriptEventHandler<
    SurfaceSelf,
    E
>;
export type WidgetHandler<
    W extends ScriptWidgetType,
    E extends (typeof SCRIPT_EVENTS_BY_WIDGET)[W][number],
> = ScriptEventHandler<ElementSelf<W>, E>;
export type ComponentWidgetHandler<
    W extends ScriptWidgetType,
    E extends Exclude<(typeof SCRIPT_EVENTS_BY_WIDGET)[W][number], ComponentExcludedEvent>,
> = ScriptEventHandler<ComponentElementSelf<W>, E>;

/** A module's optional named exports, one per event the slot admits. */
export type ScriptEventExports<Self extends ScriptSelf, E extends ScriptEventId> = {
    [K in E as ScriptEventExportName<K>]?: ScriptEventHandler<Self, K>;
};

type SurfaceSelf = Extract<ScriptSelf, { kind: "surface" }>;
type ElementSelf<W extends ScriptWidgetType> = Extract<ScriptSelf, { kind: "element" }> & { widgetType: W };
type ComponentElementSelf<W extends ScriptWidgetType> = Extract<ScriptSelf, { kind: "componentElement" }> & {
    widgetType: W;
};

export type GlobalScriptModule = ScriptEventExports<{ kind: "project" }, (typeof SCRIPT_EVENTS_BY_ANCHOR)["project"][number]>;

export type SurfaceScriptModule = ScriptEventExports<SurfaceSelf, (typeof SCRIPT_EVENTS_BY_ANCHOR)["surface"][number]>;

export type WidgetScriptModule<W extends ScriptWidgetType> = ScriptEventExports<
    ElementSelf<W>,
    (typeof SCRIPT_EVENTS_BY_WIDGET)[W][number]
>;

export type ComponentWidgetScriptModule<W extends ScriptWidgetType> = ScriptEventExports<
    ComponentElementSelf<W>,
    Exclude<(typeof SCRIPT_EVENTS_BY_WIDGET)[W][number], ComponentExcludedEvent>
>;

export type ValueScriptModule = { default: ValueHandler };

export type StoryScriptModule<Mode extends "action" | "value" | "condition" = "action"> = {
    default: Mode extends "value" ? StoryValueHandler : Mode extends "condition" ? StoryConditionHandler : StoryActionHandler;
};

/**
 * The module shape a given owner's script must have.
 *
 * Keyed on the owner union so a new owner position is a compile error here (the test asserts no
 * position maps to `never`). `W` is the widget type of an element owner; the generated
 * declarations supply it from the project, and callers that do not know it get every widget's
 * union, which is the loose but honest answer.
 */
export type ScriptModuleFor<
    Owner extends BlueprintOwnerRef,
    W extends ScriptWidgetType = ScriptWidgetType,
> = Owner extends { kind: "globalMain" }
    ? GlobalScriptModule
    : Owner extends { kind: "surfaceMain" }
      ? SurfaceScriptModule
      : Owner extends { kind: "widgetMain" }
        ? WidgetScriptModule<W>
        : Owner extends { kind: "widgetValue" }
          ? ValueScriptModule
          : Owner extends { kind: "componentWidgetMain" }
            ? ComponentWidgetScriptModule<W>
            : Owner extends { kind: "storyAction"; mode?: infer M }
              ? StoryScriptModule<M extends "value" | "condition" ? M : "action">
              : never;
