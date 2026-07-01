import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { collectBlueprintEventHeadNodeIdsForDispatch } from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { getWidgetLogicApi, getWidgetLogicEvent } from "@shared/types/ui-editor/widgetLogic";
import { widgetMainOwnerKey } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";

function hasValueBindings(element: UIElement): boolean {
    return Object.keys(element.valueBindings ?? {}).length > 0;
}

function hasLegacyFlushBinding(element: UIElement): boolean {
    return element.behavior?.events?.flush?.kind === "blueprintEvent";
}

function blueprintHasFlushHead(blueprint: Blueprint | undefined, elementType: string): boolean {
    if (!blueprint) {
        return false;
    }
    if (blueprint.program.kind === "scriptModule") {
        return true;
    }
    if (blueprint.program.kind !== "graph") {
        return false;
    }
    return Object.values(blueprint.program.graphs.events ?? {}).some(eventGraph =>
        collectBlueprintEventHeadNodeIdsForDispatch(
            eventGraph.graph?.nodes,
            "flush",
            elementType,
        ).length > 0
    );
}

function hasWidgetFlushBlueprint(
    blueprintDocument: BlueprintDocument,
    surfaceId: string,
    element: UIElement,
): boolean {
    if (!getWidgetLogicEvent(element.type, "flush")) {
        return false;
    }
    const widgetLogicApi = getWidgetLogicApi(element.type);
    if (!widgetLogicApi?.supportsPrivateBlueprint) {
        return false;
    }
    const ownerKey = widgetMainOwnerKey(surfaceId, element.id);
    const blueprintId = blueprintDocument.ownerRecords[ownerKey]?.activeBlueprintId;
    return blueprintHasFlushHead(
        blueprintId ? blueprintDocument.blueprints[blueprintId] : undefined,
        element.type,
    );
}

export function collectDialogFlushElementIds(input: {
    document: UIDocument;
    blueprintDocument: BlueprintDocument;
    surface: UISurface;
}): string[] {
    const { document, blueprintDocument, surface } = input;
    const out = new Set<string>();
    const visit = (elementId: string) => {
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        if (
            hasValueBindings(element) ||
            hasLegacyFlushBinding(element) ||
            hasWidgetFlushBlueprint(blueprintDocument, surface.id, element)
        ) {
            out.add(elementId);
        }
        for (const childId of element.childrenIds ?? []) {
            visit(childId);
        }
    };
    visit(surface.rootElementId);
    return [...out];
}
