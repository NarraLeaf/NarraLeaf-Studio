import type { BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import type { BlueprintWidgetEventCapabilityRef } from "@/lib/ui-editor/blueprint-nodes/types";
import { listUiSlotsWiredToBlueprintLayer } from "@/lib/ui-editor/blueprint-runtime/widgetBlueprintLayerSlots";
import type { UIElement } from "@shared/types/ui-editor/document";

export function resolveWidgetEventLayerSlotsForPalette(input: {
    ownerKind: string;
    widgetElement?: UIElement;
    graphView: BlueprintEditorGraphView | null;
    blueprintId: string;
    widgetBlueprintEvents?: readonly BlueprintWidgetEventCapabilityRef[];
}): string[] | undefined {
    if (input.ownerKind !== "widgetMain" || !input.widgetElement || input.graphView?.kind !== "event") {
        return undefined;
    }

    const wired = listUiSlotsWiredToBlueprintLayer(
        input.widgetElement,
        input.blueprintId,
        input.graphView.graphId,
    );
    if (wired.length > 0) {
        return wired;
    }

    if (input.widgetBlueprintEvents?.some(eventDef => eventDef.id === input.graphView?.graphId)) {
        return [input.graphView.graphId];
    }

    return [];
}
