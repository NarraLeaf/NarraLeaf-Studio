import { useMemo } from "react";
import { validateBlueprintDocumentGraphs } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import type { BlueprintDocument } from "@shared/types/blueprint/document";

export function useBlueprintDiagnostics(doc: BlueprintDocument, blueprintId: string, revision: number) {
    return useMemo(
        () => validateBlueprintDocumentGraphs(doc, blueprintId),
        [doc, blueprintId, revision],
    );
}
