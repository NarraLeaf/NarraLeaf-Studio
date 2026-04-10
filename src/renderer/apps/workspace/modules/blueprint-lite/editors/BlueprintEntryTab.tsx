import { useCallback, useMemo } from "react";
import { useOpenBlueprintTarget } from "../hooks/useOpenBlueprintTarget";
import { EditorComponentProps } from "../../types";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { BlueprintEntryTabPayload } from "../blueprintEntryTabId";
import type { Blueprint, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    createGraphNodeForPalette,
    ensureBlueprintGraphIr,
    graphIrHasEventHead,
    graphIrHasFunctionEntry,
    writeNodeEditorLayout,
} from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import { buildBlueprintPaletteContext } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { useBlueprintDocumentRevision } from "../hooks/useBlueprintDocumentRevision";
import { useBlueprintDiagnostics } from "../hooks/useBlueprintDiagnostics";
import { useBlueprintEditorState, type BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import { BlueprintEditorLayout } from "../components/BlueprintEditorLayout";
import { BlueprintMemberTree } from "../components/BlueprintMemberTree";
import { BlueprintInspectorPane } from "../components/BlueprintInspectorPane";
import { BlueprintDiagnosticsPanel } from "../components/BlueprintDiagnosticsPanel";
import { BlueprintFlowCanvas, cloneBlueprintIr, removeBlueprintNodeFromIr } from "../flow/BlueprintFlowCanvas";
import { BlueprintGraphToolbar } from "../components/BlueprintGraphToolbar";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { TypeScriptBlueprintEditorPane } from "../ts/TypeScriptBlueprintEditorPane";
import { BlueprintFrontendBadge } from "../components/BlueprintFrontendBadge";
import { BlueprintPrivateRevisionBar } from "../components/BlueprintPrivateRevisionBar";

function getActiveIr(bp: Blueprint, view: BlueprintEditorGraphView | null): BlueprintGraphIr | null {
    if (!view || bp.program.kind !== "graph") {
        return null;
    }
    if (view.kind === "event") {
        return ensureBlueprintGraphIr(bp.program.graphs.events[view.graphId]?.graph);
    }
    return ensureBlueprintGraphIr(bp.program.graphs.functions[view.graphId]?.graph);
}

function getGraphToolbarLabel(bp: Blueprint, view: BlueprintEditorGraphView | null): string {
    if (!view || bp.program.kind !== "graph") {
        return "";
    }
    if (view.kind === "event") {
        const name = bp.program.graphs.events[view.graphId]?.name ?? view.graphId;
        return `Event · ${name}`;
    }
    const name = bp.program.graphs.functions[view.graphId]?.name ?? view.graphId;
    return `Function · ${name}`;
}

export function BlueprintEntryTab({ payload }: EditorComponentProps<BlueprintEntryTabPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    const revision = useBlueprintDocumentRevision();

    if (!isInitialized || !context || !payload?.blueprintId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
                Blueprint is unavailable or the tab payload is invalid.
            </div>
        );
    }

    const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    const uuid = context.services.get<UuidService>(Services.Uuid);
    const uidoc = context.services.get<UIDocumentService>(Services.UIDocument);
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
    const widgetElement =
        payload.ownerKind === "widgetMain" && payload.elementId
            ? uidoc.getDocument().elements[payload.elementId]
            : undefined;
    const diagnostics = useBlueprintDiagnostics(doc, payload.blueprintId, revision, {
        widgetElement,
        widgetSurfaceId: payload.surfaceId,
    });
    const openBlueprint = useOpenBlueprintTarget();

    const reopenRevision = useCallback(
        (blueprintId: string) => {
            openBlueprint({
                blueprintId,
                ownerKind: payload.ownerKind,
                surfaceId: payload.surfaceId,
                elementId: payload.elementId,
                title: "Blueprint",
            });
        },
        [openBlueprint, payload],
    );

    const onTsSourceChange = useCallback(
        (code: string) => {
            localBp.updateScriptModuleSource(payload.blueprintId, code);
        },
        [localBp, payload.blueprintId],
    );

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

    const onAddGraphNodeAtFlowPosition = useCallback(
        (type: string, flowPosition: { x: number; y: number }) => {
            if (!editor.graphView) {
                return;
            }
            const id = uuid.generate();
            const node = createGraphNodeForPalette(type, id);
            writeNodeEditorLayout(node, flowPosition);
            const mut = (draft: BlueprintGraphIr) => {
                // Mutate `draft` in place — `ensureBlueprintGraphIr(draft)` returns a new object, so assigning
                // to that copy would not update the IR reference held by LocalBlueprintService.
                draft.nodes = { ...(draft.nodes ?? {}), [node.id]: node };
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
                editor.applyDiagnosticTarget({ kind: "binding", bindingId: t.bindingId });
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
    const hasAnyGraph = eventIds.length > 0 || functionIds.length > 0;

    const paletteContext = useMemo(() => {
        const gk = editor.graphView?.kind ?? "event";
        const activeIr = editor.graphView ? ir : null;
        return buildBlueprintPaletteContext({
            graphKind: gk,
            owner: bp.owner,
            widgetElementType: widgetElement?.type,
            hasEventHead: gk === "event" && activeIr ? graphIrHasEventHead(activeIr) : false,
            hasFunctionEntry: gk === "function" && activeIr ? graphIrHasFunctionEntry(activeIr) : false,
        });
    }, [bp.owner, editor.graphView, ir, widgetElement?.type]);

    const contextTitle = useMemo(
        () =>
            [
                payload.ownerKind,
                payload.surfaceId,
                payload.elementId,
                bp.id,
            ].filter(Boolean).join(" · "),
        [bp.id, payload.elementId, payload.ownerKind, payload.surfaceId],
    );

    if (bp.program.kind === "scriptModule") {
        const src = bp.program.source.code;
        return (
            <BlueprintEditorLayout
                header={
                    <div
                        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"
                        title={contextTitle}
                    >
                        <span className="text-sm font-semibold text-white">TypeScript</span>
                        <BlueprintFrontendBadge kind="typescript" />
                        <span className="truncate font-mono text-[11px] text-gray-400">{bp.name}</span>
                    </div>
                }
                memberTree={
                    <BlueprintPrivateRevisionBar
                        blueprint={bp}
                        localBp={localBp}
                        onReopenRevision={reopenRevision}
                    />
                }
                canvas={<TypeScriptBlueprintEditorPane code={src} onChange={onTsSourceChange} />}
                inspector={<div className="h-0" aria-hidden />}
                diagnostics={<BlueprintDiagnosticsPanel diagnostics={diagnostics} onPick={onDiagnosticPick} />}
            />
        );
    }

    const header = (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5" title={contextTitle}>
            <span className="text-sm font-semibold text-white">Blueprint</span>
            <BlueprintFrontendBadge kind="visual" />
            <span className="truncate font-mono text-[11px] text-gray-400">{bp.name}</span>
        </div>
    );

    const canvas =
        editor.graphView && ir ? (
            <div className="flex h-full min-h-0 flex-col">
                <BlueprintGraphToolbar
                    graphLabel={getGraphToolbarLabel(bp, editor.graphView)}
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
                        onAddNodeAtFlowPosition={onAddGraphNodeAtFlowPosition}
                        paletteContext={paletteContext}
                    />
                </div>
            </div>
        ) : !hasAnyGraph ? (
            <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-4 py-8">
                <button
                    type="button"
                    className="rounded-md border border-cyan-500/40 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20"
                    onClick={onAddEvent}
                >
                    Add event graph
                </button>
            </div>
        ) : (
            <div className="flex h-full min-h-0 items-center justify-center text-xs text-gray-500">
                Select a graph in the left panel.
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
                />
            }
            canvas={canvas}
            inspector={
                <BlueprintInspectorPane
                    blueprint={bp}
                    blueprintId={payload.blueprintId}
                    graphView={editor.graphView}
                    memberFocus={editor.memberFocus}
                    selectedNodeId={editor.selectedNodeId}
                    ir={ir}
                    localBp={localBp}
                    onSelectDeclaration={editor.selectDeclaration}
                />
            }
            diagnostics={<BlueprintDiagnosticsPanel diagnostics={diagnostics} onPick={onDiagnosticPick} />}
        />
    );
}
