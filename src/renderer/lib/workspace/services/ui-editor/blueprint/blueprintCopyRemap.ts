/**
 * Pure helpers for a future duplicate/paste workflow (P1: rules + hooks only, no clipboard UI).
 * When copying a subtree, element ids and widgetMain blueprint ids must be regenerated and
 * bindings / blueprintEvent refs remapped consistently.
 */

export type SubtreeDuplicateRemapPlan = {
    /** Old element id in copied subtree → new element id */
    elementIdMap: Record<string, string>;
    /** Old widgetMain blueprint id → new blueprint id to allocate for the duplicate */
    widgetMainBlueprintIdMap: Record<string, string>;
    /** Old widgetValue blueprint id to new blueprint id to allocate for the duplicate. */
    widgetValueBlueprintIdMap: Record<string, string>;
};

export function planSubtreeDuplicateBlueprintRemap(input: {
    oldElementIds: string[];
    getWidgetMainBlueprintId: (elementId: string) => string | undefined;
    getWidgetValueBlueprintIds?: (elementId: string) => string[];
    generateId: () => string;
}): SubtreeDuplicateRemapPlan {
    const elementIdMap: Record<string, string> = {};
    for (const id of input.oldElementIds) {
        elementIdMap[id] = input.generateId();
    }

    const widgetMainBlueprintIdMap: Record<string, string> = {};
    for (const elId of input.oldElementIds) {
        const oldBp = input.getWidgetMainBlueprintId(elId);
        if (oldBp && !widgetMainBlueprintIdMap[oldBp]) {
            widgetMainBlueprintIdMap[oldBp] = input.generateId();
        }
    }

    const widgetValueBlueprintIdMap: Record<string, string> = {};
    for (const elId of input.oldElementIds) {
        for (const oldBp of input.getWidgetValueBlueprintIds?.(elId) ?? []) {
            if (oldBp && !widgetValueBlueprintIdMap[oldBp]) {
                widgetValueBlueprintIdMap[oldBp] = input.generateId();
            }
        }
    }

    return { elementIdMap, widgetMainBlueprintIdMap, widgetValueBlueprintIdMap };
}
