import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { useDocumentVersion } from "@/lib/ui-editor/hooks/useDocumentVersion";
import type { ReadonlyBlueprintSurfaceSummary } from "@/lib/workspace/services/ui-editor/blueprint/readonlyBlueprintSummary";
import { emptyReadonlyBlueprintSurfaceSummary } from "@/lib/workspace/services/ui-editor/blueprint/readonlyBlueprintSummary";

export function useReadonlySurfaceBlueprintSummary(
    documentService: UIDocumentService | null | undefined,
    surfaceId: string | undefined,
): ReadonlyBlueprintSurfaceSummary {
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
        if (!isInitialized || !context || !surfaceId) {
            return emptyReadonlyBlueprintSurfaceSummary();
        }
        const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        return localBp.getReadonlySurfaceMainSummary(surfaceId);
    }, [context, isInitialized, surfaceId, docVersion, graphTick]);
}
