import type { Blueprint } from "@shared/types/blueprint/document";
import type { UIElementValueBinding } from "@shared/types/ui-editor/document";
import {
    ELEMENT_REF_PARAM_ELEMENT_ID,
    ELEMENT_REF_PARAM_SURFACE_ID,
} from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";
import { isBlueprintElementRefNodeType } from "./elementRefSites";

/**
 * Deep-clone a widgetMain blueprint for paste/duplicate: new id, new owner element, remap binding targets
 * inside the pasted subtree and field sources that pointed at the old blueprint id.
 */
export function cloneWidgetMainBlueprintForPaste(input: {
    source: Blueprint;
    newBlueprintId: string;
    surfaceId: string;
    newOwnerElementId: string;
    /** Old element id -> new element id for nodes in the pasted subtree */
    elementIdMap: Record<string, string>;
    oldBlueprintId: string;
    newBlueprintIdForSourceRemap: string;
}): Blueprint {
    const cloned = JSON.parse(JSON.stringify(input.source)) as Blueprint;
    cloned.id = input.newBlueprintId;
    cloned.owner = { kind: "widgetMain", surfaceId: input.surfaceId, elementId: input.newOwnerElementId };

    if (cloned.bindings) {
        for (const bind of Object.values(cloned.bindings)) {
            if (bind.target.kind === "widgetProp") {
                const mapped = input.elementIdMap[bind.target.elementId];
                bind.target = {
                    ...bind.target,
                    surfaceId: input.surfaceId,
                    elementId: mapped ?? bind.target.elementId,
                };
            }
            if (bind.source.kind === "field" && bind.source.blueprintId === input.oldBlueprintId) {
                bind.source = { ...bind.source, blueprintId: input.newBlueprintIdForSourceRemap };
            }
        }
    }

    remapGraphElementRefs(cloned, input.surfaceId, input.elementIdMap);

    return cloned;
}

/**
 * Repoint the widgets a blueprint's graph names at the copies that were pasted alongside it.
 *
 * A widget is named in two unrelated places, and only one of them used to be remapped. `bindings`
 * carries the declarative ones and is handled above; the graph carries the rest, as
 * `{surfaceId, elementId, elementType}` params on the element literal and the two element event
 * heads. Left alone, a duplicated widget's logic keeps driving the ORIGINAL widget - the copy looks
 * right, does nothing of its own, and moves something else on the page instead.
 *
 * Only ids in `elementIdMap` are rewritten. A reference to a widget outside the copied subtree is
 * meant to point where it points; the surface is rewritten with it, because within one document a
 * copied subtree lands on the surface being pasted into.
 */
function remapGraphElementRefs(
    blueprint: Blueprint,
    surfaceId: string,
    elementIdMap: Record<string, string>,
): void {
    const { events, functions, macros } = blueprint.graphs;
    const graphs = [
        ...Object.values(events ?? {}),
        ...Object.values(functions ?? {}),
        ...Object.values(macros ?? {}),
    ];
    for (const graph of graphs) {
        for (const node of Object.values(graph.graph?.nodes ?? {})) {
            if (!node.params || !isBlueprintElementRefNodeType(node.type)) {
                continue;
            }
            const current = node.params[ELEMENT_REF_PARAM_ELEMENT_ID];
            if (typeof current !== "string") {
                continue;
            }
            const mapped = elementIdMap[current.trim()];
            if (!mapped) {
                continue;
            }
            node.params[ELEMENT_REF_PARAM_ELEMENT_ID] = mapped;
            node.params[ELEMENT_REF_PARAM_SURFACE_ID] = surfaceId;
        }
    }
}

export function cloneWidgetValueBlueprintForPaste(input: {
    source: Blueprint;
    newBlueprintId: string;
    surfaceId: string;
    newOwnerElementId: string;
    propPath: string;
}): Blueprint {
    const cloned = JSON.parse(JSON.stringify(input.source)) as Blueprint;
    cloned.id = input.newBlueprintId;
    cloned.owner = {
        kind: "widgetValue",
        surfaceId: input.surfaceId,
        elementId: input.newOwnerElementId,
        propPath: input.propPath,
    };
    return cloned;
}

export function remapElementValueBindingBlueprintIds(
    valueBindings: Record<string, UIElementValueBinding> | undefined,
    blueprintIdMap: Record<string, string>,
): Record<string, UIElementValueBinding> | undefined {
    if (!valueBindings) {
        return undefined;
    }
    let changed = false;
    const next: Record<string, UIElementValueBinding> = { ...valueBindings };
    for (const [propPath, binding] of Object.entries(next)) {
        // Only a blueprint binding names a blueprint. A field binding names a field of the shape the
        // pasted subtree brought with it, so it travels unchanged.
        if (binding.kind !== "blueprintValue") {
            continue;
        }
        const nb = blueprintIdMap[binding.blueprintId];
        if (nb) {
            next[propPath] = { ...binding, blueprintId: nb };
            changed = true;
        }
    }
    return changed ? next : valueBindings;
}
