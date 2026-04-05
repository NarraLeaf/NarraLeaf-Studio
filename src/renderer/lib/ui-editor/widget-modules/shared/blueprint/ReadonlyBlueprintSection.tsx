import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import { useOpenBlueprintTarget } from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { useReadonlyBlueprintSummary } from "./useReadonlyBlueprintSummary";

/**
 * Shared properties-panel block: instance Blueprint summary + entry to the Visual Blueprint editor.
 */
export function ReadonlyBlueprintSection({ data }: CustomFieldProps<UIInspectorData>) {
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
                </ul>
            )}
            <button
                type="button"
                className="mt-2 w-full rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-cyan-500/10"
                disabled={!canOpenEntry}
                onClick={() => openEntry()}
            >
                Open Visual Blueprint editor
            </button>
            <p className="text-[11px] text-gray-500 leading-snug border-t border-white/5 pt-2 mt-2">
                Use the properties binding row for Literal / Bound / Broken; run logic in Dev Mode.
            </p>
        </div>
    );
}
