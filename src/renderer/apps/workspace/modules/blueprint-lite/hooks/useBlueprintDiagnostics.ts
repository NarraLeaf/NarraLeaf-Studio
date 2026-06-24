import { useMemo } from "react";
import {
    validateBlueprintDocumentGraphs,
    type ValidateBlueprintDocumentGraphsOptions,
} from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import type { BlueprintDocument } from "@shared/types/blueprint/document";

export function useBlueprintDiagnostics(
    doc: BlueprintDocument,
    blueprintId: string,
    revision: number,
    options?: ValidateBlueprintDocumentGraphsOptions,
) {
    return useMemo(
        () => validateBlueprintDocumentGraphs(doc, blueprintId, options),
        [
            doc,
            blueprintId,
            revision,
            options?.widgetElement,
            options?.widgetSurfaceId,
            options?.widgetBlueprintEvents,
            options?.isComponentDefinitionGraph,
        ],
    );
}
