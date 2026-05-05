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
    displayName: "Initialize",
    description: "Runs once when this widget appears on the surface.",
    dispatchKind: "lifecycle",
    headNodeTypes: ["blueprint.event.head.init"],
};

const CLICK_EVENT: WidgetLogicEventDef = {
    id: "click",
    displayName: "Click",
    description: "Runs when the user activates this button.",
    dispatchKind: "interaction",
    headNodeTypes: ["blueprint.event.head.click"],
};

const baseCommands: readonly WidgetLogicCommandDef[] = [
    {
        id: "setVisible",
        displayName: "Set visible",
        description: "Toggle the widget visibility at runtime.",
        capabilityId: "widget.setVisible",
        availability: "available",
    },
    {
        id: "setEnabled",
        displayName: "Set enabled",
        description: "Toggle whether the widget accepts runtime interaction.",
        capabilityId: "widget.setEnabled",
        availability: "available",
    },
    {
        id: "setVariant",
        displayName: "Set variant",
        description: "Switch the runtime appearance variant when the widget supports variants.",
        capabilityId: "widget.setVariant",
        availability: "available",
    },
];

export const BUILTIN_WIDGET_LOGIC_APIS: Record<string, WidgetLogicApi> = {
    "nl.root": {
        supportsPrivateBlueprint: false,
        blueprintLabel: "Surface blueprint",
        events: [],
        commands: [],
        readableState: [],
        writableProps: [],
    },
    "nl.container": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Container blueprint",
        events: [INIT_EVENT],
        commands: baseCommands,
        readableState: [
            { id: "visible", displayName: "Visible" },
            { id: "enabled", displayName: "Enabled" },
            { id: "variant", displayName: "Variant" },
        ],
        writableProps: [
            { propPath: "appearance", displayName: "Appearance" },
            { propPath: "clipContent", displayName: "Clip content" },
        ],
    },
    "nl.text": {
        supportsPrivateBlueprint: true,
        blueprintLabel: "Text blueprint",
        events: [INIT_EVENT],
        commands: [
            ...baseCommands,
            {
                id: "setText",
                displayName: "Set text",
                description: "Update the rendered text content.",
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
        blueprintLabel: "Image blueprint",
        events: [INIT_EVENT],
        commands: [
            ...baseCommands,
            {
                id: "setSource",
                displayName: "Set image source",
                description: "Swap the image asset used by this widget.",
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
        blueprintLabel: "Button blueprint",
        events: [INIT_EVENT, CLICK_EVENT],
        commands: [
            ...baseCommands,
            {
                id: "setLabel",
                displayName: "Set label",
                description: "Update the button label at runtime.",
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
            { propPath: "label", displayName: "Label" },
            { propPath: "appearance", displayName: "Appearance" },
            { propPath: "interactionDisabled", displayName: "Interaction disabled" },
        ],
    },
    "nl.list": {
        supportsPrivateBlueprint: false,
        blueprintLabel: "List blueprint",
        events: [],
        commands: [
            {
                id: "refreshItems",
                displayName: "Refresh items",
                description: "Rebuild the repeated item preview from the bound collection.",
                availability: "planned",
            },
        ],
        readableState: [{ id: "itemCount", displayName: "Item count" }],
        writableProps: [{ propPath: "previewCount", displayName: "Preview count" }],
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
