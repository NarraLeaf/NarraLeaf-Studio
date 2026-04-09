import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { BlueprintEventBindingField } from "@/apps/workspace/modules/properties/blueprint/BlueprintEventBindingField";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { useReadonlyBlueprintSummary } from "./useReadonlyBlueprintSummary";

/**
 * Shared properties-panel block: instance Blueprint summary + entry to the unified Blueprint editor.
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

    const hasWiring = summary.uiBlueprintEventCount > 0 || summary.eventGraphCount > 0;
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
                <ul className="text-sm text-gray-300 space-y-1 list-none pl-0">
                    <li>
                        <span className="text-gray-500">Widget main</span> ·{" "}
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
                    <li>
                        <span className="text-gray-500">UI event hooks</span> · {summary.uiBlueprintEventCount}
                        {!hasWiring ? <span className="text-gray-500"> (none wired)</span> : null}
                    </li>
                    {summary.eventWiringIssueCount > 0 ? (
                        <li>
                            <span className="text-gray-500">Event wiring issues</span> ·{" "}
                            <span className="text-amber-400">{summary.eventWiringIssueCount}</span>
                        </li>
                    ) : null}
                </ul>
            )}
            {graphsButNoUiHooks ? (
                <p className="text-[11px] text-amber-200/90 leading-snug rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
                    Event graph slots exist in the blueprint document, but no widget event is wired from the UI yet.
                    Use <span className="font-medium">Blueprint events</span> below to attach{" "}
                    <span className="font-mono text-[10px]">click</span> (or other supported events) so Dev Mode can
                    dispatch into a graph.
                </p>
            ) : null}
            {summary.eventWiringIssueCount > 0 ? (
                <p className="text-[11px] text-amber-200/90 leading-snug rounded border border-amber-500/25 bg-amber-500/10 px-2 py-1.5">
                    UI event hooks do not match this blueprint&apos;s event graph slots (wrong blueprint id, missing slot,
                    or program type). Open <span className="font-medium">Blueprint editor</span> diagnostics for details.
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
            <p className="text-[11px] text-gray-500 leading-snug border-t border-white/5 pt-2 mt-2">
                Summary and wiring here are static. Binding rows show Literal / Bound / Broken. Use Dev Mode for live
                execution, node enter/exit, Host API calls, and runtime errors (not mirrored in this panel).
            </p>
            <p className="text-[11px] text-gray-500 leading-snug">
                Appearance-capable widgets (<span className="font-mono text-[10px]">nl.container</span>,{" "}
                <span className="font-mono text-[10px]">nl.button</span>,{" "}
                <span className="font-mono text-[10px]">nl.image</span>): Dev Mode can switch the active variant via
                Host API / graph node <span className="font-mono text-[10px]">widget.setVariant</span> only. Property
                bindings on those types are not applied at runtime.
            </p>
        </div>
    );
}
