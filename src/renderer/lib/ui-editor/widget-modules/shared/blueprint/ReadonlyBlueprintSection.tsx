import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { BlueprintEventBindingField } from "@/apps/workspace/modules/properties/blueprint/BlueprintEventBindingField";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { useReadonlyBlueprintSummary } from "./useReadonlyBlueprintSummary";

/**
 * Shared properties-panel block: widget main blueprint summary + wiring + entry to the Blueprint editor.
 */
export function ReadonlyBlueprintSection({ data, onChange }: CustomFieldProps<UIInspectorData>) {
    const surfaceId = data.surfaceId;
    const element = data.element;
    const summary = useReadonlyBlueprintSummary(null, surfaceId, element);
    const openBlueprint = useOpenBlueprintTarget();

    const openEntry = () => {
        if (!summary.blueprintId || !surfaceId) {
            return;
        }
        openBlueprint({
            blueprintId: summary.blueprintId,
            ownerKind: "widgetMain",
            surfaceId,
            elementId: element.id,
            title: `Blueprint · ${element.name ?? element.type}`,
        });
    };

    const canOpenEntry = summary.hasWidgetMain && Boolean(summary.blueprintId);
    const graphsButNoUiHooks =
        summary.hasWidgetMain && summary.eventGraphCount > 0 && summary.uiBlueprintEventCount === 0;

    return (
        <div className="rounded-lg border border-white/10 bg-[#111315] px-4 py-3 space-y-2">
            <p className="text-xs uppercase text-gray-500 tracking-wider">Blueprint</p>
            {!summary.hasWidgetMain ? (
                <p className="text-sm text-gray-400 leading-snug">
                    No widget main blueprint is attached to this element. Widgets that support logic receive one when
                    needed.
                </p>
            ) : (
                <div className="space-y-1 text-sm text-gray-300">
                    <p className="font-mono text-[11px] text-gray-200">{summary.blueprintId}</p>
                    <p className="text-[11px] text-gray-500">
                        {summary.eventGraphCount} layer{summary.eventGraphCount === 1 ? "" : "s"} ·{" "}
                        {summary.uiBlueprintEventCount} interaction hook
                        {summary.uiBlueprintEventCount === 1 ? "" : "s"}
                    </p>
                </div>
            )}
            {graphsButNoUiHooks ? (
                <p className="text-[11px] text-amber-200/90 leading-snug rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
                    Layers exist but this control is not wired yet. Use <span className="font-medium">Blueprint</span> below
                    to attach a layer.
                </p>
            ) : null}
            {summary.eventWiringIssueCount > 0 ? (
                <p className="text-[11px] text-amber-200/90 leading-snug rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
                    UI event hooks do not match this blueprint&apos;s layers. Open the Blueprint editor diagnostics for
                    details.
                </p>
            ) : null}
            <BlueprintEventBindingField data={data} onChange={onChange} />
            <button
                type="button"
                className="mt-2 w-full rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-cyan-500/10"
                disabled={!canOpenEntry}
                onClick={() => openEntry()}
            >
                Open Blueprint editor
            </button>
        </div>
    );
}
