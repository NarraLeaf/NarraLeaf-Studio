/**
 * Turning what a dispatch calls an event into the export name a script blueprint answers with.
 *
 * There are two vocabularies for one thing, and this is the seam between them:
 *
 *  - A **dispatch slot id** is what the runtime raises - `valueChanged` on a slider,
 *    `gamePreferenceChanged` on a page. It is declared by `widgetLogic.ts` and
 *    `blueprintLifecycle.ts`, and each slot names the **head node types** it admits.
 *  - A **script event id** is what an author exports - `onSliderValueChanged`,
 *    `onPreferenceChanged`. It is derived from the head, because a script export stands where a
 *    head node would stand (see `scriptEvents.ts`).
 *
 * The two agree on most events and disagree on the ones where a head is named after the widget it
 * belongs to (`valueChanged` -> `sliderValueChanged`) or after what raises it rather than what
 * happened (`gamePreferenceChanged` -> `preferenceChanged`). Applying the export-name rule to the
 * slot id therefore produced names no module ever exports - `onValueChanged`, `onOnBroadcast` -
 * for 81 of the 339 handler names the declarations offer. The fix is not a second table: the head
 * is the thing both sides already agree on, so a dispatch resolves its heads through the tables
 * that declare them and maps the head to the event id through `SCRIPT_EVENT_HEADS`.
 *
 * `scriptEventDispatch.test.ts` holds this to the declarations: every event any anchor or widget may
 * export has to be reachable from some dispatch through the functions below.
 *
 * A widget a plugin contributes is not in either table, so its script events are derived from its
 * declaration by the same rule rather than listed (see {@link scriptEventsOfContributedLogicApi}):
 * a built-in head is the built-in event it stands for, and a head the plugin registered - which has
 * no host name - is its event's own id. `pluginWidgetHeadsAndSlots.test.ts` holds that derivation to
 * what the node palette offers the same widget's blueprint.
 */

