import type { Blueprint } from "@shared/types/blueprint/document";
import type { UIBehaviorBinding } from "@shared/types/ui-editor/document";

/**
 * Deep-clone a widgetMain blueprint for paste/duplicate: new id, new owner element, remap binding targets
 * inside the pasted subtree and declaration sources that pointed at the old blueprint id.
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
            if (bind.source.kind === "declaration" && bind.source.blueprintId === input.oldBlueprintId) {
                bind.source = { ...bind.source, blueprintId: input.newBlueprintIdForSourceRemap };
            }
        }
    }

    return cloned;
}

/**
 * Remap `blueprintEvent` bindings on pasted elements when the referenced blueprint was duplicated.
 */
export function remapElementBehaviorBlueprintIds(
    events: Record<string, UIBehaviorBinding> | undefined,
    blueprintIdMap: Record<string, string>,
): Record<string, UIBehaviorBinding> | undefined {
    if (!events) {
        return undefined;
    }
    let changed = false;
    const next: Record<string, UIBehaviorBinding> = { ...events };
    for (const [key, ev] of Object.entries(next)) {
        if (ev.kind === "blueprintEvent") {
            const nb = blueprintIdMap[ev.blueprintId];
            if (nb) {
                next[key] = { ...ev, blueprintId: nb };
                changed = true;
            }
        }
    }
    return changed ? next : events;
}
