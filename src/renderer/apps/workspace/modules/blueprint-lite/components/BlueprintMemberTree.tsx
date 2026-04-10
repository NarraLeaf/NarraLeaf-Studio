import type { Blueprint } from "@shared/types/blueprint/document";
import type { BlueprintEditorMemberFocus, BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";

type Props = {
    blueprint: Blueprint;
    graphView: BlueprintEditorGraphView | null;
    memberFocus: BlueprintEditorMemberFocus;
    selectedNodeId: string | null;
    diagnostics: BlueprintGraphEditorDiagnostic[];
    onSelectEvent: (eventId: string) => void;
    onSelectFunction: (functionId: string) => void;
    onSelectDeclaration: (declarationId: string) => void;
    onSelectVariable: (variableId: string) => void;
    onAddEvent: () => void;
};

function countForGraph(
    diagnostics: BlueprintGraphEditorDiagnostic[],
    kind: "event" | "function",
    graphId: string,
): { errors: number; warnings: number } {
    let errors = 0;
    let warnings = 0;
    for (const d of diagnostics) {
        const t = d.target;
        if (!t || t.kind !== "graph" || t.graphKind !== kind || t.graphId !== graphId) {
            continue;
        }
        if (d.severity === "error") {
            errors += 1;
        } else if (d.severity === "warning") {
            warnings += 1;
        }
    }
    return { errors, warnings };
}

export function BlueprintMemberTree({
    blueprint,
    graphView,
    memberFocus,
    selectedNodeId,
    diagnostics,
    onSelectEvent,
    onSelectFunction,
    onSelectDeclaration,
    onSelectVariable,
    onAddEvent,
}: Props) {
    if (blueprint.program.kind !== "graph") {
        return <p className="text-xs text-gray-500">Not a graph blueprint.</p>;
    }
    const events = blueprint.program.graphs.events ?? {};
    const functions = blueprint.program.graphs.functions ?? {};
    const decls = blueprint.members?.declarations ?? {};
    const vars = blueprint.members?.variables ?? {};

    const eventActive = (id: string) =>
        graphView?.kind === "event" && graphView.graphId === id && memberFocus.kind === "graph";
    const fnActive = (id: string) =>
        graphView?.kind === "function" && graphView.graphId === id && memberFocus.kind === "graph";

    return (
        <div className="flex flex-col gap-3 text-xs text-gray-300">
            <section>
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500">
                    <span>Events</span>
                    <button
                        type="button"
                        className="text-cyan-400/90 hover:text-cyan-300"
                        onClick={() => onAddEvent()}
                    >
                        + Add
                    </button>
                </div>
                <ul className="space-y-0.5">
                    {Object.keys(events).length === 0 ? (
                        <li className="text-gray-500">—</li>
                    ) : (
                        Object.keys(events).map(id => {
                            const { errors, warnings } = countForGraph(diagnostics, "event", id);
                            return (
                                <li key={id}>
                                    <button
                                        type="button"
                                        className={`w-full rounded px-2 py-1 text-left font-mono text-[11px] ${
                                            eventActive(id)
                                                ? "bg-cyan-500/15 text-cyan-100"
                                                : "hover:bg-white/5 text-gray-300"
                                        }`}
                                        onClick={() => onSelectEvent(id)}
                                    >
                                        {events[id]?.name ?? id}
                                        {errors > 0 ? (
                                            <span className="ml-1 text-red-400">· {errors} err</span>
                                        ) : warnings > 0 ? (
                                            <span className="ml-1 text-amber-400">· {warnings} warn</span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })
                    )}
                </ul>
            </section>

            <section>
                <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-gray-500">
                    <span>Functions</span>
                </div>
                <p className="mb-1 text-[10px] text-gray-600">Pure function graphs only; creation UI arrives in a later milestone.</p>
                <ul className="space-y-0.5">
                    {Object.keys(functions).length === 0 ? (
                        <li className="text-gray-500">—</li>
                    ) : (
                        Object.keys(functions).map(id => {
                            const { errors, warnings } = countForGraph(diagnostics, "function", id);
                            return (
                                <li key={id}>
                                    <button
                                        type="button"
                                        className={`w-full rounded px-2 py-1 text-left font-mono text-[11px] ${
                                            fnActive(id)
                                                ? "bg-cyan-500/15 text-cyan-100"
                                                : "hover:bg-white/5 text-gray-300"
                                        }`}
                                        onClick={() => onSelectFunction(id)}
                                    >
                                        {functions[id]?.name ?? id}
                                        {errors > 0 ? (
                                            <span className="ml-1 text-red-400">· {errors} err</span>
                                        ) : warnings > 0 ? (
                                            <span className="ml-1 text-amber-400">· {warnings} warn</span>
                                        ) : null}
                                    </button>
                                </li>
                            );
                        })
                    )}
                </ul>
            </section>

            <section>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Declarations</p>
                <ul className="max-h-36 space-y-0.5 overflow-auto">
                    {Object.keys(decls).length === 0 ? (
                        <li className="text-gray-500">—</li>
                    ) : (
                        Object.values(decls).map(d => (
                            <li key={d.id}>
                                <button
                                    type="button"
                                    className={`w-full rounded px-2 py-1 text-left ${
                                        memberFocus.kind === "declaration" && memberFocus.declarationId === d.id
                                            ? "bg-cyan-500/15 text-cyan-100"
                                            : "hover:bg-white/5"
                                    }`}
                                    onClick={() => onSelectDeclaration(d.id)}
                                >
                                    {d.name}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            </section>

            <section>
                <p className="mb-1 text-[10px] uppercase tracking-wide text-gray-500">Variables</p>
                <ul className="max-h-28 space-y-0.5 overflow-auto">
                    {Object.keys(vars).length === 0 ? (
                        <li className="text-gray-500">—</li>
                    ) : (
                        Object.values(vars).map(v => (
                            <li key={v.id}>
                                <button
                                    type="button"
                                    className={`w-full rounded px-2 py-1 text-left ${
                                        memberFocus.kind === "variable" && memberFocus.variableId === v.id
                                            ? "bg-cyan-500/15 text-cyan-100"
                                            : "hover:bg-white/5"
                                    }`}
                                    onClick={() => onSelectVariable(v.id)}
                                >
                                    {v.name}
                                </button>
                            </li>
                        ))
                    )}
                </ul>
            </section>

            {selectedNodeId ? (
                <p className="border-t border-white/5 pt-2 text-[10px] text-gray-500">
                    Node <span className="font-mono text-gray-400">{selectedNodeId}</span>
                </p>
            ) : null}
        </div>
    );
}
