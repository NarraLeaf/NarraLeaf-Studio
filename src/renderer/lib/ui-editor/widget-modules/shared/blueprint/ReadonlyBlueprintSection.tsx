import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { useReadonlyBlueprintSummary } from "./useReadonlyBlueprintSummary";

/**
 * Shared properties-panel block: instance Blueprint summary only (no edit / no navigation).
 */
export function ReadonlyBlueprintSection({ data }: CustomFieldProps<UIInspectorData>) {
    const surfaceId = data.surfaceId;
    const element = data.element;
    const summary = useReadonlyBlueprintSummary(null, surfaceId, element);

    return (
        <div className="rounded-lg border border-white/10 bg-[#111315] px-4 py-3 space-y-2">
            <p className="text-xs uppercase text-gray-500 tracking-wider">Blueprint</p>
            {!summary.hasWidgetMain ? (
                <p className="text-sm text-gray-400 leading-snug">No widget main blueprint is attached to this element.</p>
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
                    </li>
                </ul>
            )}
            <p className="text-[11px] text-gray-500 leading-snug border-t border-white/5 pt-2 mt-2">
                Full blueprint editing and event wiring UI are planned for Visual Editor M4. This editor stays static /
                layout-only; use Dev Mode for runtime preview when execution is available.
            </p>
        </div>
    );
}
