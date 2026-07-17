export type WidgetLogicEventDispatchKind = "lifecycle" | "interaction";

export type WidgetLogicEventDef = {
    id: string;
    displayName: string;
    description?: string;
    dispatchKind: WidgetLogicEventDispatchKind;
    /**
     * Optional override for which event-head node types may start this event graph.
     * Stored as stable node type ids so shared code can consume the same schema.
     */
    headNodeTypes?: readonly string[];
};

export type WidgetLogicCommandAvailability = "available" | "planned";

export type WidgetLogicCommandDef = {
    id: string;
    displayName: string;
    description?: string;
    capabilityId?: string;
    availability: WidgetLogicCommandAvailability;
};

export type WidgetLogicReadableStateDef = {
    id: string;
    displayName: string;
    description?: string;
};

export type WidgetLogicWritablePropDef = {
    propPath: string;
    displayName: string;
    description?: string;
};

export type WidgetLogicApi = {
    supportsPrivateBlueprint: boolean;
    blueprintLabel?: string;
    events: readonly WidgetLogicEventDef[];
    commands: readonly WidgetLogicCommandDef[];
    readableState: readonly WidgetLogicReadableStateDef[];
    writableProps: readonly WidgetLogicWritablePropDef[];
};

const INIT_EVENT: WidgetLogicEventDef = {
    id: "init",
    displayName: "Init",
    dispatchKind: "lifecycle",
    headNodeTypes: ["blueprint.event.head.init"],
};

const SURFACE_LIFECYCLE_EVENTS: readonly WidgetLogicEventDef[] = [
    {
        id: "beforeSurfaceExit",
        displayName: "Before surface exit",
        description: "Fires before the current Surface starts its exit animation while the element is still mounted.",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.beforeSurfaceExit"],
    },
    {
        id: "afterSurfaceEnter",
        displayName: "After surface enter",
        description: "Fires after the current Surface finishes its enter animation while the element is still mounted.",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.afterSurfaceEnter"],
    },
];

const UNMOUNT_EVENT: WidgetLogicEventDef = {
    id: "unmount",
    displayName: "Unmount",
    description: "Fires when the element is unmounted from the runtime tree.",
    dispatchKind: "lifecycle",
    headNodeTypes: ["blueprint.event.head.unmount"],
};

const KEYBOARD_EVENTS: readonly WidgetLogicEventDef[] = [
    {
        id: "keyDown",
        displayName: "Key down",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.keyDown", "blueprint.event.head.anyKeyDown"],
    },
    {
        id: "keyUp",
        displayName: "Key up",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.keyUp", "blueprint.event.head.anyKeyUp"],
    },
];

const DISPLAYABLE_EVENTS: readonly WidgetLogicEventDef[] = [
    {
        id: "mouseClick",
        displayName: "Mouse click",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.mouseClick"],
    },
    {
        id: "mouseDoubleClick",
        displayName: "Mouse double click",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.mouseDoubleClick"],
    },
    {
        id: "mouseEnter",
        displayName: "Mouse enter",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.mouseEnter"],
    },
    {
        id: "mouseLeave",
        displayName: "Mouse leave",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.mouseLeave"],
    },
    {
        id: "mouseMove",
        displayName: "Mouse move",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.mouseMove"],
    },
    {
        id: "mouseDown",
        displayName: "Mouse down",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.mouseDown"],
    },
    {
        id: "mouseUp",
        displayName: "Mouse up",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.mouseUp"],
    },
    {
        id: "mouseWheel",
        displayName: "Mouse wheel",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.mouseWheel"],
    },
    {
        id: "rightClick",
        displayName: "Right click",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.rightClick"],
    },
    ...KEYBOARD_EVENTS,
    {
        id: "focus",
        displayName: "Focus",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.focus"],
    },
    {
        id: "blur",
        displayName: "Blur",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.blur"],
    },
];

const SCROLL_EVENT: WidgetLogicEventDef = {
    id: "scroll",
    displayName: "Scroll",
    dispatchKind: "interaction",
    headNodeTypes: ["blueprint.event.head.scroll"],
};

const FLUSH_EVENT: WidgetLogicEventDef = {
    id: "flush",
    displayName: "On flush",
    dispatchKind: "lifecycle",
    headNodeTypes: ["blueprint.event.head.flush"],
};