import {
    SCRIPT_EVENT_HEADS,
    SCRIPT_EVENTS_BY_ANCHOR,
    SCRIPT_EVENTS_BY_WIDGET,
    COMPONENT_EXCLUDED_EVENTS,
    type ScriptEventId,
} from "./scriptEvents";
import type { BuiltinScriptWidgetType } from "./scriptContext";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    getGlobalLifecycleEvent,
    getSurfaceLifecycleEvent,
} from "@shared/types/ui-editor/blueprintLifecycle";
import { getContributedWidget } from "@shared/types/ui-editor/contributedWidgets";
import { getWidgetLogicEvent, type WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";

/**
 * The export name a script event is called through: `mouseClick` -> `onMouseClick`, and a plugin
 * widget's `rated` -> `onRated`.
 *
 * The same rule as `scriptEventExportName`, over any event name rather than the built-in ones only,
 * because a plugin widget's own events are named by the plugin and are not in the typed vocabulary.
 */
export function scriptExportNameOf(eventId: string): string {
    return `on${eventId.charAt(0).toUpperCase()}${eventId.slice(1)}`;
}

/**
 * The one event a set of head node types stands for, or null.
 *
 * Null on two different facts, and the caller wants the same answer for both: a head no script can
 * carry (`On Call`, which is a default export rather than a named one), and a slot whose heads
 * disagree - which the folds make impossible today and which would be a table error rather than
 * something to guess at if it ever happened.
 */
function scriptEventIdOfHeads(headNodeTypes: readonly string[] | undefined): ScriptEventId | null {
    let resolved: ScriptEventId | null = null;
    for (const headNodeType of headNodeTypes ?? []) {
        const eventId = SCRIPT_EVENT_HEADS[headNodeType];
        if (!eventId || (resolved !== null && resolved !== eventId)) {
            return null;
        }
        resolved = eventId;
    }
    return resolved;
}

/** The script event a head node type stands for - for the dispatches that address a head directly. */
export function scriptEventIdOfHead(headNodeType: string): ScriptEventId | null {
    return scriptEventIdOfHeads([headNodeType]);
}

/**
 * The script event a widget's dispatch slot stands for.
 *
 * A built-in id when the slot starts on heads Studio defines. For a plugin widget's event that
 * starts on a head its plugin registered, the plugin event's own id - see
 * {@link scriptEventsOfContributedLogicApi} - which is why this answers a string rather than a
 * {@link ScriptEventId}: those names are the plugin's, not the host's.
 */
export function scriptEventIdForWidgetSlot(widgetType: string | undefined, slotId: string): string | null {
    if (!widgetType) {
        return null;
    }
    const builtin = scriptEventIdOfHeads(getWidgetLogicEvent(widgetType, slotId)?.headNodeTypes);
    if (builtin) {
        return builtin;
    }
    const logicApi = getContributedWidget(widgetType)?.logicApi;
    if (!logicApi) {
        return null;
    }
    return scriptEventsOfContributedLogicApi(logicApi).events
        .find(event => event.pluginHeadTypes && event.slotIds.includes(slotId))?.eventId ?? null;
}

// ---------------------------------------------------------------------------
// A plugin's widget
// ---------------------------------------------------------------------------

/**
 * Events a script on any widget with a blueprint hears whatever the widget declares, because the
 * host raises them against elements rather than through the widget's own table: another element's
 * click or redraw, addressed by `Element Click` / `Element Flush`. The palette offers both heads in
 * every widget blueprint (their scope is the owner kind), and `collectSurfaceScriptListeners` reaches
 * every widget with a blueprint.
 */
const ELEMENT_ADDRESSED_EVENTS: readonly ScriptEventId[] = ["elementClick", "elementFlush"];

/** One event a script on a plugin widget may export. */
export type ContributedScriptEvent = {
    /** The script event: a built-in id, or - for an event on the plugin's own heads - its own id. */
    eventId: string;
    /** The widget events (dispatch slots) that reach it. A built-in id may gather several. */
    slotIds: string[];
    /** The plugin's own heads the event starts on, for an event named by the plugin. */
    pluginHeadTypes?: readonly string[];
};

export type ContributedScriptEventProblem = { eventId: string; message: string };

/** An event id a script can be called through: `on` and the id must spell an identifier. */
function isScriptableEventName(eventId: string): boolean {
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(eventId);
}

function isScriptEventHead(headType: string): boolean {
    return Object.prototype.hasOwnProperty.call(SCRIPT_EVENT_HEADS, headType);
}

/**
 * What a script on a plugin's widget may export, from the widget's declared events.
 *
 * The same two vocabularies as a built-in widget's (see the file comment), and the same rule between
 * them: an event that starts on heads Studio defines is the built-in event those heads stand for -
 * Mouse Click is `onMouseClick` on any widget. An event that starts on a head the plugin registered
 * has no built-in name, because the head is the plugin's; it is called by the event's own id, the
 * name the plugin raises it by (`dispatchEvent("rated", ...)` answers `onRated`), and its `event`
 * argument is the payload the plugin raised - what the head's output pins read in a graph.
 *
 * Two plugin events are left out of the script vocabulary, and only of it - both still start graphs:
 * an id that does not spell an export name (`on` + `value-changed` is not one), and an id another
 * event of the same widget already answers to, which would make one export mean two payloads. Each
 * is returned as a problem for the registration site to say to the plugin's author.
 *
 * Only a widget with a blueprint of its own has a script to call; one without answers nothing.
 */
export function scriptEventsOfContributedLogicApi(
    logicApi: WidgetLogicApi | undefined,
): { events: ContributedScriptEvent[]; problems: ContributedScriptEventProblem[] } {
    const events: ContributedScriptEvent[] = [];
    const problems: ContributedScriptEventProblem[] = [];
    if (!logicApi?.supportsPrivateBlueprint) {
        return { events, problems };
    }
    const byId = new Map<string, ContributedScriptEvent>();
    const add = (eventId: string, slotId: string | null, pluginHeadTypes?: readonly string[]) => {
        const existing = byId.get(eventId);
        if (existing) {
            if (slotId && !existing.slotIds.includes(slotId)) {
                existing.slotIds.push(slotId);
            }
            return;
        }
        const entry: ContributedScriptEvent = {
            eventId,
            slotIds: slotId ? [slotId] : [],
            ...(pluginHeadTypes ? { pluginHeadTypes } : {}),
        };
        byId.set(eventId, entry);
        events.push(entry);
    };

    const pluginEvents: WidgetLogicApi["events"][number][] = [];
    for (const eventDef of logicApi.events) {
        const builtin = scriptEventIdOfHeads(eventDef.headNodeTypes);
        if (builtin) {
            add(builtin, eventDef.id);
        } else if ((eventDef.headNodeTypes ?? []).some(head => !isScriptEventHead(head))) {
            pluginEvents.push(eventDef);
        }
    }
    for (const eventId of ELEMENT_ADDRESSED_EVENTS) {
        add(eventId, null);
    }
    // After every built-in name is taken, so a plugin event can never displace one.
    for (const eventDef of pluginEvents) {
        const exportName = scriptExportNameOf(eventDef.id);
        if (!isScriptableEventName(eventDef.id)) {
            problems.push({
                eventId: eventDef.id,
                message: `"${exportName}" is not a name a script can export, so a script layer cannot answer this `
                    + "event (graphs still can); an id made of letters, digits and underscores can be",
            });
            continue;
        }
        if (byId.has(eventDef.id)) {
            problems.push({
                eventId: eventDef.id,
                message: `a script on this widget already answers "${exportName}" for another event, so a script `
                    + "layer cannot answer this one (graphs still can); give the event an id of its own",
            });
            continue;
        }
        add(eventDef.id, eventDef.id, (eventDef.headNodeTypes ?? []).filter(head => !isScriptEventHead(head)));
    }
    return { events, problems };
}

/** The script event a page-level dispatch slot stands for. */
export function scriptEventIdForSurfaceSlot(slotId: string): ScriptEventId | null {
    return scriptEventIdOfHeads(getSurfaceLifecycleEvent(slotId)?.headNodeTypes);
}

/** The script event a project-level dispatch slot stands for. */
export function scriptEventIdForProjectSlot(slotId: string): ScriptEventId | null {
    return scriptEventIdOfHeads(getGlobalLifecycleEvent(slotId)?.headNodeTypes);
}

/**
 * Every export name a script on this slot may be called through, in the order the declarations list
 * them.
 *
 * Read by the mount-time check that reports a module exporting nothing this slot ever calls: the
 * message names what the slot accepts, which is the fact the author is missing when a handler is
 * spelled for the wrong widget or the wrong anchor.
 *
 * A story row and a value binding are entered through the default export and have no named ones, so
 * both answer with an empty list and the caller asks about `default` instead.
 */
export function scriptEventExportNamesForOwner(
    owner: BlueprintOwnerRef,
    widgetType?: string,
): readonly string[] {
    const events = scriptEventIdsForOwner(owner, widgetType);
    return events.map(scriptExportNameOf);
}

/**
 * The events themselves, for the callers that want ids rather than export names.
 *
 * Strings rather than {@link ScriptEventId}s because a plugin widget's own events are named by its
 * plugin; every built-in name in the list is still one of those ids.
 */
export function scriptEventIdsForOwner(
    owner: BlueprintOwnerRef,
    widgetType?: string,
): readonly string[] {
    switch (owner.kind) {
        case "globalMain":
            return SCRIPT_EVENTS_BY_ANCHOR.project;
        case "surfaceMain":
            return SCRIPT_EVENTS_BY_ANCHOR.surface;
        case "widgetMain":
            return widgetScriptEvents(widgetType);
        case "componentWidgetMain":
            // A definition's graph is kept to "this widget acting on itself"; the same exclusions
            // apply to a script on one. See `COMPONENT_EXCLUDED_EVENTS`.
            return widgetScriptEvents(widgetType).filter(
                event => !(COMPONENT_EXCLUDED_EVENTS as readonly string[]).includes(event),
            );
        default:
            return [];
    }
}

/**
 * A widget type's script events: the built-in table for Studio's own widgets and, for a widget a
 * loaded plugin contributes, what its declaration says (see {@link scriptEventsOfContributedLogicApi}).
 */
function widgetScriptEvents(widgetType: string | undefined): readonly string[] {
    if (!widgetType) {
        return [];
    }
    if (Object.prototype.hasOwnProperty.call(SCRIPT_EVENTS_BY_WIDGET, widgetType)) {
        return SCRIPT_EVENTS_BY_WIDGET[widgetType as BuiltinScriptWidgetType];
    }
    return scriptEventsOfContributedLogicApi(getContributedWidget(widgetType)?.logicApi).events.map(event => event.eventId);
}

/** Whether this slot is entered through the module's default export rather than a named one. */
export function scriptOwnerUsesDefaultExport(owner: BlueprintOwnerRef): boolean {
    return owner.kind === "storyAction" || owner.kind === "widgetValue";
}
