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

const widgetOwnerLabel = getOwnerLabel("widgetMain");

/**
 * Shared properties-panel block: single widget blueprint preview + entry to the Blueprint editor.
 */
export function ReadonlyBlueprintSection({ data }: CustomFieldProps<UIInspectorData>) {
    const { context, isInitialized } = useWorkspace();
    const surfaceId = data.surfaceId;
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
            ownerKind: "widgetMain",
            surfaceId,
            elementId: element.id,
            title: `${widgetOwnerLabel.titlePrefix} - ${element.name ?? element.type}`,
        });
    };

    const canOpenEntry = summary.hasWidgetMain && Boolean(summary.blueprintId);

    return (
        <div className="rounded-lg border border-white/10 bg-[#111315] px-3 py-3 space-y-2">
            <button
                type="button"
                className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 disabled:cursor-default"
                disabled={!canOpenEntry}
                onClick={openEntry}
                aria-label={canOpenEntry ? "Open control blueprint" : "No blueprint for this control"}
            >
                <BlueprintLayerPreview model={previewModel} />
            </button>
            {summary.legacyHookCount > 0 ? (
                <p className="text-[11px] text-amber-200/90 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
                    {summary.legacyHookCount} legacy hook{summary.legacyHookCount === 1 ? "" : "s"} in uidoc.
                </p>
            ) : null}
            {summary.eventSchemaIssueCount > 0 ? (
                <p className="text-[11px] text-amber-200/90 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
                    Event schema mismatch. See diagnostics in the editor.
                </p>
            ) : null}
        </div>
    );
}
