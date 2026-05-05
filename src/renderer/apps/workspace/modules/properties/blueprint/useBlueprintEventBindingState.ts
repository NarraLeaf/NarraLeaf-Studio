import { useCallback, useMemo } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useDocumentVersion } from "@/lib/ui-editor/hooks/useDocumentVersion";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { Blueprint } from "@shared/types/blueprint/document";

/**
 * Read current legacy blueprintEvent wiring for a widget UI event slot.
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
    hasPrivateEventMember: boolean;
    isScriptRevision: boolean;
    legacyGraphEventId: string | null;
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
                blueprint: undefined as Blueprint | undefined,
                existingIds: [] as string[],
            };
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const blueprintId = localBp.getWidgetMainBlueprintId(surfaceId, element.id);
        const docEl = documentService.getDocument().elements[element.id];
        const blueprint = blueprintId ? localBp.getBlueprintDocument().blueprints[blueprintId] : undefined;
        const existingIds = blueprintId ? localBp.listEventGraphIds(blueprintId) : [];
        return { blueprintId, element: docEl, blueprint, existingIds };
    }, [context, documentService, element.id, graphRev, isInitialized, surfaceId, docVersion]);

    const mod = widgetModuleRegistry.get(element.type);
    const defs = mod?.logicApi?.events ?? [];

    const openWiredEventGraphTab = useCallback(
        (uiEventName: string) => {
            if (!surfaceId || !snapshot.blueprintId) {
                return;
            }
            if (snapshot.blueprint?.program.kind === "graph") {
                const localBp = context?.services.get<LocalBlueprintService>(Services.LocalBlueprint);
                localBp?.ensureEventGraph(snapshot.blueprintId, uiEventName, defs.find(def => def.id === uiEventName)?.displayName);
            }
            openBlueprint({
                blueprintId: snapshot.blueprintId,
                ownerKind: "widgetMain",
                surfaceId,
                elementId: element.id,
                focusEventId: snapshot.blueprint?.program.kind === "graph" ? uiEventName : undefined,
                title: `Blueprint · ${element.name ?? element.type}`,
            });
        },
        [context, defs, element.id, element.name, element.type, openBlueprint, snapshot.blueprint, snapshot.blueprintId, surfaceId],
    );

    const rows: BlueprintEventBindingRow[] = useMemo(() => {
        return defs.map(def => ({
            eventId: def.id,
            displayName: def.displayName,
            description: def.description,
            hasPrivateEventMember: snapshot.existingIds.includes(def.id),
            isScriptRevision: snapshot.blueprint?.program.kind === "scriptModule",
            legacyGraphEventId: getWiredBlueprintEventRef(snapshot.element, def.id, snapshot.blueprintId)?.eventId ?? null,
            openEventGraph: () => openWiredEventGraphTab(def.id),
        }));
    }, [defs, openWiredEventGraphTab, snapshot.blueprint?.program.kind, snapshot.blueprintId, snapshot.element, snapshot.existingIds]);

    return { rows, hasEvents: defs.length > 0 };
}
