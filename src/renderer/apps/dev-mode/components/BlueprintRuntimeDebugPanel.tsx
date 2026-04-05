import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";

type BlueprintRuntimeDebugPanelProps = {
    debug: DebugBridge;
};

export function BlueprintRuntimeDebugPanel(props: BlueprintRuntimeDebugPanelProps) {
    const { debug } = props;
    const [open, setOpen] = useState(true);
    const [events, setEvents] = useState<BlueprintDebugEvent[]>(() => debug.snapshot());

    useEffect(() => {
        setEvents(debug.snapshot());
        return debug.subscribe(() => {
            setEvents(debug.snapshot());
        });
    }, [debug]);

    const recent = events.slice(-80).reverse();
    const errors = events.filter(e => e.type === "execution.error").slice(-12).reverse();
    const stateWrites = events.filter(e => e.type === "state.write").slice(-12).reverse();
    const bindings = events.filter(e => e.type === "binding.evaluated").slice(-12).reverse();
    const fnCalls = events.filter(e => e.type === "function.call" || e.type === "function.return").slice(-20).reverse();

    return (
        <div className="flex w-[300px] shrink-0 flex-col border-l border-white/10 bg-[#0d0f11] text-[11px] text-gray-300">
            <button
                type="button"
                className="flex items-center gap-1 border-b border-white/10 px-2 py-2 text-left font-medium text-gray-200 hover:bg-white/5"
                onClick={() => setOpen(o => !o)}
            >
                {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Blueprint DevTools
            </button>
            {open ? (
                <div className="min-h-0 flex-1 space-y-3 overflow-auto p-2 font-mono leading-snug">
                    <section>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Errors</p>
                        {errors.length === 0 ? (
                            <p className="text-[10px] text-gray-600">No execution errors.</p>
                        ) : (
                            <ul className="space-y-1">
                                {errors.map((ev, i) => (
                                    <li key={`e-${i}`} className="break-all text-[10px] text-amber-300/90">
                                        {ev.type === "execution.error" ? ev.message : ""}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    <section>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">State writes</p>
                        {stateWrites.length === 0 ? (
                            <p className="text-[10px] text-gray-600">No state writes recorded.</p>
                        ) : (
                            <ul className="space-y-0.5">
                                {stateWrites.map((ev, i) => (
                                    <li key={`s-${i}`} className="text-[10px] text-gray-400">
                                        {ev.type === "state.write" ? `${ev.scope} · ${ev.key}` : ""}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    <section>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Bindings</p>
                        {bindings.length === 0 ? (
                            <p className="text-[10px] text-gray-600">No binding evaluations yet.</p>
                        ) : (
                            <ul className="space-y-0.5">
                                {bindings.map((ev, i) => (
                                    <li key={`b-${i}`} className="text-[10px] text-gray-400">
                                        {ev.type === "binding.evaluated" ? ev.bindingId.slice(0, 14) : ""}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    <section>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Host calls</p>
                        {fnCalls.length === 0 ? (
                            <p className="text-[10px] text-gray-600">No host API calls yet.</p>
                        ) : (
                            <ul className="space-y-0.5">
                                {fnCalls.map((ev, i) => (
                                    <li key={`f-${i}`} className="text-[10px] text-gray-400">
                                        {ev.type === "function.call" || ev.type === "function.return"
                                            ? `${ev.type} · ${ev.functionId}`
                                            : ""}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                    <section>
                        <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Event stream</p>
                        {recent.length === 0 ? (
                            <p className="text-gray-500">No events yet. Click a wired button in the preview.</p>
                        ) : (
                            <ul className="space-y-1">
                                {recent.map((ev, i) => (
                                    <li key={`${i}-${ev.type}`} className="break-all text-[10px] text-gray-500">
                                        <span className="text-cyan-400/90">{ev.type}</span>
                                        {" · "}
                                        {formatEvent(ev)}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </section>
                </div>
            ) : null}
        </div>
    );
}

function formatEvent(ev: BlueprintDebugEvent): string {
    switch (ev.type) {
        case "execution.started":
        case "execution.finished":
            return `${ev.blueprintId.slice(0, 8)}… / ${ev.executionId.slice(0, 8)}…`;
        case "execution.error":
            return `${ev.executionId.slice(0, 8)}… — ${ev.message}`;
        case "state.read":
        case "state.write":
            return `${ev.scope} · ${ev.key}`;
        case "binding.evaluated":
            return ev.bindingId.slice(0, 10);
        default:
            return JSON.stringify(ev);
    }
}
