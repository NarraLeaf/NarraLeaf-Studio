import { useCallback, useMemo } from "react";
import { EditorComponentProps } from "../../types";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { BlueprintEntryTabPayload } from "../blueprintEntryTabId";
import type { Blueprint, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    ensureBlueprintGraphIr,
    ensureDefaultGraphEntry,
    createGraphNodeForPalette,
} from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import { useBlueprintDocumentRevision } from "../hooks/useBlueprintDocumentRevision";
import { useBlueprintDiagnostics } from "../hooks/useBlueprintDiagnostics";
import { useBlueprintEditorState } from "../state/useBlueprintEditorState";
import { BlueprintEditorLayout } from "../components/BlueprintEditorLayout";
import { BlueprintMemberTree } from "../components/BlueprintMemberTree";
import { BlueprintInspectorPane } from "../components/BlueprintInspectorPane";
import { BlueprintDiagnosticsPanel } from "../components/BlueprintDiagnosticsPanel";
import { BlueprintFlowCanvas, cloneBlueprintIr, removeBlueprintNodeFromIr } from "../flow/BlueprintFlowCanvas";
import { BlueprintNodePalette } from "../components/BlueprintNodePalette";
import { BlueprintGraphToolbar } from "../components/BlueprintGraphToolbar";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";

function getActiveIr(bp: Blueprint, view: ReturnType<typeof useBlueprintEditorState>["graphView"]): BlueprintGraphIr | null {
    if (!view || bp.program.kind !== "graph") {
        return null;
    }
    if (view.kind === "event") {
        return ensureBlueprintGraphIr(bp.program.graphs.events[view.graphId]?.graph);
    }
    return ensureBlueprintGraphIr(bp.program.graphs.functions[view.graphId]?.graph);
}

