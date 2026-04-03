import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import { widgetMainOwnerKey } from "./ownerKeys";

/** Read-only inspector summary for a widget instance main blueprint (Blueprint M2). */
export type ReadonlyBlueprintWidgetSummary = {
    hasWidgetMain: boolean;
    blueprintId?: string;
    declarationCount: number;
    bindingCount: number;
    brokenBindingCount: number;
    eventGraphCount: number;
    uiBlueprintEventCount: number;
};

export function emptyReadonlyBlueprintWidgetSummary(): ReadonlyBlueprintWidgetSummary {
    return {
        hasWidgetMain: false,
        declarationCount: 0,
        bindingCount: 0,
        brokenBindingCount: 0,
        eventGraphCount: 0,
        uiBlueprintEventCount: 0,
    };
}

function countUiBlueprintEvents(element: UIElement): number {
    const events = element.behavior?.events;
    if (!events) {
        return 0;
    }
    return Object.values(events).filter(b => b.kind === "blueprintEvent").length;
}

/**
 * Build summary for the widgetMain tied to (surfaceId, element) using current BlueprintDocument.
 */
export function buildReadonlyWidgetMainSummary(
    doc: BlueprintDocument,
    surfaceId: string,
    element: UIElement,
): ReadonlyBlueprintWidgetSummary {
    const key = widgetMainOwnerKey(surfaceId, element.id);
    const blueprintId = doc.ownerIndex[key];
    const bp = blueprintId ? doc.blueprints[blueprintId] : undefined;
    if (!bp) {
        return {
            ...emptyReadonlyBlueprintWidgetSummary(),
            uiBlueprintEventCount: countUiBlueprintEvents(element),
        };
    }

    const declarations = bp.members?.declarations ?? {};
    const declarationCount = Object.keys(declarations).length;

    const bindings = bp.bindings ?? {};
    const bindingList = Object.values(bindings);
    const bindingCount = bindingList.length;
    const brokenBindingCount = bindingList.filter(b => b.status === "broken").length;

    let eventGraphCount = 0;
    if (bp.program.kind === "graph") {
        eventGraphCount = Object.keys(bp.program.graphs.events ?? {}).length;
    }

    return {
        hasWidgetMain: true,
        blueprintId,
        declarationCount,
        bindingCount,
        brokenBindingCount,
        eventGraphCount,
        uiBlueprintEventCount: countUiBlueprintEvents(element),
    };
}
