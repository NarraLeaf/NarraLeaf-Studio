import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
} from "@shared/types/blueprint/graph";
import {
    GLOBAL_LIFECYCLE_EVENTS,
    SURFACE_LIFECYCLE_EVENTS,
} from "@shared/types/ui-editor/blueprintLifecycle";
import { listWidgetLogicEventIds } from "@shared/types/ui-editor/widgetLogic";
import { SCRIPT_WIDGET_TYPES } from "./scriptContext";
import {
    SCRIPT_EVENTS_BY_ANCHOR,
    SCRIPT_EVENTS_BY_WIDGET,
    scriptEventExportName,
    type ScriptEventId,
} from "./scriptEvents";
import {
    scriptEventExportNamesForOwner,
    scriptEventIdForProjectSlot,
    scriptEventIdForSurfaceSlot,
    scriptEventIdForWidgetSlot,
    scriptEventIdOfHead,
} from "./scriptEventDispatch";

/**
 * Every handler name the declarations offer an author has to be one some dispatch will call.
 *
 * This is the assertion that was missing. `scriptEvents.test.ts` holds the export tables to the
 * *palette* - which heads a slot admits - and that was green while 81 of the 339 names those tables
 * produce were unreachable, because the dispatcher asked for `on<Capitalize(slot id)>` and the slot
 * id is a different vocabulary from the head. Reachability is a fact about the dispatcher, so it
 * needs a test of its own, and this is it.
 */

/**
 * The events a dispatch addresses by head node type rather than through a slot table.
 *
 * Three, and all three for the same reason: they are not raised *by* a widget, they are fanned out
 * *to* every widget on a surface, so no widget's slot table names them.
 * `dispatchBlueprintElementEvent` passes its head straight to `scriptEventIdOfHead`, and
 * `dispatchBlueprintBroadcastEvent` derives its event from the any-broadcast head.
 *
 * Pinned rather than merely allowed: the second test below asserts this set is *exactly* the events
 * no slot reaches, so an event that stops being slot-reachable fails here instead of going quiet.
 */
const HEAD_ADDRESSED_HEADS = [
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_ANY_BROADCAST,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ON_BROADCAST,
] as const;

const HEAD_ADDRESSED_EVENTS = new Set<ScriptEventId>(
    HEAD_ADDRESSED_HEADS.map(head => {
        const eventId = scriptEventIdOfHead(head);
        if (!eventId) {
            throw new Error(`${head} is not a head any script event maps to`);
        }
        return eventId;
    }),
);

/** Which project-level slots reach each event. */
function projectSlotEvents(): Set<ScriptEventId> {
    const reached = new Set<ScriptEventId>();
    for (const def of GLOBAL_LIFECYCLE_EVENTS) {
        const eventId = scriptEventIdForProjectSlot(def.id);
        if (eventId) {
            reached.add(eventId);
        }
    }
    return reached;
}

function surfaceSlotEvents(): Set<ScriptEventId> {
    const reached = new Set<ScriptEventId>();
    for (const def of SURFACE_LIFECYCLE_EVENTS) {
        const eventId = scriptEventIdForSurfaceSlot(def.id);
        if (eventId) {
            reached.add(eventId);
        }
    }
    return reached;
}

function widgetSlotEvents(widgetType: string): Set<ScriptEventId> {
    const reached = new Set<ScriptEventId>();
    for (const slotId of listWidgetLogicEventIds(widgetType)) {
        const eventId = scriptEventIdForWidgetSlot(widgetType, slotId);
        if (eventId) {
            reached.add(eventId);
        }
    }
    return reached;
}

