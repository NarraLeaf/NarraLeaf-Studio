import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { useReadonlySurfaceBlueprintSummary } from "@/lib/ui-editor/widget-modules/shared/blueprint/useReadonlySurfaceBlueprintSummary";
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
            title: `Blueprint · ${data.surface.name || "Surface"}`,
        });
    };

    return (
        <div className="rounded-lg border border-white/10 bg-[#111315] px-4 py-3 space-y-2">
            <p className="text-xs uppercase text-gray-500 tracking-wider">Surface blueprint</p>
            {!summary.hasSurfaceMain ? (
                <p className="text-sm text-gray-400 leading-snug">
                    No surface main blueprint is registered for this surface yet. It is created when the surface is
                    provisioned.
                </p>
            ) : (
                <ul className="text-sm text-gray-300 space-y-1 list-none pl-0">
                    <li>
                        <span className="text-gray-500">Surface main</span> ·{" "}
                        <span className="text-gray-200 font-mono text-[11px]">{summary.blueprintId}</span>
                    </li>
                    <li>
                        <span className="text-gray-500">Declarations</span> · {summary.declarationCount}
                    </li>
                    <li>
                        <span className="text-gray-500">Property bindings</span> · {summary.bindingCount}
                        {summary.brokenBindingCount > 0 ? (
                            <span className="text-amber-400"> ({summary.brokenBindingCount} broken)</span>
                        ) : null}
                    </li>
                    <li>
                        <span className="text-gray-500">Event graphs (stored)</span> · {summary.eventGraphCount}
                    </li>
                </ul>
            )}
            <button
                type="button"
                className="mt-2 w-full rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-cyan-500/10"
                disabled={!summary.hasSurfaceMain || !summary.blueprintId}
                onClick={() => openEntry()}
            >
                Open Blueprint editor
            </button>
            <p className="text-[11px] text-gray-500 leading-snug border-t border-white/5 pt-2 mt-2">
                Active surface main revision opens here (Visual or TypeScript). Switch revisions or add siblings inside
                the editor; run and debug in Dev Mode.
            </p>
        </div>
    );
}
