import type { Blueprint, BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { BlueprintEditorMemberFocus, BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import { resolveBlueprintNodeEditorCatalogEntry } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";

type Props = {
    blueprint: Blueprint;
    blueprintId: string;
    graphView: BlueprintEditorGraphView | null;
    memberFocus: BlueprintEditorMemberFocus;
    selectedNodeId: string | null;
    ir: BlueprintGraphIr | null;
    localBp: LocalBlueprintService;
};

export function BlueprintInspectorPane({
    blueprint,
    blueprintId,
    graphView,
    memberFocus,
    selectedNodeId,
    ir,
    localBp,
}: Props) {
    const showNodeInspector =
        Boolean(graphView && selectedNodeId && ir?.nodes && ir.nodes[selectedNodeId]);

    if (showNodeInspector && ir && selectedNodeId) {
        const node = ir.nodes![selectedNodeId];
        const catalog = resolveBlueprintNodeEditorCatalogEntry(node.type);
        const params = node.params ?? {};
        return (
            <div className="space-y-3 text-xs text-gray-200">
                <p className="rounded border border-white/10 bg-[#0d0f11] px-2 py-1.5 text-[10px] leading-snug text-gray-500">
                    This editor wires <span className="text-gray-400">execution flow</span> between nodes. Parameters
                    below are the source of truth; visual data edges are not required yet for most nodes.
                </p>
                <div>
                    <p className="text-[10px] uppercase text-gray-500">Node</p>
                    <p className="font-mono text-[11px] text-cyan-200/90">{node.type}</p>
                    <p className="text-gray-400">{catalog.displayName}</p>
                </div>
                {(catalog.inspectorParams ?? []).map(spec => (
                    <label key={spec.key} className="block space-y-1">
                        <span className="text-gray-500">{spec.label}</span>
                        {spec.kind === "json" ? (
                            <textarea
                                className="w-full rounded border border-white/10 bg-[#0d0f11] px-2 py-1 font-mono text-[11px] text-gray-200"
                                rows={3}
                                value={
                                    spec.key in params
                                        ? JSON.stringify(params[spec.key] ?? null, null, 0)
                                        : ""
                                }
                                onChange={e => {
                                    const raw = e.target.value.trim();
                                    let parsed: unknown = raw;
                                    if (raw.length > 0) {
                                        try {
                                            parsed = JSON.parse(raw);
                                        } catch {
                                            parsed = raw;
                                        }
                                    }
                                    if (!graphView) {
                                        return;
                                    }
                                    const commit = (draft: BlueprintGraphIr) => {
                                        const n = draft.nodes?.[selectedNodeId];
                                        if (!n) {
                                            return;
                                        }
                                        n.params = { ...n.params, [spec.key]: parsed };
                                    };
                                    if (graphView.kind === "event") {
                                        localBp.updateEventGraphIr(blueprintId, graphView.graphId, commit);
                                    } else {
                                        localBp.updateFunctionGraphIr(blueprintId, graphView.graphId, commit);
                                    }
                                }}
                            />
                        ) : (
                            <input
                                className="w-full rounded border border-white/10 bg-[#0d0f11] px-2 py-1 font-mono text-[11px] text-gray-200"
                                type={spec.kind === "number" ? "number" : "text"}
                                value={
                                    spec.kind === "number"
                                        ? String(params[spec.key] ?? "")
                                        : String(params[spec.key] ?? "")
                                }
                                onChange={e => {
                                    if (!graphView) {
                                        return;
                                    }
                                    const v =
                                        spec.kind === "number"
                                            ? Number(e.target.value)
                                            : e.target.value;
                                    const commit = (draft: BlueprintGraphIr) => {
                                        const n = draft.nodes?.[selectedNodeId];
                                        if (!n) {
                                            return;
                                        }
                                        n.params = { ...n.params, [spec.key]: v };
                                    };
                                    if (graphView.kind === "event") {
                                        localBp.updateEventGraphIr(blueprintId, graphView.graphId, commit);
                                    } else {
                                        localBp.updateFunctionGraphIr(blueprintId, graphView.graphId, commit);
                                    }
                                }}
                            />
                        )}
                    </label>
                ))}
            </div>
        );
    }

    if (memberFocus.kind === "declaration") {
        const decl = blueprint.members?.declarations?.[memberFocus.declarationId];
        if (!decl) {
            return <p className="text-xs text-gray-500">Declaration not found.</p>;
        }
        return (
            <div className="space-y-3 text-xs text-gray-200">
                <p className="text-[10px] uppercase text-gray-500">Declaration</p>
                <label className="block space-y-1">
                    <span className="text-gray-500">Name</span>
                    <input
                        className="w-full rounded border border-white/10 bg-[#0d0f11] px-2 py-1 text-[11px]"
                        value={decl.name}
                        onChange={e => localBp.renameDeclaration(blueprintId, decl.id, e.target.value)}
                    />
                </label>
                <label className="block space-y-1">
                    <span className="text-gray-500">Surface state key (M3-min)</span>
                    <p className="text-[10px] leading-snug text-gray-600">
                        Must match <span className="font-mono text-gray-500">params.key</span> in{" "}
                        <span className="font-mono text-gray-500">blueprint.state.set</span>. New bindings from the
                        properties panel default to{" "}
                        <span className="font-mono text-[10px] text-gray-500">w:&lt;elementId&gt;:&lt;propPath&gt;</span>.
                    </p>
                    <input
                        className="w-full rounded border border-white/10 bg-[#0d0f11] px-2 py-1 font-mono text-[11px]"
                        value={decl.valueSource?.kind === "surfaceState" ? decl.valueSource.key : ""}
                        placeholder="e.g. w:el_abc:text"
                        onChange={e => {
                            const key = e.target.value.trim();
                            if (!key) {
                                localBp.setDeclarationValueSource(blueprintId, decl.id, undefined);
                                return;
                            }
                            localBp.setDeclarationValueSource(blueprintId, decl.id, {
                                kind: "surfaceState",
                                key,
                            });
                        }}
                    />
                </label>
            </div>
        );
    }

    if (memberFocus.kind === "variable") {
        const v = blueprint.members?.variables?.[memberFocus.variableId];
        if (!v) {
            return <p className="text-xs text-gray-500">Variable not found.</p>;
        }
        return (
            <div className="text-xs text-gray-400">
                <p className="text-[10px] uppercase text-gray-500">Variable</p>
                <p className="mt-1">{v.name}</p>
                <p className="mt-2 text-gray-500">Full variable editing is planned for a later milestone.</p>
            </div>
        );
    }

    return (
        <div className="text-xs text-gray-500">
            <p>Select a node on the canvas, or a declaration in the member tree.</p>
            <p className="mt-2 text-[11px] leading-relaxed">
                Execution and debug events run in Dev Mode; this workspace stays structural editing only. Build{" "}
                <span className="text-gray-400">exec</span> chains on the canvas; use Dev Mode to verify behavior.
            </p>
        </div>
    );
}
