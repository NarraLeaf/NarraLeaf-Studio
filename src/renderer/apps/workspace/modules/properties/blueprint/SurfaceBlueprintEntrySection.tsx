import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useReadonlySurfaceBlueprintSummary } from "@/lib/ui-editor/widget-modules/shared/blueprint/useReadonlySurfaceBlueprintSummary";
import { SURFACE_LIFECYCLE_EVENTS } from "@shared/types/ui-editor/blueprintLifecycle";
import type { SceneEditorContext } from "../schemas/sceneSchema";

export function SurfaceBlueprintEntrySection({ data }: CustomFieldProps<SceneEditorContext>) {
    const openBlueprint = useOpenBlueprintTarget();
    const surfaceId = data.surface.id;
    const summary = useReadonlySurfaceBlueprintSummary(data.documentService, surfaceId);

    const openEntry = () => {
        if (!summary.blueprintId) {
            return;
        }
        openBlueprint({
            blueprintId: summary.blueprintId,
            ownerKind: "surfaceMain",
            surfaceId,
            title: `Page Logic · ${data.surface.name || "Page"}`,
        });
    };

    return (
        <div className="rounded-lg border border-white/10 bg-[#111315] px-4 py-3 space-y-2">
            <p className="text-xs uppercase text-gray-500 tracking-wider">Page Logic</p>
            {!summary.hasSurfaceMain ? (
                <p className="text-sm text-gray-400">Not provisioned yet.</p>
            ) : (
                <>
                    <div className="space-y-1 text-sm text-gray-300">
                        <p className="text-[11px] text-gray-500">
                            {summary.fieldCount} field{summary.fieldCount === 1 ? "" : "s"} ·{" "}
                            {summary.bindingCount} binding{summary.bindingCount === 1 ? "" : "s"}
                            {summary.brokenBindingCount > 0 ? (
                                <span className="text-amber-400"> ({summary.brokenBindingCount} broken)</span>
                            ) : null}{" "}
                            · {summary.eventGraphCount} layer{summary.eventGraphCount === 1 ? "" : "s"}
                        </p>
                    </div>
                    <div className="space-y-2 rounded border border-white/5 bg-[#0d0f11] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wide text-gray-500">Events</p>
                        <div className="flex flex-wrap gap-1.5">
                            {SURFACE_LIFECYCLE_EVENTS.map(evt => (
                                <span
                                    key={evt.id}
                                    className="rounded border border-white/10 bg-[#111315] px-2 py-0.5 text-[11px] text-gray-200"
                                >
                                    {evt.displayName}
                                </span>
                            ))}
                        </div>
                    </div>
                </>
            )}
            <button
                type="button"
                className="mt-2 w-full rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-cyan-500/10"
                disabled={!summary.hasSurfaceMain || !summary.blueprintId}
                onClick={() => openEntry()}
            >
                Open editor
            </button>
        </div>
    );
}
