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

    const showSlotIds = rows.length > 1;

    return (
        <div className="mt-2 space-y-3 border-t border-white/5 pt-3">
            <ul className="space-y-3 list-none pl-0">
                {rows.map(row => (
                    <li key={row.eventId} className="rounded border border-white/5 bg-[#0d0f11] px-3 py-2 space-y-2">
                        <div>
                            <p className="text-sm font-medium text-gray-200">{row.displayName}</p>
                            {showSlotIds ? (
                                <p className="font-mono text-[10px] text-gray-500">{row.eventId}</p>
                            ) : null}
                            {row.description ? <p className="mt-1 text-[11px] text-gray-500">{row.description}</p> : null}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {row.wiredGraphEventId ? (
                                <>
                                    <span className="rounded border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] text-cyan-100">
                                        Layer{" "}
                                        <span className="font-mono text-[10px] text-cyan-200/90">
                                            {row.wiredGraphEventId.slice(0, 8)}…
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        className="rounded border border-white/10 px-2 py-1 text-[11px] text-gray-200 hover:bg-white/5"
                                        onClick={() => row.openEventGraph()}
                                    >
                                        Open layer
                                    </button>
                                    <button
                                        type="button"
                                        className="rounded border border-white/10 px-2 py-1 text-[11px] text-amber-200/90 hover:bg-white/5"
                                        onClick={() => row.clearWiring()}
                                    >
                                        Detach
                                    </button>
                                </>
                            ) : (
                                <>
                                    <button
                                        type="button"
                                        disabled={!row.canWire}
                                        className="rounded border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                        onClick={() => row.wireToNewGraph()}
                                        title={!row.canWire ? "Widget main blueprint is not ready yet." : undefined}
                                    >
                                        New layer
                                    </button>
                                    {row.existingEventGraphIds.length > 0 ? (
                                        <select
                                            className="max-w-[10rem] rounded border border-white/10 bg-[#0b0d12] px-2 py-1 text-[11px] text-gray-200"
                                            defaultValue=""
                                            disabled={!row.canWire}
                                            onChange={e => {
                                                const v = e.target.value;
                                                if (v) {
                                                    row.wireToExisting(v);
                                                    e.currentTarget.value = "";
                                                }
                                            }}
                                        >
                                            <option value="" disabled>
                                                Attach existing…
                                            </option>
                                            {row.existingEventGraphIds.map(id => (
                                                <option key={id} value={id}>
                                                    {id.slice(0, 10)}…
                                                </option>
                                            ))}
                                        </select>
                                    ) : null}
                                </>
                            )}
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}