describe("every declared script event is reachable from a dispatch", () => {
    it("reaches every event a project script may export", () => {
        const reached = projectSlotEvents();
        const unreachable = SCRIPT_EVENTS_BY_ANCHOR.project.filter(
            event => !reached.has(event) && !HEAD_ADDRESSED_EVENTS.has(event),
        );
        expect(unreachable.map(scriptEventExportName)).toEqual([]);
    });

    it("reaches every event a page script may export", () => {
        const reached = surfaceSlotEvents();
        const unreachable = SCRIPT_EVENTS_BY_ANCHOR.surface.filter(
            event => !reached.has(event) && !HEAD_ADDRESSED_EVENTS.has(event),
        );
        expect(unreachable.map(scriptEventExportName)).toEqual([]);
    });

    it.each(SCRIPT_WIDGET_TYPES)("reaches every event a %s script may export", widgetType => {
        const reached = widgetSlotEvents(widgetType);
        const unreachable = SCRIPT_EVENTS_BY_WIDGET[widgetType].filter(
            event => !reached.has(event) && !HEAD_ADDRESSED_EVENTS.has(event),
        );
        expect(unreachable.map(scriptEventExportName)).toEqual([]);
    });

    it("names the events no slot table reaches at all", () => {
        const bySlot = new Set<ScriptEventId>([
            ...projectSlotEvents(),
            ...surfaceSlotEvents(),
            ...SCRIPT_WIDGET_TYPES.flatMap(widgetType => [...widgetSlotEvents(widgetType)]),
        ]);
        const declared = new Set<ScriptEventId>([
            ...SCRIPT_EVENTS_BY_ANCHOR.project,
            ...SCRIPT_EVENTS_BY_ANCHOR.surface,
            ...SCRIPT_WIDGET_TYPES.flatMap(widgetType => [...SCRIPT_EVENTS_BY_WIDGET[widgetType]]),
        ]);
        // Two, and both of them the events that name a *different* element: nothing raises them on
        // the widget that answers them, so no widget's table lists them. `broadcast` is not here -
        // the widget tables do carry an `onBroadcast` slot - but nothing dispatches through that
        // slot either, which is why it is in `HEAD_ADDRESSED_EVENTS` as well. A new event landing
        // in this list is one no dispatch will reach until it is given a head or a slot.
        expect([...declared].filter(event => !bySlot.has(event)).sort()).toEqual([
            "elementClick",
            "elementFlush",
        ]);
        for (const event of HEAD_ADDRESSED_EVENTS) {
            expect(declared.has(event)).toBe(true);
        }
    });
});

describe("the slot vocabulary and the export vocabulary", () => {
    /**
     * The six shapes the two vocabularies differ in. Spelled out rather than derived, because these
     * are the pairs the original bug was made of: each left-hand id, run through the export-name
     * rule directly, produces a name no module has.
     */
    it.each([
        ["nl.slider", "valueChanged", "sliderValueChanged"],
        ["nl.slider", "dragStart", "sliderDragStart"],
        ["nl.textInput", "submit", "textInputSubmit"],
        ["nl.textInput", "valueChanged", "textInputValueChanged"],
        ["nl.switch", "changed", "switchChanged"],
        ["nl.switch", "turnedOn", "switchTurnedOn"],
        ["nl.container", "windowFullscreenChanged", "fullscreenChanged"],
    ])("resolves %s's %s slot to %s", (widgetType, slotId, expected) => {
        expect(scriptEventIdForWidgetSlot(widgetType, slotId)).toBe(expected);
    });

    it.each([
        ["gamePreferenceChanged", "preferenceChanged"],
        ["windowFullscreenChanged", "fullscreenChanged"],
        ["inputAction", "action"],
        ["appBoot", "appBoot"],
    ])("resolves the project's %s slot to %s", (slotId, expected) => {
        expect(scriptEventIdForProjectSlot(slotId)).toBe(expected);
    });

    it("resolves nothing for a slot the widget type does not have", () => {
        expect(scriptEventIdForWidgetSlot("nl.text", "sliderValueChanged")).toBeNull();
        expect(scriptEventIdForWidgetSlot(undefined, "mouseClick")).toBeNull();
    });

    it("resolves nothing for On Call, which is a default export rather than a named one", () => {
        expect(scriptEventIdOfHead("blueprint.event.head.onCall")).toBeNull();
    });
});

describe("the export names a slot accepts", () => {
    it("names a slider's own three handlers", () => {
        const names = scriptEventExportNamesForOwner(
            { kind: "widgetMain", surfaceId: "s1", elementId: "e1" },
            "nl.slider",
        );
        expect(names).toContain("onSliderValueChanged");
        expect(names).toContain("onSliderDragStart");
        expect(names).not.toContain("onSwitchChanged");
    });

    it("drops from a component definition what the palette drops", () => {
        const inSurface = scriptEventExportNamesForOwner(
            { kind: "widgetMain", surfaceId: "s1", elementId: "e1" },
            "nl.button",
        );
        const inComponent = scriptEventExportNamesForOwner(
            { kind: "componentWidgetMain", componentId: "c1", elementId: "e1" },
            "nl.button",
        );
        expect(inSurface).toContain("onBroadcast");
        expect(inComponent).not.toContain("onBroadcast");
        expect(inComponent).toContain("onMouseClick");
    });

    it("has no named exports for the two slots entered through the default export", () => {
        expect(scriptEventExportNamesForOwner({ kind: "storyAction", blueprintId: "b1" })).toEqual([]);
        expect(
            scriptEventExportNamesForOwner({ kind: "widgetValue", surfaceId: "s1", elementId: "e1", propPath: "text" }),
        ).toEqual([]);
    });
});
