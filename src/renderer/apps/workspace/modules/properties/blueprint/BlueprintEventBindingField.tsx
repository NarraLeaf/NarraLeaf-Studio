import type { CustomFieldProps } from "@/apps/workspace/modules/properties/framework/types";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";
import { useBlueprintEventBindingState } from "./useBlueprintEventBindingState";

/**
 * Properties-panel block: wire widget runtime events to blueprint layers (uidoc `blueprintEvent`).
 */
export function BlueprintEventBindingField(props: CustomFieldProps<UIInspectorData>) {
    const { data } = props;
    const { rows, hasEvents } = useBlueprintEventBindingState(data);

    if (!hasEvents) {
        return null;
    }

    return (
        <div className="mt-2 space-y-2 border-t border-white/5 pt-3">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Events</p>
            <div className="flex flex-wrap gap-1.5">
                {rows.map(row => (
                    <span
                        key={row.eventId}
                        className="rounded border border-white/10 bg-[#0d0f11] px-2 py-1 text-[11px] text-gray-200"
                        title={row.description}
                    >
                        {row.displayName}
                    </span>
                ))}
            </div>
            {rows.some(row => row.legacyGraphEventId && row.legacyGraphEventId !== row.eventId) ? (
                <p className="text-[11px] text-amber-200/90">Legacy event ids detected.</p>
            ) : null}
        </div>
    );
}
