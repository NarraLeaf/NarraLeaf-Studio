import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { BlueprintEventBindingField } from "@/apps/workspace/modules/properties/blueprint/BlueprintEventBindingField";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { getWidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { getOwnerLabel } from "@shared/types/ui-editor/ownerLabels";
import { useReadonlyBlueprintSummary } from "./useReadonlyBlueprintSummary";

const widgetOwnerLabel = getOwnerLabel("widgetMain");

/**
 * Shared properties-panel block: single widget blueprint summary + entry to the Blueprint editor.
 */
export function ReadonlyBlueprintSection({ data, onChange }: CustomFieldProps<UIInspectorData>) {
    const surfaceId = data.surfaceId;
    const element = data.element;
    const summary = useReadonlyBlueprintSummary(null, surfaceId, element);
    const openBlueprint = useOpenBlueprintTarget();
    const logicApi = getWidgetLogicApi(element.type);

    const openEntry = () => {
        if (!summary.blueprintId || !surfaceId) {
            return;
        }
        openBlueprint({
            blueprintId: summary.blueprintId,
            ownerKind: "widgetMain",
            surfaceId,
            elementId: element.id,
            title: `${widgetOwnerLabel.titlePrefix} · ${element.name ?? element.type}`,
        });
    };

    const canOpenEntry = summary.hasWidgetMain && Boolean(summary.blueprintId);

    return (
        <div className="rounded-lg border border-white/10 bg-[#111315] px-4 py-3 space-y-2">
            <p className="text-xs uppercase text-gray-500 tracking-wider">{widgetOwnerLabel.label}</p>
            {!summary.hasWidgetMain ? (
                <p className="text-sm text-gray-400">No blueprint for this control.</p>
            ) : (
                <div className="space-y-1 text-sm text-gray-300">
                    <p className="font-mono text-[11px] text-gray-200">{logicApi?.blueprintLabel ?? widgetOwnerLabel.label}</p>
                    <p className="text-[11px] text-gray-500">
                        {summary.supportedEventCount} event{summary.supportedEventCount === 1 ? "" : "s"} ·{" "}
                        {summary.eventGraphCount} layer{summary.eventGraphCount === 1 ? "" : "s"}
                    </p>
                </div>
            )}
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
            {logicApi ? (
                <div className="space-y-2 rounded border border-white/5 bg-[#0d0f11] px-3 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">API</p>
                    <div className="space-y-1.5 text-[11px] text-gray-300">
                        <p>
                            <span className="text-gray-500">Events:</span>{" "}
                            {logicApi.events.length > 0 ? logicApi.events.map(eventDef => eventDef.displayName).join(", ") : "None"}
                        </p>
                        <p>
                            <span className="text-gray-500">Commands:</span>{" "}
                            {logicApi.commands.length > 0
                                ? logicApi.commands
                                      .map(command => `${command.displayName}${command.availability === "planned" ? " (planned)" : ""}`)
                                      .join(", ")
                                : "None"}
                        </p>
                        <p>
                            <span className="text-gray-500">Readable state:</span>{" "}
                            {logicApi.readableState.length > 0
                                ? logicApi.readableState.map(stateDef => stateDef.displayName).join(", ")
                                : "None"}
                        </p>
                        <p>
                            <span className="text-gray-500">Writable props:</span>{" "}
                            {logicApi.writableProps.length > 0
                                ? logicApi.writableProps.map(propDef => propDef.displayName).join(", ")
                                : "None"}
                        </p>
                    </div>
                </div>
            ) : null}
            <BlueprintEventBindingField data={data} onChange={onChange} />
            <button
                type="button"
                className="mt-2 w-full rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-cyan-500/10"
                disabled={!canOpenEntry}
                onClick={() => openEntry()}
            >
                Open editor
            </button>
        </div>
    );
}
