/**
 * Reading a widget's own blueprint: which slots it listens on, and whether it listens at all.
 *
 * A widget's handlers are not written on the element. Its private blueprint is found through
 * `blueprintDocument.ownerRecords`, keyed by `(surface, element)` - or by `(component, element)`
 * inside a component definition - and the slot a graph answers is decided by the *head node* in it,
 * rather than by the graph's name.
 *
 * That indirection is the whole reason this module exists. Handlers used to sit on the element as
 * `behavior.events[slot]`, and for four months after they stopped, two checks were still reading
 * that field and so answering "listens to nothing" for every widget in every project. Anything
 * asking what a widget listens to goes through here.
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
 * reports scenery that runs a graph on mount as though it were an unreachable button.
 */
export function elementListensForPlayerInput(
    element: UIElement,
    scope: WidgetBlueprintOwnerScope,
    blueprintDocument: BlueprintDocument | null | undefined,
): boolean {
    if (!getWidgetLogicApi(element.type)?.supportsPrivateBlueprint) {
        return false;
    }
    return interactionSlotIds(element.type)
        .some(slotId => widgetPrivateBlueprintHasSlotHead(blueprintDocument, scope, element, slotId));
}
