import { useEffect, useMemo, useState } from "react";
import type { UIElement } from "@shared/types/ui-editor/document";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { useDocumentVersion } from "@/lib/ui-editor/hooks/useDocumentVersion";
import type { ReadonlyBlueprintWidgetSummary } from "@/lib/workspace/services/ui-editor/blueprint/readonlyBlueprintSummary";
import { emptyReadonlyBlueprintWidgetSummary } from "@/lib/workspace/services/ui-editor/blueprint/readonlyBlueprintSummary";
import { parseComponentEditorSurfaceId } from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";

/**
 * Subscribes to uidoc + uigraphs changes and returns a Blueprint M2 read-only summary for the selected widget.
 */
export function useReadonlyBlueprintSummary(
    documentService: UIDocumentService | null | undefined,
    surfaceId: string | undefined,
    element: UIElement | undefined,
): ReadonlyBlueprintWidgetSummary {
    const { context, isInitialized } = useWorkspace();
    const resolvedDocumentService =
        documentService ??
        (isInitialized && context ? context.services.get<UIDocumentService>(Services.UIDocument) : null);
    const docVersion = useDocumentVersion(resolvedDocumentService);
    const [graphTick, setGraphTick] = useState(0);

    useEffect(() => {
        if (!isInitialized || !context) {
            return;
        }
        const graph = context.services.get<UIGraphService>(Services.UIGraph);
        return graph.onGraphsChanged(() => {
            setGraphTick(t => t + 1);
        });
    }, [context, isInitialized]);

    return useMemo(() => {
        if (!isInitialized || !context || !surfaceId || !element) {
            return emptyReadonlyBlueprintWidgetSummary();
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const componentId = parseComponentEditorSurfaceId(surfaceId);
        if (componentId) {
            return localBp.getReadonlyComponentWidgetMainSummary(componentId, element);
        }
        return localBp.getReadonlyWidgetMainSummary(surfaceId, element);
    }, [context, isInitialized, surfaceId, element, docVersion, graphTick]);
}
