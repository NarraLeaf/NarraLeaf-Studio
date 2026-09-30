/**
 * The one place a blueprint graph's context is derived.
 *
 * `isBlueprintNodeAllowedInGraphContext` answers "may this node be here" for two callers that must
 * never disagree: the add-node palette, which decides what an author is offered, and the graph
 * validator, which decides what an existing graph may hold. Both used to assemble the context they
 * hand it separately, and every flag one of them worked out for itself was a chance to work it out
 * differently - which is a node the palette offers, the author places, and the validator then marks
 * an error for good. Such a graph cannot be fixed from the canvas and `blueprint apply` refuses to
 * write it, so the command-line tools are locked out of a blueprint the editor made.
 *
 * So everything that follows from the blueprint's owner and from where its element sits is derived
 * here, once. Callers pass only what is genuinely theirs to know: what the canvas is holding right
 * now, and which document, if any, they can walk.
 *
 * Comments in English per project convention.
 */

import {
    isBlueprintValueGraphOwner,
    isBlueprintWidgetOwner,
    isStorySyncValueOwner,
    type BlueprintOwnerRef,
} from "@shared/types/blueprint/document";
import type { BlueprintGraphKind } from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { isListItemScopeReachable } from "@shared/types/ui-editor/listItemContext";
import type {
    BlueprintMagicElementRefPaletteEntry,
    BlueprintPaletteContext,
    BlueprintWidgetEventCapabilityRef,
} from "./types";

export type BlueprintGraphContextInput = {
    graphKind: BlueprintGraphKind;
    owner: BlueprintOwnerRef;
    /** Element type (e.g. `nl.button`) of a widget owner's element; what node scopes are written against. */
    widgetElementType?: string;
    /** The element record itself, when the caller has it. Only the scopes below need more than its type. */
    widgetElement?: UIElement | null;
    /**
     * The interface document the widget element lives in.
     *
     * Some scopes are a fact about where an element sits rather than about what it is - the list row
     * is the one there is - and answering those means walking the element's ancestors. A caller that
     * can walk gets the exact answer; one that cannot has established nothing, and "not established"
     * must not read as "no": offering a node that will not fire is a small thing beside refusing a
     * graph that works.
     */
    uiDocument?: Pick<UIDocument, "elements"> | null;
    widgetBlueprintEvents?: readonly BlueprintWidgetEventCapabilityRef[];
    widgetEventLayerSlots?: string[];
    hasEventHead?: boolean;
    hasFunctionEntry?: boolean;
    magicElementRefs?: readonly BlueprintMagicElementRefPaletteEntry[];
    isComponentDefinitionGraph?: boolean;
};

/**
 * Whether a node that reads a list row may appear in this graph.
 *
 * Only a walked document can say no. A component definition never can: its elements live in the
 * definition's own table rather than on a surface, and any one instance of it may be the row.
 */
function resolveListItemContextAvailable(input: BlueprintGraphContextInput): boolean {
    if (!isBlueprintWidgetOwner(input.owner)) {
        // A global, surface, shared-asset or story graph is not drawn per row by anything.
        return false;
    }
    if (input.isComponentDefinitionGraph || !input.uiDocument || !input.widgetElement) {
        return true;
    }
    return isListItemScopeReachable(input.uiDocument, input.widgetElement);
}

export function buildBlueprintGraphContext(input: BlueprintGraphContextInput): BlueprintPaletteContext {
    return {
        graphKind: input.graphKind,
        owner: input.owner,
        widgetElementType: input.widgetElementType ?? input.widgetElement?.type,
        widgetBlueprintEvents: input.widgetBlueprintEvents,
        widgetEventLayerSlots: input.widgetEventLayerSlots,
        hasEventHead: input.hasEventHead,
        hasFunctionEntry: input.hasFunctionEntry,
        magicElementRefs: input.magicElementRefs,
        isComponentDefinitionGraph: input.isComponentDefinitionGraph,
        isBlueprintValueGraph: isBlueprintValueGraphOwner(input.owner),
        isSyncOnlyGraph: isStorySyncValueOwner(input.owner),
        listItemContextAvailable: resolveListItemContextAvailable(input),
    };
}
