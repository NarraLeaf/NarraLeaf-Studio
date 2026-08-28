import type { BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import type { BlueprintWidgetEventCapabilityRef } from "@/lib/ui-editor/blueprint-nodes/types";
import type { UIElement } from "@shared/types/ui-editor/document";

export function resolveWidgetEventLayerSlotsForPalette(input: {
    ownerKind: string;
    widgetElement?: UIElement;
    graphView: BlueprintEditorGraphView | null;
    widgetBlueprintEvents?: readonly BlueprintWidgetEventCapabilityRef[];
}): string[] | undefined {
    if (
        (input.ownerKind !== "widgetMain" && input.ownerKind !== "componentWidgetMain") ||
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
