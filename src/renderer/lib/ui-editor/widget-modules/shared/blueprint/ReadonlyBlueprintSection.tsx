import { useMemo } from "react";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { getOwnerLabel } from "@shared/types/ui-editor/ownerLabels";
import { BlueprintLayerPreview, resolveFirstBlueprintLayerPreview } from "./BlueprintLayerPreview";
import { useReadonlyBlueprintSummary } from "./useReadonlyBlueprintSummary";
import { parseComponentEditorSurfaceId } from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";
import { useTranslation } from "@/lib/i18n";

const widgetOwnerLabel = getOwnerLabel("widgetMain");

/**
 * Shared properties-panel block: single widget blueprint preview + entry to the Blueprint editor.
 */
export function ReadonlyBlueprintSection({ data }: CustomFieldProps<UIInspectorData>) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const surfaceId = data.surfaceId;
    const componentId = parseComponentEditorSurfaceId(surfaceId);
    const element = data.element;
    const summary = useReadonlyBlueprintSummary(null, surfaceId, element);
    const blueprintRevision = useBlueprintDocumentRevision();
    const openBlueprint = useOpenBlueprintTarget();
    const localBp =
        isInitialized && context ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint) : null;
    const nodeCatalog =
        isInitialized && context ? context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog) : null;
    const previewModel = useMemo(
        () => resolveFirstBlueprintLayerPreview(localBp, nodeCatalog, summary.blueprintId),
        [localBp, nodeCatalog, summary.blueprintId, blueprintRevision],
    );

    const openEntry = () => {
        if (!summary.blueprintId || !surfaceId) {
            return;
        }
        openBlueprint({
            blueprintId: summary.blueprintId,
            ownerKind: componentId ? "componentWidgetMain" : "widgetMain",
            surfaceId,
            componentId: componentId ?? undefined,
            elementId: element.id,
            title: `${widgetOwnerLabel.titlePrefix} - ${element.name ?? element.type}`,
        });
    };

    const canOpenEntry = summary.hasWidgetMain && Boolean(summary.blueprintId);

    return (
        <div className="rounded-lg border border-edge bg-[#111315] px-3 py-3 space-y-2">
            <button
                type="button"
                className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 disabled:cursor-default"
                disabled={!canOpenEntry}
                onClick={openEntry}
                aria-label={canOpenEntry ? t("widgetChrome.blueprint.openControlBlueprint") : t("widgetChrome.blueprint.noBlueprintForControl")}
            >
                <BlueprintLayerPreview model={previewModel} />
            </button>
            {summary.legacyHookCount > 0 ? (
                <p className="text-2xs text-amber-200/90 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
                    {tn("widgetChrome.blueprint.legacyHookCount", summary.legacyHookCount)}
                </p>
            ) : null}
            {summary.eventSchemaIssueCount > 0 ? (
                <p className="text-2xs text-amber-200/90 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
                    {t("widgetChrome.blueprint.eventSchemaMismatch")}
                </p>
            ) : null}
        </div>
    );
}
