import { useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import {
    validateBlueprintDocumentGraphs,
    type ValidateBlueprintDocumentGraphsOptions,
} from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import type { BlueprintDocument } from "@shared/types/blueprint/document";

/**
 * The editor's findings for one blueprint, worked out again whenever anything they read changes.
 *
 * The validator words each finding as it finds it, in the interface language of that moment, and
 * the cards' tips and the list under the canvas show that sentence as it is. So the language is one
 * of the things the findings depend on: switching it re-runs the validation, and every sentence on
 * screen follows at once rather than at the next edit of the graph.
 */
export function useBlueprintDiagnostics(
    doc: BlueprintDocument,
    blueprintId: string,
    revision: number,
    options?: ValidateBlueprintDocumentGraphsOptions,
) {
    const { t } = useTranslation();
    return useMemo(
        () => validateBlueprintDocumentGraphs(doc, blueprintId, options),
        // `t` is a new function whenever the interface language or its catalogue changes.
        [
            doc,
            blueprintId,
            revision,
            t,
            options?.widgetElement,
            options?.uiDocument,
            options?.widgetSurfaceId,
            options?.widgetBlueprintEvents,
            options?.isComponentDefinitionGraph,
            options?.assetNameGaps,
        ],
    );
}
