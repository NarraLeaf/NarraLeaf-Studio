import { useCallback, useMemo } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useDocumentVersion } from "@/lib/ui-editor/hooks/useDocumentVersion";
import type { UIElement } from "@shared/types/ui-editor/document";

/**
 * Read current blueprintEvent wiring for a widget UI event slot.
 */
export function getWiredBlueprintEventRef(
    element: UIElement | undefined,
    eventName: string,
    expectedWidgetBlueprintId: string | undefined,
): { blueprintId: string; eventId: string } | null {
    if (!element) {
        return null;
    }
    const b = element.behavior?.events?.[eventName];
    if (!b || b.kind !== "blueprintEvent") {
        return null;
    }
    if (expectedWidgetBlueprintId && b.blueprintId !== expectedWidgetBlueprintId) {
        return null;
    }
    return { blueprintId: b.blueprintId, eventId: b.eventId };
}

export type BlueprintEventBindingRow = {
    eventId: string;
    displayName: string;
    description?: string;
    /** Persisted event graph id when wired to this widget main blueprint */
    wiredGraphEventId: string | null;
    canWire: boolean;
    existingEventGraphIds: string[];
    wireToExisting: (eventGraphId: string) => void;
    wireToNewGraph: () => void;
    clearWiring: () => void;
    openEventGraph: () => void;
};

export function useBlueprintEventBindingState(data: UIInspectorData): {
    rows: BlueprintEventBindingRow[];
    hasEvents: boolean;
} {
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
    const graphRev = useBlueprintDocumentRevision();
    const documentService =
        isInitialized && context ? context.services.get<UIDocumentService>(Services.UIDocument) : null;
    const docVersion = useDocumentVersion(documentService);

    const surfaceId = data.surfaceId;
    const element = data.element;

    const snapshot = useMemo(() => {
        if (!isInitialized || !context || !surfaceId || !documentService) {
            return {
                blueprintId: undefined as string | undefined,
                element: undefined as UIElement | undefined,
                existingIds: [] as string[],
            };
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const blueprintId = localBp.getWidgetMainBlueprintId(surfaceId, element.id);
        const docEl = documentService.getDocument().elements[element.id];
        const existingIds = blueprintId ? localBp.listEventGraphIds(blueprintId) : [];
        return { blueprintId, element: docEl, existingIds };
    }, [context, documentService, element.id, graphRev, isInitialized, surfaceId, docVersion]);

    const mod = widgetModuleRegistry.get(element.type);
    const defs = mod?.blueprintEvents ?? [];

    const wireToExisting = useCallback(
        (uiEventName: string, eventGraphId: string) => {
            if (!isInitialized || !context || !surfaceId || !snapshot.blueprintId) {
                return;
            }
            const uidoc = context.services.get<UIDocumentService>(Services.UIDocument);
            uidoc.setElementBlueprintEvent(element.id, uiEventName, {
                blueprintId: snapshot.blueprintId,
                eventId: eventGraphId,
            });
        },
        [context, element.id, isInitialized, snapshot.blueprintId, surfaceId],
    );

    const wireToNewGraph = useCallback(
        (uiEventName: string) => {
            if (!isInitialized || !context || !surfaceId || !snapshot.blueprintId) {
                return;
            }
            const uuid = context.services.get<UuidService>(Services.Uuid);
            const eventGraphId = uuid.generate();
            const uidoc = context.services.get<UIDocumentService>(Services.UIDocument);
            uidoc.setElementBlueprintEvent(element.id, uiEventName, {
                blueprintId: snapshot.blueprintId,
                eventId: eventGraphId,
            });
        },
        [context, element.id, isInitialized, snapshot.blueprintId, surfaceId],
    );

    const clearWiring = useCallback(
        (uiEventName: string) => {
            if (!isInitialized || !context) {
                return;
            }
            const uidoc = context.services.get<UIDocumentService>(Services.UIDocument);
            uidoc.clearElementBlueprintEvent(element.id, uiEventName);
        },
        [context, element.id, isInitialized],
    );

    const openWiredEventGraphTab = useCallback(
        (uiEventName: string) => {
            const ref = getWiredBlueprintEventRef(snapshot.element, uiEventName, snapshot.blueprintId);
            if (!surfaceId || !ref) {
                return;
            }
            openBlueprint({
                blueprintId: ref.blueprintId,
                ownerKind: "widgetMain",
                surfaceId,
                elementId: element.id,
                focusEventId: ref.eventId,
                title: `Blueprint · ${element.name ?? element.type}`,
            });
        },
        [element.id, element.name, element.type, openBlueprint, snapshot.blueprintId, snapshot.element, surfaceId],
    );

    const rows: BlueprintEventBindingRow[] = useMemo(() => {
        return defs.map(def => ({
            eventId: def.id,
            displayName: def.displayName,
            description: def.description,
            wiredGraphEventId: getWiredBlueprintEventRef(snapshot.element, def.id, snapshot.blueprintId)?.eventId ?? null,
            canWire: Boolean(surfaceId && snapshot.blueprintId),
            existingEventGraphIds: snapshot.existingIds,
            wireToExisting: (eventGraphId: string) => wireToExisting(def.id, eventGraphId),
            wireToNewGraph: () => wireToNewGraph(def.id),
            clearWiring: () => clearWiring(def.id),
            openEventGraph: () => openWiredEventGraphTab(def.id),
        }));
    }, [
        clearWiring,
        defs,
        openWiredEventGraphTab,
        snapshot.blueprintId,
        snapshot.element,
        snapshot.existingIds,
        surfaceId,
        wireToExisting,
        wireToNewGraph,
    ]);

    return { rows, hasEvents: defs.length > 0 };
}
