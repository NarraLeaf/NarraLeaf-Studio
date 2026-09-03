import type { Blueprint, BlueprintDocument } from "@shared/types/blueprint/document";
import { hasScriptLayer } from "@shared/blueprint/blueprintLayers";
import { encodeBlueprintOwnerKey } from "@shared/blueprint/ownerKey";
import { collectBlueprintEventHeadNodeIdsForDispatch } from "@shared/types/blueprint/graph";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { getWidgetLogicApi, getWidgetLogicEvent } from "@shared/types/ui-editor/widgetLogic";

function widgetMainOwnerKey(surfaceId: string, elementId: string): string {
    return encodeBlueprintOwnerKey({ kind: "widgetMain", surfaceId, elementId });
}

function hasValueBindings(element: UIElement): boolean {
    return Object.keys(element.valueBindings ?? {}).length > 0;
}

function blueprintHasFlushHead(blueprint: Blueprint | undefined, elementType: string): boolean {
    if (!blueprint) {
        return false;
    }
    // A script layer is credited without being read: its handlers are functions rather than head
    // nodes, so there is nothing here to scan, and missing a flush target is the worse mistake.
    if (hasScriptLayer(blueprint)) {
        return true;
    }
    return Object.values(blueprint.graphs.events ?? {}).some(layer =>
        collectBlueprintEventHeadNodeIdsForDispatch(
            layer.graph?.nodes,
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
    const blueprintId = blueprintDocument.ownerRecords[ownerKey]?.blueprintId;
    return blueprintHasFlushHead(
        blueprintId ? blueprintDocument.blueprints[blueprintId] : undefined,
        element.type,
    );
}

export function collectSurfaceFlushElementIds(input: {
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
        if (hasValueBindings(element) || hasWidgetFlushBlueprint(blueprintDocument, surface.id, element)) {
            out.add(elementId);
        }
        for (const childId of element.childrenIds ?? []) {
            visit(childId);
        }
    };
    visit(surface.rootElementId);
    return [...out];
}