const LIST_ITEM_EVENTS: readonly WidgetLogicEventDef[] = [
    {
        id: "itemRender",
        displayName: "Item render",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.itemRender"],
    },
    {
        id: "itemClick",
        displayName: "Item click",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.itemClick"],
    },
    {
        id: "itemHover",
        displayName: "Item hover",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.itemHover"],
    },
    {
        id: "selectionChanged",
        displayName: "Selection changed",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.selectionChanged"],
    },
    {
        id: "scrollEnd",
        displayName: "Scroll end",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.scrollEnd"],
    },
];

const LIST_ITEM_CONTEXT_EVENTS: readonly WidgetLogicEventDef[] = [
    {
        id: "listItemRefresh",
        displayName: "List item refresh",
        dispatchKind: "lifecycle",
        headNodeTypes: ["blueprint.event.head.listItemRefresh"],
    },
];

const BROADCAST_EVENTS: readonly WidgetLogicEventDef[] = [
    {
        id: "onAnyBroadcast",
        displayName: "Any broadcast",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.onAnyBroadcast"],
    },
    {
        id: "onBroadcast",
        displayName: "Broadcast",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.onBroadcast"],
    },
];

/**
 * Ambient application-window events. Like broadcasts these are not widget
 * interactions, but any widget may listen to them — a settings-page control can
 * track the window without owning the Page or Global blueprint.
 */
const WINDOW_EVENTS: readonly WidgetLogicEventDef[] = [
    {
        id: "windowFullscreenChanged",
        displayName: "Fullscreen changed",
        description: "Fires when the application window enters or leaves fullscreen.",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.fullscreenChanged"],
    },
];

const FRAME_EVENTS: readonly WidgetLogicEventDef[] = [
    INIT_EVENT,
    FLUSH_EVENT,
    ...SURFACE_LIFECYCLE_EVENTS,
    UNMOUNT_EVENT,
    {
        id: "pageEvent",
        displayName: "Page event",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.pageEvent"],
    },
    ...KEYBOARD_EVENTS,
    ...BROADCAST_EVENTS,
    ...WINDOW_EVENTS,
];

const SLIDER_EVENTS: readonly WidgetLogicEventDef[] = [
    INIT_EVENT,
    FLUSH_EVENT,
    ...SURFACE_LIFECYCLE_EVENTS,
    UNMOUNT_EVENT,
    {
        id: "dragStart",
        displayName: "Drag start",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.sliderDragStart"],
    },
    {
        id: "valueChanged",
        displayName: "Value changed",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.sliderValueChanged"],
    },
    {
        id: "dragEnd",
        displayName: "Drag end",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.sliderDragEnd"],
    },
    ...KEYBOARD_EVENTS,
    ...BROADCAST_EVENTS,
    ...WINDOW_EVENTS,
];

const TEXT_INPUT_EVENTS: readonly WidgetLogicEventDef[] = [
    INIT_EVENT,
    FLUSH_EVENT,
    ...SURFACE_LIFECYCLE_EVENTS,
    UNMOUNT_EVENT,
    {
        id: "valueChanged",
        displayName: "Value changed",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.textInputValueChanged"],
    },
    {
        id: "submit",
        displayName: "Submit",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.textInputSubmit"],
    },
    {
        id: "focus",
        displayName: "Focus",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.focus"],
    },
    {
        id: "blur",
        displayName: "Blur",
        dispatchKind: "interaction",
        headNodeTypes: ["blueprint.event.head.blur"],
    },
    ...KEYBOARD_EVENTS,
    ...BROADCAST_EVENTS,
    ...WINDOW_EVENTS,
];

const DISPLAYABLE_WIDGET_EVENTS: readonly WidgetLogicEventDef[] = [
    INIT_EVENT,
    FLUSH_EVENT,
    ...SURFACE_LIFECYCLE_EVENTS,
    UNMOUNT_EVENT,
    ...LIST_ITEM_CONTEXT_EVENTS,
    ...DISPLAYABLE_EVENTS,
    ...BROADCAST_EVENTS,
    ...WINDOW_EVENTS,
];

const COLLECTION_WIDGET_EVENTS: readonly WidgetLogicEventDef[] = [
    INIT_EVENT,
    FLUSH_EVENT,
    ...SURFACE_LIFECYCLE_EVENTS,
    UNMOUNT_EVENT,
    SCROLL_EVENT,
    ...LIST_ITEM_EVENTS,
    ...KEYBOARD_EVENTS,
    ...BROADCAST_EVENTS,
    ...WINDOW_EVENTS,
];

