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
 */

import {
    SCRIPT_EVENT_HEADS,
    SCRIPT_EVENTS_BY_ANCHOR,
    SCRIPT_EVENTS_BY_WIDGET,
    COMPONENT_EXCLUDED_EVENTS,
    scriptEventExportName,
    type ScriptEventId,
} from "./scriptEvents";
import type { ScriptWidgetType } from "./scriptContext";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import {
    getGlobalLifecycleEvent,
    getSurfaceLifecycleEvent,
} from "@shared/types/ui-editor/blueprintLifecycle";
import { getWidgetLogicEvent } from "@shared/types/ui-editor/widgetLogic";

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

/** The script event a widget's dispatch slot stands for. */
export function scriptEventIdForWidgetSlot(widgetType: string | undefined, slotId: string): ScriptEventId | null {
    if (!widgetType) {
        return null;
    }
    return scriptEventIdOfHeads(getWidgetLogicEvent(widgetType, slotId)?.headNodeTypes);
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
    return events.map(scriptEventExportName);
}

/** The events themselves, for the callers that want ids rather than export names. */
export function scriptEventIdsForOwner(
    owner: BlueprintOwnerRef,
    widgetType?: string,
): readonly ScriptEventId[] {
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

function widgetScriptEvents(widgetType: string | undefined): readonly ScriptEventId[] {
    if (!widgetType) {
        return [];
    }
    return SCRIPT_EVENTS_BY_WIDGET[widgetType as ScriptWidgetType] ?? [];
}

/** Whether this slot is entered through the module's default export rather than a named one. */
export function scriptOwnerUsesDefaultExport(owner: BlueprintOwnerRef): boolean {
    return owner.kind === "storyAction" || owner.kind === "widgetValue";
}
