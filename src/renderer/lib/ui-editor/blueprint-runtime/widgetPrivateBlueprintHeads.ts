/**
 * Reading a widget's own blueprint: which slots it listens on, and whether it listens at all.
 *
 * A widget's handlers used to be recorded on the element, as `behavior.events[slot] =
 * {kind: "blueprintEvent", blueprintId, eventId}`. They are not any more: the element's private
 * blueprint is found through `blueprintDocument.ownerRecords`, keyed by `(surface, element)` - or by
 * `(component, element)` inside a component definition - and the slot a graph answers is decided by
 * the *head node* in it, not by the graph's name.
 *
 * Both readings still have to be asked, because the old shape can still be on disk. What must not
 * happen is a caller asking only the first: every widget the current editor wires carries no
 * `behavior` at all, so a check written against it alone answers "listens to nothing" for the whole
 * project. That is what this module exists to stop being written a fourth time.
 */

import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import { resolveBlueprintEventHeadTypesForUiSlot } from "@shared/types/blueprint/graph";
import { getWidgetLogicApi, getWidgetLogicEvent, listWidgetLogicEventIds } from "@shared/types/ui-editor/widgetLogic";
import {
    componentWidgetMainOwnerKey,
    widgetMainOwnerKey,
} from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";

/** Where a widget's private blueprint is looked up from. A component definition keys by component. */
export type WidgetBlueprintOwnerScope = {
    surfaceId: string;
    /** Set when the element lives in a component definition rather than directly on a surface. */
    componentId?: string;
};

/** The blueprint this widget owns, or `undefined` when it has never been given one. */
export function resolveWidgetPrivateBlueprintId(
    document: BlueprintDocument | null | undefined,
    scope: WidgetBlueprintOwnerScope,
    elementId: string,
): string | undefined {
    if (!document) {
        return undefined;
    }
    const ownerKey = scope.componentId
        ? componentWidgetMainOwnerKey(scope.componentId, elementId)
        : widgetMainOwnerKey(scope.surfaceId, elementId);
    return document.ownerRecords?.[ownerKey]?.activeBlueprintId;
}

/**
 * What to answer for a blueprint whose handlers cannot be read.
 *
 * A script module exports its handlers as functions, so no head node is visible in it. Which way
 * that should fall depends on the polarity of the caller's question, and both polarities are in use:
 * "is anything listening at all" wants it credited, because reporting a widget that does have a
 * handler is the worse mistake; "will a second thing also run" wants it refused, because crediting
 * it would put a finding on every widget with a script module.
 */
export type UnreadableBlueprintVerdict = "listening" | "silent";

function blueprintHasHead(
    blueprint: Blueprint | undefined,
    headTypes: ReadonlySet<string>,
    unreadable: UnreadableBlueprintVerdict,
): boolean {
    if (!blueprint) {
        return false;
    }
    if (blueprint.program.kind !== "graph") {
        return unreadable === "listening";
    }
    return Object.values(blueprint.program.graphs.events ?? {}).some(eventGraph =>
        Object.values(eventGraph?.graph?.nodes ?? {}).some(node => headTypes.has(node.type)),
    );
}

/**
 * Whether the widget's own blueprint carries a head node that starts on this slot.
 *
 * The graph's *name* is not consulted, deliberately: the dispatcher looks for a head node of a type
 * the slot allows, in any of the blueprint's event graphs, so a handler an author put on a layer
 * called anything at all still runs. `resolveBlueprintEventHeadTypesForUiSlot` is the same function
 * it asks, so the two cannot disagree about which heads count for which widget.
 */
export function widgetPrivateBlueprintHasSlotHead(
    document: BlueprintDocument | null | undefined,
    scope: WidgetBlueprintOwnerScope,
    element: UIElement,
    slotId: string,
    unreadable: UnreadableBlueprintVerdict = "listening",
): boolean {
    if (!document) {
        return false;
    }
    const headTypes = new Set(resolveBlueprintEventHeadTypesForUiSlot(slotId, element.type));
    if (headTypes.size === 0) {
        return false;
    }
    const blueprintId = resolveWidgetPrivateBlueprintId(document, scope, element.id);
    return blueprintHasHead(blueprintId ? document.blueprints?.[blueprintId] : undefined, headTypes, unreadable);
}

/** The slots of this widget type a player's input arrives on, as opposed to its lifecycle slots. */
function interactionSlotIds(elementType: string): string[] {
    return listWidgetLogicEventIds(elementType)
        .filter(slotId => getWidgetLogicEvent(elementType, slotId)?.dispatchKind === "interaction");
}

/**
 * Whether anything runs when the player operates this element.
 *
 * `dispatchKind` is what separates the two halves of a widget's slot list, and only the interaction
 * half belongs here: a widget whose single graph is an `init` is not something a player reaches for,
 * so its being hidden, transparent or tiny says nothing. Asking that question of the whole slot list
 * - which the element-shaped reading used to do, having no other list to consult - reports scenery
 * that runs a graph on mount as though it were an unreachable button.
 */
export function elementListensForPlayerInput(
    element: UIElement,
    scope: WidgetBlueprintOwnerScope,
    blueprintDocument: BlueprintDocument | null | undefined,
): boolean {
    const slots = interactionSlotIds(element.type);
    if (slots.length === 0) {
        return false;
    }

    const bound = element.behavior?.events;
    if (bound) {
        for (const slotId of slots) {
            const binding = bound[slotId];
            if (!binding) {
                continue;
            }
            if (binding.kind === "blueprintEvent" || (binding.kind === "actions" && binding.actions.length > 0)) {
                return true;
            }
        }
    }

    if (!getWidgetLogicApi(element.type)?.supportsPrivateBlueprint) {
        return false;
    }
    return slots.some(slotId => widgetPrivateBlueprintHasSlotHead(blueprintDocument, scope, element, slotId));
}

/**
 * Every blueprint this element owns the lifecycle of, both spellings.
 *
 * What an unmounting element has to release. The two arms can name the same id and can name
 * different ones, so the result is deduplicated and sorted: it becomes a dependency key, and a key
 * that moved because a map's iteration order did would re-run the release effect for nothing.
 */
export function listElementOwnedBlueprintIds(
    element: Pick<UIElement, "id" | "behavior">,
    scope: WidgetBlueprintOwnerScope,
    blueprintDocument: BlueprintDocument | null | undefined,
): string[] {
    const ids = new Set<string>();
    for (const binding of Object.values(element.behavior?.events ?? {})) {
        if (binding?.kind === "blueprintEvent") {
            ids.add(binding.blueprintId);
        }
    }
    const own = resolveWidgetPrivateBlueprintId(blueprintDocument, scope, element.id);
    if (own) {
        ids.add(own);
    }
    return [...ids].sort();
}
