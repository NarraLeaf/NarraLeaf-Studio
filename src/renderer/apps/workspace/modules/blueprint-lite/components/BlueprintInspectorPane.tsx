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
    onSelectDeclaration: (declarationId: string) => void;
};

export function BlueprintInspectorPane({
    blueprint,
    blueprintId,
    graphView,
    memberFocus,
    selectedNodeId,
    ir,
    localBp,
    onSelectDeclaration,
}: Props) {
    if (memberFocus.kind === "declaration") {
        const decl = blueprint.members?.declarations?.[memberFocus.declarationId];
        if (!decl) {
            return <p className="text-xs text-gray-500">Declaration not found.</p>;
        }
        return (
            <div className="space-y-3 text-xs text-gray-200">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Declaration</p>
                <label className="block space-y-1">
                    <span className="text-gray-500">Name</span>
                    <input
                        className="w-full rounded border border-white/10 bg-[#0f1115] px-2 py-1 text-[11px]"
                        value={decl.name}
                        onChange={e => localBp.renameDeclaration(blueprintId, decl.id, e.target.value)}
                    />
                </label>
                <label className="block space-y-1">
                    <span className="text-gray-500">Surface state key</span>
                    <input
                        className="w-full rounded border border-white/10 bg-[#0f1115] px-2 py-1 font-mono text-[11px]"
                        value={decl.valueSource?.kind === "surfaceState" ? decl.valueSource.key : ""}
                        placeholder="w:<elementId>:<propPath>"
                        title="Must match blueprint.state.set params.key; property bindings default to w:elementId:propPath"
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
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Variable</p>
                <p className="mt-1">{v.name}</p>
            </div>
        );
    }

    if (memberFocus.kind === "binding") {
        const b = blueprint.bindings?.[memberFocus.bindingId];
        if (!b) {
            return <p className="text-xs text-gray-500">Binding not found.</p>;
        }
        const declId = b.source.kind === "declaration" ? b.source.declarationId : null;
        return (
            <div className="space-y-3 text-xs text-gray-200">
                <p className="text-[10px] uppercase tracking-wide text-gray-500">Binding</p>
                <p className="font-mono text-[10px] text-gray-500">{b.id}</p>
                {b.target.kind === "widgetProp" ? (
                    <dl className="space-y-1.5 text-[11px]">
                        <div>
                            <dt className="text-gray-500">Surface</dt>
                            <dd className="font-mono text-gray-300">{b.target.surfaceId}</dd>
                        </div>
                        <div>
                            <dt className="text-gray-500">Element</dt>
                            <dd className="font-mono text-gray-300">{b.target.elementId}</dd>
                        </div>
                        <div>
                            <dt className="text-gray-500">Property</dt>
                            <dd className="font-mono text-gray-300">{b.target.propPath}</dd>
                        </div>
                    </dl>
                ) : null}
                <div>
                    <span className="text-gray-500">Status</span>{" "}
                    <span className={b.status === "broken" ? "text-red-400" : "text-gray-300"}>
                        {b.status ?? "active"}
                    </span>
                </div>
                {b.brokenReason ? (
                    <p className="text-[11px] text-amber-400/90">{b.brokenReason}</p>
                ) : null}
                {declId ? (
                    <button
                        type="button"
                        className="w-full rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-gray-200 hover:bg-white/10"
                        onClick={() => onSelectDeclaration(declId)}
                    >
                        Open declaration
                    </button>
                ) : null}
            </div>
        );
    }

    const showNodeInspector =
        Boolean(graphView && selectedNodeId && ir?.nodes && ir.nodes[selectedNodeId]);

    if (showNodeInspector && ir && selectedNodeId) {
        const node = ir.nodes![selectedNodeId];
        const catalog = resolveBlueprintNodeEditorCatalogEntry(node.type);
        const params = node.params ?? {};
        return (
            <div className="space-y-3 text-xs text-gray-200">
                <div>
                    <p className="text-[10px] uppercase tracking-wide text-gray-500">Node</p>
                    <p className="font-mono text-[11px] text-cyan-200/90">{node.type}</p>
                    <p className="text-gray-400">{catalog.displayName}</p>
                </div>
                {(catalog.inspectorParams ?? []).map(spec => (
                    <label key={spec.key} className="block space-y-1">
                        <span className="text-gray-500">{spec.label}</span>
                        {spec.kind === "json" ? (
                            <textarea
                                className="w-full rounded border border-white/10 bg-[#0f1115] px-2 py-1 font-mono text-[11px] text-gray-200"
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
                                className="w-full rounded border border-white/10 bg-[#0f1115] px-2 py-1 font-mono text-[11px] text-gray-200"
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

    return <p className="text-xs text-gray-500">Select a graph member or a node on the canvas.</p>;
}
