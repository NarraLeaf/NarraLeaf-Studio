import type { BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import type { BlueprintWidgetEventCapabilityRef } from "@/lib/ui-editor/blueprint-nodes/types";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { BlueprintOwnerRef } from "@shared/types/blueprint/document";
import { isWidgetEventGraph } from "@shared/blueprint/ownerShape";

export function resolveWidgetEventLayerSlotsForPalette(input: {
    owner: BlueprintOwnerRef;
    widgetElement?: UIElement;
    graphView: BlueprintEditorGraphView | null;
    widgetBlueprintEvents?: readonly BlueprintWidgetEventCapabilityRef[];
}): string[] | undefined {
    if (
        !isWidgetEventGraph(input.owner) ||
        !input.widgetElement ||
        input.graphView?.kind !== "event"
    ) {
        return undefined;
    }

    if (input.widgetBlueprintEvents?.some(eventDef => eventDef.id === input.graphView?.graphId)) {
        return [input.graphView.graphId];
    }

    return [];
}
