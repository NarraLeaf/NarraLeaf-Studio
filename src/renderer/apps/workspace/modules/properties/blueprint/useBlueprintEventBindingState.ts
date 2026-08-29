import { useCallback, useMemo } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import type { Blueprint } from "@shared/types/blueprint/document";
import { parseComponentEditorSurfaceId } from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";

export type BlueprintEventBindingRow = {
    eventId: string;
    displayName: string;
    description?: string;
    hasPrivateEventMember: boolean;
    isScriptRevision: boolean;
    openEventGraph: () => void;
};

export function useBlueprintEventBindingState(data: UIInspectorData): {
    rows: BlueprintEventBindingRow[];
    hasEvents: boolean;
} {
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
    const graphRev = useBlueprintDocumentRevision();

    const surfaceId = data.surfaceId;
    const element = data.element;
    const componentId = parseComponentEditorSurfaceId(surfaceId);

    const snapshot = useMemo(() => {
        if (!isInitialized || !context || !surfaceId) {
            return {
                blueprintId: undefined as string | undefined,
                blueprint: undefined as Blueprint | undefined,
                existingIds: [] as string[],
            };
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const blueprintId = componentId
            ? localBp.getComponentWidgetMainBlueprintId(componentId, element.id)
            : localBp.getWidgetMainBlueprintId(surfaceId, element.id);
        const blueprint = blueprintId ? localBp.getBlueprintDocument().blueprints[blueprintId] : undefined;
        const existingIds = blueprintId ? localBp.listEventGraphIds(blueprintId) : [];
        return { blueprintId, blueprint, existingIds };
    }, [componentId, context, element.id, graphRev, isInitialized, surfaceId]);

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
                ownerKind: componentId ? "componentWidgetMain" : "widgetMain",
                surfaceId,
                componentId: componentId ?? undefined,
                elementId: element.id,
                focusEventId: snapshot.blueprint?.program.kind === "graph" ? uiEventName : undefined,
                title: `Blueprint · ${element.name ?? element.type}`,
            }, {
                // Wiring an event makes the graph if it is not there yet, so this click is the
                // author settling in rather than looking around: it earns a tab of its own.
                preview: false,
            });
        },
        [
            componentId,
            context,
            defs,
            element.id,
            element.name,
            element.type,
            openBlueprint,
            snapshot.blueprint,
            snapshot.blueprintId,
            surfaceId,
        ],
    );

    const rows: BlueprintEventBindingRow[] = useMemo(() => {
        return defs.map(def => ({
            eventId: def.id,
            displayName: def.displayName,
            description: def.description,
            hasPrivateEventMember: snapshot.existingIds.includes(def.id),
            isScriptRevision: snapshot.blueprint?.program.kind === "scriptModule",
            openEventGraph: () => openWiredEventGraphTab(def.id),
        }));
    }, [defs, openWiredEventGraphTab, snapshot.blueprint?.program.kind, snapshot.existingIds]);

    return { rows, hasEvents: defs.length > 0 };
}
