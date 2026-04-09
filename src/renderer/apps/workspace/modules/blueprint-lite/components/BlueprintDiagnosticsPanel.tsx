import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";

type Props = {
    diagnostics: BlueprintGraphEditorDiagnostic[];
    onPick: (d: BlueprintGraphEditorDiagnostic) => void;
};

export function BlueprintDiagnosticsPanel({ diagnostics, onPick }: Props) {
    const errors = diagnostics.filter(d => d.severity === "error");
    const warnings = diagnostics.filter(d => d.severity === "warning");
    const infos = diagnostics.filter(d => d.severity === "info");

    if (diagnostics.length === 0) {
        return (
            <div className="border-t border-white/10 bg-[#0d0f11] px-3 py-2 text-[11px] text-gray-500 leading-relaxed">
                <p>No graph or binding diagnostics for this blueprint.</p>
                <p className="mt-1 text-[10px] text-gray-600">
                    When issues are listed below, click a row to focus the graph, node, or declaration. Codes such as{" "}
                    <span className="font-mono">blueprint.event_graphs_not_wired_to_ui</span>,{" "}
                    <span className="font-mono">binding.broken</span>, and{" "}
                    <span className="font-mono">graph.empty</span> distinguish “not wired”, “broken binding”, and “empty
                    graph”. Runtime traces stay in Dev Mode (Blueprint DevTools).
                </p>
            </div>
        );
    }

    const Row = ({ d }: { d: BlueprintGraphEditorDiagnostic }) => (
        <button
            type="button"
            className="flex w-full gap-2 rounded px-2 py-1 text-left hover:bg-white/5"
            onClick={() => onPick(d)}
        >
            <span
                className={
                    d.severity === "error"
                        ? "text-red-400"
                        : d.severity === "warning"
                          ? "text-amber-400"
                          : "text-gray-400"
                }
            >
                {d.severity}
            </span>
            <span className="flex-1 text-gray-300">{d.message}</span>
            {d.code ? <span className="font-mono text-[10px] text-gray-500">{d.code}</span> : null}
        </button>
    );

    return (
        <div className="max-h-40 overflow-auto border-t border-white/10 bg-[#0d0f11] px-2 py-2">
            <p className="mb-1 px-1 text-[10px] uppercase tracking-wide text-gray-500">
                Diagnostics · {errors.length} errors · {warnings.length} warnings · {infos.length} info
            </p>
            <div className="space-y-0.5">
                {errors.map((d, i) => (
                    <Row key={`e-${i}-${d.message}`} d={d} />
                ))}
                {warnings.map((d, i) => (
                    <Row key={`w-${i}-${d.message}`} d={d} />
                ))}
                {infos.map((d, i) => (
                    <Row key={`n-${i}-${d.message}`} d={d} />
                ))}
            </div>
            <p className="mt-2 px-1 text-[10px] leading-snug text-gray-500">
                Workspace: structure + UI↔graph wiring checks for widget blueprints — click a row to jump. Dev Mode: live
                execution and Host API traces (Blueprint DevTools).
            </p>
        </div>
    );
}
