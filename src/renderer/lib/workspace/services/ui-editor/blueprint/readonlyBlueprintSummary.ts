import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIElement } from "@shared/types/ui-editor/document";
import { listWidgetLogicEventIds } from "@shared/types/ui-editor/widgetLogic";
import { getActiveBlueprintId } from "./ownerRecords";
import { componentWidgetMainOwnerKey, surfaceMainOwnerKey, widgetMainOwnerKey } from "./ownerKeys";
import { validateBlueprintWidgetMainEventWiring } from "./graphValidation";

/** Read-only inspector summary for a widget instance main blueprint (Blueprint M2). */
export type ReadonlyBlueprintWidgetSummary = {
    hasWidgetMain: boolean;
    blueprintId?: string;
    fieldCount: number;
    bindingCount: number;
    brokenBindingCount: number;
    eventGraphCount: number;
    supportedEventCount: number;
    legacyHookCount: number;
    /** Errors/warnings from cross-checking the widget schema against stored event members. */
    eventSchemaIssueCount: number;
};

export function emptyReadonlyBlueprintWidgetSummary(): ReadonlyBlueprintWidgetSummary {
    return {
        hasWidgetMain: false,
        fieldCount: 0,
        bindingCount: 0,
        brokenBindingCount: 0,
        eventGraphCount: 0,
        supportedEventCount: 0,
        legacyHookCount: 0,
        eventSchemaIssueCount: 0,
    };
}

/** Read-only inspector summary for surfaceMain blueprint (M4-lite entry). */
export type ReadonlyBlueprintSurfaceSummary = {
    hasSurfaceMain: boolean;
    blueprintId?: string;
    fieldCount: number;
    bindingCount: number;
    brokenBindingCount: number;
    eventGraphCount: number;
};

export function emptyReadonlyBlueprintSurfaceSummary(): ReadonlyBlueprintSurfaceSummary {
    return {
        hasSurfaceMain: false,
        fieldCount: 0,
        bindingCount: 0,
        brokenBindingCount: 0,
        eventGraphCount: 0,
    };
}

export function buildReadonlySurfaceMainSummary(
    doc: BlueprintDocument,
    surfaceId: string,
): ReadonlyBlueprintSurfaceSummary {
    const key = surfaceMainOwnerKey(surfaceId);
    const blueprintId = getActiveBlueprintId(doc, key);
    const bp = blueprintId ? doc.blueprints[blueprintId] : undefined;
    if (!bp) {
        return emptyReadonlyBlueprintSurfaceSummary();
    }

    const fieldMap = bp.members?.fields ?? {};
    const fieldCount = Object.keys(fieldMap).length;

    const bindings = bp.bindings ?? {};
    const bindingList = Object.values(bindings);
    const bindingCount = bindingList.length;
    const brokenBindingCount = bindingList.filter(b => b.status === "broken").length;

    let eventGraphCount = 0;
    if (bp.program.kind === "graph") {
        eventGraphCount = Object.keys(bp.program.graphs.events ?? {}).length;
    }

    return {
        hasSurfaceMain: true,
        blueprintId,
        fieldCount,
        bindingCount,
        brokenBindingCount,
        eventGraphCount,
    };
}

function countLegacyUiBlueprintEvents(element: UIElement): number {
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
    options: { componentId?: string } = {},
): ReadonlyBlueprintWidgetSummary {
    const key = options.componentId
        ? componentWidgetMainOwnerKey(options.componentId, element.id)
        : widgetMainOwnerKey(surfaceId, element.id);
    const blueprintId = getActiveBlueprintId(doc, key);
    const bp = blueprintId ? doc.blueprints[blueprintId] : undefined;
    const supportedEventCount = listWidgetLogicEventIds(element.type).length;
    if (!bp || !blueprintId) {
        return {
            ...emptyReadonlyBlueprintWidgetSummary(),
            supportedEventCount,
            legacyHookCount: countLegacyUiBlueprintEvents(element),
            eventSchemaIssueCount: 0,
        };
    }

    const fieldMap = bp.members?.fields ?? {};
    const fieldCount = Object.keys(fieldMap).length;

    const bindings = bp.bindings ?? {};
    const bindingList = Object.values(bindings);
    const bindingCount = bindingList.length;
    const brokenBindingCount = bindingList.filter(b => b.status === "broken").length;

    let eventGraphCount = 0;
    if (bp.program.kind === "graph") {
        eventGraphCount = Object.keys(bp.program.graphs.events ?? {}).length;
    }

    const eventWiringDiags = options.componentId
        ? []
        : validateBlueprintWidgetMainEventWiring(doc, blueprintId, {
              element,
              surfaceId,
          });
    const eventSchemaIssueCount = eventWiringDiags.filter(d => d.severity !== "info").length;

    return {
        hasWidgetMain: true,
        blueprintId,
        fieldCount,
        bindingCount,
        brokenBindingCount,
        eventGraphCount,
        supportedEventCount,
        legacyHookCount: countLegacyUiBlueprintEvents(element),
        eventSchemaIssueCount,
    };
}
