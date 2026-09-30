import { hasScriptLayer } from "@shared/blueprint/blueprintLayers";
import { ownerLabelKey } from "@shared/types/ui-editor/ownerLabels";
import { useCallback, useMemo } from "react";
import { translate } from "@/lib/i18n";
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
    /** True when a script layer in this slot may answer the event from a file nothing here reads. */
    hasScriptLayer: boolean;
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
            const localBp = context?.services.get<LocalBlueprintService>(Services.LocalBlueprint);
            localBp?.ensureEventGraph(snapshot.blueprintId, uiEventName, defs.find(def => def.id === uiEventName)?.displayName);
            openBlueprint({
                blueprintId: snapshot.blueprintId,
                ownerKind: componentId ? "componentWidgetMain" : "widgetMain",
                surfaceId,
                componentId: componentId ?? undefined,
                elementId: element.id,
                focusEventId: uiEventName,
                // The same name the control's other ways into its logic give the tab.
                title: translate("properties.blueprintEntry.title", {
                    logic: translate(ownerLabelKey(componentId ? "componentWidgetMain" : "widgetMain")),
                    name: element.name ?? element.type,
                }),
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
            // A slot with a script layer in it may answer this event from the file, which nothing
            // here can read - so the row says "a script may handle this" rather than "nothing does".
            hasScriptLayer: hasScriptLayer(snapshot.blueprint),
            openEventGraph: () => openWiredEventGraphTab(def.id),
        }));
    }, [defs, openWiredEventGraphTab, snapshot.blueprint, snapshot.existingIds]);

    return { rows, hasEvents: defs.length > 0 };
}