export function BlueprintEntryTab({ payload }: EditorComponentProps<BlueprintEntryTabPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    const revision = useBlueprintDocumentRevision();

    if (!isInitialized || !context || !payload?.blueprintId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
                Blueprint context is not available or the tab payload is invalid.
            </div>
        );
    }

    const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    const uuid = context.services.get<UuidService>(Services.Uuid);
    const doc = localBp.getBlueprintDocument();
    const bp = doc.blueprints[payload.blueprintId];
    if (!bp) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-amber-400">
                Blueprint not found: {payload.blueprintId}
            </div>
        );
    }

    const eventIds = useMemo(() => localBp.listEventGraphIds(payload.blueprintId), [localBp, payload.blueprintId, revision]);
    const functionIds = useMemo(
        () => localBp.listFunctionGraphIds(payload.blueprintId),
        [localBp, payload.blueprintId, revision],
    );

    const editor = useBlueprintEditorState(payload, { eventIds, functionIds });
    const diagnostics = useBlueprintDiagnostics(doc, payload.blueprintId, revision);

    const ir = getActiveIr(bp, editor.graphView);

    const commitIr = useCallback(
        (next: BlueprintGraphIr) => {
            if (!editor.graphView) {
                return;
            }
            const { blueprintId } = payload;
            const apply = (draft: BlueprintGraphIr) => {
                draft.nodes = next.nodes;
                draft.edges = next.edges;
                draft.entries = next.entries;
                draft.meta = next.meta;
                draft.variables = next.variables;
            };
            if (editor.graphView.kind === "event") {
                localBp.updateEventGraphIr(blueprintId, editor.graphView.graphId, apply);
            } else {
                localBp.updateFunctionGraphIr(blueprintId, editor.graphView.graphId, apply);
            }
        },
        [editor.graphView, localBp, payload],
    );

    const onPickPaletteType = useCallback(
        (type: string) => {
            if (!editor.graphView) {
                return;
            }
            const id = uuid.generate();
            const node = createGraphNodeForPalette(type, id);
            const mut = (draft: BlueprintGraphIr) => {
                const g = ensureBlueprintGraphIr(draft);
                g.nodes = { ...g.nodes, [node.id]: node };
                ensureDefaultGraphEntry(g, node.id);
            };
            if (editor.graphView.kind === "event") {
                localBp.updateEventGraphIr(payload.blueprintId, editor.graphView.graphId, mut);
            } else {
                localBp.updateFunctionGraphIr(payload.blueprintId, editor.graphView.graphId, mut);
            }
        },
        [editor.graphView, localBp, payload.blueprintId, uuid],
    );

    const onAddEvent = useCallback(() => {
        const id = uuid.generate();
        localBp.ensureEventGraph(payload.blueprintId, id, `Event ${id.slice(0, 8)}`);
        editor.selectEventGraph(id);
    }, [editor, localBp, payload.blueprintId, uuid]);

    const onAddFunction = useCallback(() => {
        const id = uuid.generate();
        localBp.ensureFunctionGraph(payload.blueprintId, id, `Function ${id.slice(0, 8)}`);
        editor.selectFunctionGraph(id);
    }, [editor, localBp, payload.blueprintId, uuid]);

    const onDeleteSelectedNode = useCallback(() => {
        if (!editor.graphView || !editor.selectedNodeId || !ir) {
            return;
        }
        const next = cloneBlueprintIr(ir);
        removeBlueprintNodeFromIr(next, editor.selectedNodeId);
        commitIr(next);
        editor.setSelectedNodeId(null);
    }, [commitIr, editor, ir]);

    const onDiagnosticPick = useCallback(
        (d: BlueprintGraphEditorDiagnostic) => {
            const t = d.target;
            if (!t) {
                return;
            }
            if (t.kind === "declaration") {
                editor.applyDiagnosticTarget({ kind: "declaration", declarationId: t.declarationId });
                return;
            }
            if (t.kind === "binding") {
                return;
            }
            editor.applyDiagnosticTarget({
                kind: t.kind,
                graphKind: t.graphKind,
                graphId: t.graphId,
                nodeId: t.kind === "node" ? t.nodeId : undefined,
            });
        },
        [editor],
    );

    const graphKey = editor.graphView ? `${editor.graphView.kind}:${editor.graphView.graphId}` : "none";

    const header = (
        <div>
            <h1 className="text-base font-semibold text-white">Visual Blueprint</h1>
            <p className="mt-1 text-xs text-gray-500 leading-relaxed">
                {payload.ownerKind} · surface <span className="text-cyan-400/80">{payload.surfaceId}</span>
                {payload.elementId ? (
                    <>
                        {" "}
                        · element <span className="text-cyan-400/80">{payload.elementId}</span>
                    </>
                ) : null}{" "}
                · <span className="font-mono text-[11px] text-gray-400">{bp.name}</span>{" "}
                <span className="font-mono text-[11px] text-gray-500">({bp.id})</span>
            </p>
        </div>
    );

    const canvas =
        editor.graphView && ir ? (
            <div className="flex h-full min-h-[400px] flex-col">
                <BlueprintGraphToolbar
                    graphLabel={`${editor.graphView.kind === "event" ? "Event" : "Function"} · ${editor.graphView.graphId}`}
                    canDelete={Boolean(editor.selectedNodeId)}
                    onDeleteSelectedNode={onDeleteSelectedNode}
                />
                <div className="min-h-0 flex-1">
                    <BlueprintFlowCanvas
                        graphKey={graphKey}
                        ir={ir}
                        revision={revision}
                        selectedNodeId={editor.selectedNodeId}
                        onSelectNodeId={editor.setSelectedNodeId}
                        onCommitIr={commitIr}
                    />
                </div>
            </div>
        ) : (
            <div className="flex h-full min-h-[200px] items-center justify-center text-xs text-gray-500">
                No graph to display. Add an event or function graph from the member tree.
            </div>
        );

    return (
        <BlueprintEditorLayout
            header={header}
            memberTree={
                <BlueprintMemberTree
                    blueprint={bp}
                    graphView={editor.graphView}
                    memberFocus={editor.memberFocus}
                    selectedNodeId={editor.selectedNodeId}
                    diagnostics={diagnostics}
                    onSelectEvent={editor.selectEventGraph}
                    onSelectFunction={editor.selectFunctionGraph}
                    onSelectDeclaration={editor.selectDeclaration}
                    onSelectVariable={editor.selectVariable}
                    onAddEvent={onAddEvent}
                    onAddFunction={onAddFunction}
                />
            }
            canvas={canvas}
            palette={
                editor.graphView ? (
                    <BlueprintNodePalette onPickType={onPickPaletteType} />
                ) : (
                    <p className="text-[11px] text-gray-500">Select a graph to add nodes.</p>
                )
            }
            inspector={
                <BlueprintInspectorPane
                    blueprint={bp}
                    blueprintId={payload.blueprintId}
                    graphView={editor.graphView}
                    memberFocus={editor.memberFocus}
                    selectedNodeId={editor.selectedNodeId}
                    ir={ir}
                    localBp={localBp}
                />
            }
            diagnostics={<BlueprintDiagnosticsPanel diagnostics={diagnostics} onPick={onDiagnosticPick} />}
        />
    );
}
