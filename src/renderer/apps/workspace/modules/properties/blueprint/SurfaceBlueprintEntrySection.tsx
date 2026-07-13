import { useMemo } from "react";
import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useBlueprintDocumentRevision } from "@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useWorkspace } from "@/apps/workspace/context";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import {
    BlueprintLayerPreview,
    resolveFirstBlueprintLayerPreview,
} from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintLayerPreview";
import { useReadonlySurfaceBlueprintSummary } from "@/lib/ui-editor/widget-modules/shared/blueprint/useReadonlySurfaceBlueprintSummary";
import type { SceneEditorContext } from "../schemas/sceneSchema";

export function SurfaceBlueprintEntrySection({ data }: CustomFieldProps<SceneEditorContext>) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const openBlueprint = useOpenBlueprintTarget();
    const blueprintRevision = useBlueprintDocumentRevision();
    const surfaceId = data.surface.id;
    const summary = useReadonlySurfaceBlueprintSummary(data.documentService, surfaceId);
    const logicLabel =
        data.surface.kind === "stageSurface"
            ? t("properties.blueprintEntry.gameUiLogic")
            : t("properties.blueprintEntry.pageLogic");
    const localBp =
        isInitialized && context ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint) : null;
    const nodeCatalog =
        isInitialized && context ? context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog) : null;
    const previewModel = useMemo(
        () => resolveFirstBlueprintLayerPreview(localBp, nodeCatalog, summary.blueprintId),
        [localBp, nodeCatalog, summary.blueprintId, blueprintRevision],
    );

    const openEntry = () => {
        if (!summary.blueprintId) {
            return;
        }
        openBlueprint({
            blueprintId: summary.blueprintId,
            ownerKind: "surfaceMain",
            surfaceId,
            title: t("properties.blueprintEntry.title", {
                logic: logicLabel,
                name: data.surface.name || t("properties.blueprintEntry.interfaceFallback"),
            }),
        });
    };

    const canOpenEntry = summary.hasSurfaceMain && Boolean(summary.blueprintId);

    return (
        <div className="rounded-lg border border-edge bg-[#111315] px-3 py-3 space-y-2">
            <button
                type="button"
                className="block w-full rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/70 disabled:cursor-default"
                disabled={!canOpenEntry}
                onClick={openEntry}
                aria-label={canOpenEntry ? t("properties.blueprintEntry.open") : t("properties.blueprintEntry.noBlueprint")}
            >
                <BlueprintLayerPreview model={previewModel} />
            </button>
            {summary.brokenBindingCount > 0 ? (
                <p className="text-2xs text-amber-200/90 rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
                    {tn("properties.blueprintEntry.brokenBindings", summary.brokenBindingCount)}
                </p>
            ) : null}
        </div>
    );
}
