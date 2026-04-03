import { EditorComponentProps } from "../../types";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintEntryTabPayload } from "../blueprintEntryTabId";
import { Workflow } from "lucide-react";

export function BlueprintEntryTab({ payload }: EditorComponentProps<BlueprintEntryTabPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();

    if (!isInitialized || !context || !payload?.blueprintId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
                Blueprint context is not available or the tab payload is invalid.
            </div>
        );
    }

    const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    const doc = localBp.getBlueprintDocument();
    const bp = doc.blueprints[payload.blueprintId];
    if (!bp) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-amber-400">
                Blueprint not found: {payload.blueprintId}
            </div>
        );
    }

    const decls = Object.values(bp.members?.declarations ?? {});
    const eventIds =
        bp.program.kind === "graph" ? Object.keys(bp.program.graphs.events ?? {}) : [];
    const bindings = Object.values(bp.bindings ?? {});

    return (
        <div className="flex h-full flex-col gap-4 overflow-auto bg-[#0d0f11] p-6 text-sm text-gray-200">
            <div className="flex items-start gap-3 border-b border-white/10 pb-4">
                <Workflow className="mt-0.5 h-5 w-5 text-cyan-400/90" />
                <div>
                    <h1 className="text-base font-semibold text-white">Blueprint entry</h1>
                    <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                        M4-lite: structured overview only. Editing graphs and bindings in Studio is planned for Visual
                        Blueprint M4-full. Runtime execution and debug events live in Dev Mode.
                    </p>
                </div>
            </div>

            <section className="space-y-2 rounded-lg border border-white/10 bg-[#111315] p-4">
                <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">Owner</h2>
                <p className="font-mono text-[11px] text-gray-300">
                    {payload.ownerKind} · surface <span className="text-cyan-400/80">{payload.surfaceId}</span>
                    {payload.elementId ? (
                        <>
                            {" "}
                            · element <span className="text-cyan-400/80">{payload.elementId}</span>
                        </>
                    ) : null}
                </p>
                <p className="text-xs text-gray-400">
                    <span className="text-gray-500">Blueprint</span> · {bp.name}{" "}
                    <span className="font-mono text-[11px] text-gray-300">({bp.id})</span>
                </p>
                {payload.focusEventId ? (
                    <p className="text-xs text-amber-400/90">Focus event: {payload.focusEventId}</p>
                ) : null}
            </section>

            <section className="space-y-2 rounded-lg border border-white/10 bg-[#111315] p-4">
                <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Declarations ({decls.length})
                </h2>
                {decls.length === 0 ? (
                    <p className="text-xs text-gray-500">No declaration members yet.</p>
                ) : (
                    <ul className="space-y-1 font-mono text-[11px] text-gray-300">
                        {decls.map(d => (
                            <li key={d.id}>
                                {d.name}{" "}
                                <span className="text-gray-500">
                                    {d.valueSource?.kind === "surfaceState"
                                        ? `→ surfaceState("${d.valueSource.key}")`
                                        : "(no valueSource)"}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="space-y-2 rounded-lg border border-white/10 bg-[#111315] p-4">
                <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Event graphs ({eventIds.length})
                </h2>
                {eventIds.length === 0 ? (
                    <p className="text-xs text-gray-500">No event graph slots stored on this blueprint.</p>
                ) : (
                    <ul className="space-y-1 font-mono text-[11px] text-gray-300">
                        {eventIds.map(id => (
                            <li key={id} className={id === payload.focusEventId ? "text-amber-300" : undefined}>
                                {id}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className="space-y-2 rounded-lg border border-white/10 bg-[#111315] p-4">
                <h2 className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Bindings ({bindings.length})
                </h2>
                {bindings.length === 0 ? (
                    <p className="text-xs text-gray-500">No property bindings on this blueprint.</p>
                ) : (
                    <ul className="space-y-1 text-[11px] text-gray-300">
                        {bindings.map(b => (
                            <li key={b.id} className={b.status === "broken" ? "text-amber-400" : undefined}>
                                {b.target.kind === "widgetProp"
                                    ? `${b.target.elementId} · ${b.target.propPath}`
                                    : b.id}{" "}
                                {b.status === "broken" ? `· broken (${b.brokenReason ?? "?"})` : null}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