const baseCommands: readonly WidgetLogicCommandDef[] = [
    {
        id: "setVisible",
        displayName: "Set visible",
        capabilityId: "widget.setVisible",
        availability: "available",
    },
    {
        id: "setEnabled",
        displayName: "Set enabled",
        capabilityId: "widget.setEnabled",
        availability: "available",
    },
    {
        id: "setVariant",
        displayName: "Set variant",
        capabilityId: "widget.setVariant",
        availability: "available",
    },
];

/**
 * Collection widgets share the `nl.list` logic surface: collection event heads, runtime item
 * state, and item-template rendering. The Game UI slot wrappers reuse this API so their private
 * blueprints expose the same events and readable state as `nl.list`.
 */
function createCollectionWidgetLogicApi(blueprintLabel: string): WidgetLogicApi {
    return {
        supportsPrivateBlueprint: true,
        blueprintLabel,
        events: COLLECTION_WIDGET_EVENTS,
        commands: [
            {
                id: "refreshItems",
                displayName: "Refresh items",
                availability: "planned",
            },
        ],
        readableState: [
            { id: "itemCount", displayName: "Item count" },
            { id: "scrollOffset", displayName: "Scroll offset" },
            { id: "selectedIndex", displayName: "Selected index" },
        ],
        writableProps: [
            { propPath: "itemsBinding", displayName: "Items binding" },
            { propPath: "previewCount", displayName: "Preview count" },
            { propPath: "selectedIndex", displayName: "Selected index" },
        ],
    };
}

function createTextWidgetLogicApi(blueprintLabel: string): WidgetLogicApi {
    return {
        supportsPrivateBlueprint: true,
        blueprintLabel,
        events: DISPLAYABLE_WIDGET_EVENTS,
        commands: [
            ...baseCommands,
            {
                id: "setText",
                displayName: "Set text",
                capabilityId: "widget.setTextProperties",
                availability: "available",
            },
        ],
        readableState: [
            { id: "visible", displayName: "Visible" },
            { id: "enabled", displayName: "Enabled" },
            { id: "variant", displayName: "Variant" },
            { id: "text", displayName: "Text" },
            { id: "fontAssetId", displayName: "Font asset" },
            { id: "fontSize", displayName: "Font size" },
            { id: "fontWeight", displayName: "Font weight" },
            { id: "color", displayName: "Text color" },
            { id: "textAlign", displayName: "Text align" },
            { id: "textVerticalAlign", displayName: "Vertical align" },
            { id: "lineHeight", displayName: "Line height" },
            { id: "textWrapMode", displayName: "Wrap mode" },
            { id: "effects", displayName: "Effects" },
        ],
        writableProps: [
            { propPath: "variant", displayName: "Variant" },
            { propPath: "appearance", displayName: "Appearance" },
            { propPath: "text", displayName: "Text" },
            { propPath: "fontAssetId", displayName: "Font asset" },
            { propPath: "fontSize", displayName: "Font size" },
            { propPath: "fontWeight", displayName: "Font weight" },
            { propPath: "color", displayName: "Text color" },
            { propPath: "textAlign", displayName: "Text align" },
            { propPath: "textVerticalAlign", displayName: "Vertical align" },
            { propPath: "lineHeight", displayName: "Line height" },
            { propPath: "textWrapMode", displayName: "Wrap mode" },
            { propPath: "effects", displayName: "Effects" },
        ],
    };
}

