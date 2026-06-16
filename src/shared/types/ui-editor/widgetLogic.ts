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

const CLICK_EVENT: WidgetLogicEventDef = {
    id: "click",
    displayName: "Click",
    dispatchKind: "interaction",
    headNodeTypes: ["blueprint.event.head.click"],
};

const BASE_WIDGET_EVENTS: readonly WidgetLogicEventDef[] = [CLICK_EVENT];

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
        events: BASE_WIDGET_EVENTS,
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
    "nl.text": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Text logic",
        events: BASE_WIDGET_EVENTS,
        commands: [
            ...baseCommands,
            {
                id: "setText",
                displayName: "Set text",
                availability: "planned",
            },
        ],
        readableState: [
            { id: "visible", displayName: "Visible" },
            { id: "enabled", displayName: "Enabled" },
            { id: "text", displayName: "Text" },
        ],
        writableProps: [{ propPath: "text", displayName: "Text" }],
    },
    "nl.image": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Image logic",
        events: BASE_WIDGET_EVENTS,
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
        events: BASE_WIDGET_EVENTS,
        commands: [
            ...baseCommands,
            {
                id: "setLabel",
                displayName: "Set label",
                availability: "planned",
            },
        ],
        readableState: [
            { id: "visible", displayName: "Visible" },
            { id: "enabled", displayName: "Enabled" },
            { id: "label", displayName: "Label" },
            { id: "variant", displayName: "Variant" },
        ],
        writableProps: [
            { propPath: "variant", displayName: "Variant" },
            { propPath: "label", displayName: "Label" },
            { propPath: "appearance", displayName: "Appearance" },
            { propPath: "interactionDisabled", displayName: "Interaction disabled" },
        ],
    },
    "nl.list": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "List logic",
        events: [],
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