export const BUILTIN_WIDGET_LOGIC_APIS: Record<string, WidgetLogicApi> = {
    "nl.root": {
        supportsPrivateBlueprint: false,
        blueprintLabel: "Page Logic",
        events: [],
        commands: [],
        readableState: [],
        writableProps: [],
    },
    "nl.container": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Container logic",
        events: DISPLAYABLE_WIDGET_EVENTS,
        commands: baseCommands,
        readableState: [
            { id: "visible", displayName: "Visible" },
            { id: "enabled", displayName: "Enabled" },
            { id: "variant", displayName: "Variant" },
        ],
        writableProps: [
            { propPath: "variant", displayName: "Variant" },
            { propPath: "appearance", displayName: "Appearance" },
            { propPath: "clipContent", displayName: "Clip content" },
        ],
    },
    "nl.text": createTextWidgetLogicApi("Text logic"),
    "nl.dialog.sentence": createTextWidgetLogicApi("Sentence logic"),
    "nl.image": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Image logic",
        events: DISPLAYABLE_WIDGET_EVENTS,
        commands: [
            ...baseCommands,
            {
                id: "setSource",
                displayName: "Set image source",
                availability: "planned",
            },
        ],
        readableState: [
            { id: "visible", displayName: "Visible" },
            { id: "enabled", displayName: "Enabled" },
            { id: "imageSource", displayName: "Image source" },
        ],
        writableProps: [{ propPath: "imageFill.assetId", displayName: "Image asset" }],
    },
    "nl.button": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Button logic",
        events: DISPLAYABLE_WIDGET_EVENTS,
        commands: [
            ...baseCommands,
            {
                id: "setLabel",
                displayName: "Set label",
                capabilityId: "widget.setButtonProperties",
                availability: "available",
            },
            {
                id: "setPointer",
                displayName: "Set pointer",
                capabilityId: "widget.setButtonProperties",
                availability: "available",
            },
        ],
        readableState: [
            { id: "visible", displayName: "Visible" },
            { id: "enabled", displayName: "Enabled" },
            { id: "label", displayName: "Label" },
            { id: "variant", displayName: "Variant" },
            { id: "cursor", displayName: "Pointer" },
        ],
        writableProps: [
            { propPath: "variant", displayName: "Variant" },
            { propPath: "label", displayName: "Label" },
            { propPath: "cursor", displayName: "Pointer" },
            { propPath: "appearance", displayName: "Appearance" },
            { propPath: "interactionDisabled", displayName: "Interaction disabled" },
        ],
    },
    "nl.list": createCollectionWidgetLogicApi("List logic"),
    "nl.notification.list": createCollectionWidgetLogicApi("Notification list logic"),
    "nl.choice.list": createCollectionWidgetLogicApi("Choice list logic"),
    "nl.nvl.list": createCollectionWidgetLogicApi("NVL list logic"),
    "nl.nvl.texts": createTextWidgetLogicApi("NVL text logic"),
    "nl.slider": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Slider logic",
        events: SLIDER_EVENTS,
        commands: [
            ...baseCommands,
            {
                id: "setValue",
                displayName: "Set value",
                capabilityId: "widget.setSliderProperties",
                availability: "available",
            },
        ],
        readableState: [
            { id: "value", displayName: "Value" },
            { id: "normalizedValue", displayName: "Normalized value" },
            { id: "min", displayName: "Min" },
            { id: "max", displayName: "Max" },
            { id: "step", displayName: "Step" },
        ],
        writableProps: [
            { propPath: "value", displayName: "Value" },
            { propPath: "min", displayName: "Min" },
            { propPath: "max", displayName: "Max" },
            { propPath: "step", displayName: "Step" },
        ],
    },
    "nl.textInput": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Text input logic",
        events: TEXT_INPUT_EVENTS,
        commands: [
            ...baseCommands,
            {
                id: "setValue",
                displayName: "Set value",
                capabilityId: "widget.setTextInputProperties",
                availability: "available",
            },
        ],
        readableState: [
            { id: "value", displayName: "Value" },
            { id: "length", displayName: "Length" },
        ],
        writableProps: [
            { propPath: "value", displayName: "Value" },
            { propPath: "placeholder", displayName: "Placeholder" },
            { propPath: "readOnly", displayName: "Read only" },
            { propPath: "disabled", displayName: "Disabled" },
        ],
    },
    "nl.frame": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Page logic",
        events: FRAME_EVENTS,
        commands: [
            ...baseCommands,
            {
                id: "setPage",
                displayName: "Set page",
                availability: "planned",
            },
        ],
        readableState: [
            { id: "targetSurfaceId", displayName: "Target page" },
            { id: "params", displayName: "Params" },
        ],
        writableProps: [
            { propPath: "targetSurfaceId", displayName: "Target page" },
            { propPath: "params", displayName: "Params" },
        ],
    },
};

export function getWidgetLogicApi(elementType: string | undefined | null): WidgetLogicApi | undefined {
    if (!elementType) {
        return undefined;
    }
    return BUILTIN_WIDGET_LOGIC_APIS[elementType];
}

export function getWidgetLogicEvent(
    elementType: string | undefined | null,
    eventId: string | undefined | null,
): WidgetLogicEventDef | undefined {
    if (!eventId) {
        return undefined;
    }
    return getWidgetLogicApi(elementType)?.events.find(eventDef => eventDef.id === eventId);
}

export function listWidgetLogicEventIds(elementType: string | undefined | null): string[] {
    return (getWidgetLogicApi(elementType)?.events ?? []).map(eventDef => eventDef.id);
}
