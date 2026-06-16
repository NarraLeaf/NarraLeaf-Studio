import { useCallback, useMemo, useState } from "react";
import { useOpenBlueprintTarget } from "../hooks/useOpenBlueprintTarget";
import { EditorComponentProps } from "../../types";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { useKeybindings, whenEditorFocused } from "@/apps/workspace/hooks";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";
import type { BlueprintEntryTabPayload } from "../blueprintEntryTabId";
import type { Blueprint, BlueprintGraphIr } from "@shared/types/blueprint/document";
import {
    createGraphNodeForPalette,
    ensureBlueprintGraphIr,
    graphIrHasFunctionEntry,
    writeNodeEditorLayout,
} from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import { buildBlueprintPaletteContext } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { useBlueprintDocumentRevision } from "../hooks/useBlueprintDocumentRevision";
import { useBlueprintDiagnostics } from "../hooks/useBlueprintDiagnostics";
import { useBlueprintEditorState, type BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import { BlueprintEditorLayout } from "../components/BlueprintEditorLayout";
import { BlueprintMemberTree } from "../components/BlueprintMemberTree";
import { BlueprintDiagnosticsPanel } from "../components/BlueprintDiagnosticsPanel";
import { BlueprintFlowCanvas, cloneBlueprintIr, removeBlueprintNodeFromIr } from "../flow/BlueprintFlowCanvas";
import { BlueprintGraphToolbar } from "../components/BlueprintGraphToolbar";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { TypeScriptBlueprintEditorPane } from "../ts/TypeScriptBlueprintEditorPane";
import { BlueprintFrontendBadge } from "../components/BlueprintFrontendBadge";
import { BlueprintPrivateRevisionBar } from "../components/BlueprintPrivateRevisionBar";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { BlueprintInspectorParamSelectOption } from "@/lib/ui-editor/blueprint-nodes/types";
import { createInputDialog } from "@/lib/components/dialogs";

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

function isTypingInField(): boolean {
    return isEditableKeyboardTarget(document.activeElement);
}

export function BlueprintEntryTab({ tabId, payload }: EditorComponentProps<BlueprintEntryTabPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    const revision = useBlueprintDocumentRevision();

    if (!isInitialized || !context || !payload?.blueprintId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
                Blueprint tab is invalid.
            </div>
        );
    }

    const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    const uuid = context.services.get<UuidService>(Services.Uuid);
    const uidoc = context.services.get<UIDocumentService>(Services.UIDocument);
    const uiService = context.services.get<UIService>(Services.UI);
    const inputDialog = useMemo(() => createInputDialog(uiService), [uiService]);
    const nodeCatalog = context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
    const doc = localBp.getBlueprintDocument();
    const bp = doc.blueprints[payload.blueprintId];
    if (!bp) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-amber-400">
                Blueprint not found: {payload.blueprintId}
            </div>
        );
    }

    const widgetElement =
        payload.ownerKind === "widgetMain" && payload.elementId
            ? uidoc.getDocument().elements[payload.elementId]
            : undefined;
    const widgetLogicEvents = useMemo(() => {
        const t = widgetElement?.type;
        return t ? widgetModuleRegistry.get(t)?.logicApi?.events : undefined;
    }, [widgetElement?.type]);
    const eventIds = useMemo(() => localBp.listEventGraphIds(payload.blueprintId), [localBp, payload.blueprintId, revision]);
    const functionIds = useMemo(
        () => localBp.listFunctionGraphIds(payload.blueprintId),
        [localBp, payload.blueprintId, revision],
    );

    const editor = useBlueprintEditorState(payload, { eventIds, functionIds });
    const diagnostics = useBlueprintDiagnostics(doc, payload.blueprintId, revision, {
        widgetElement,
        widgetSurfaceId: payload.surfaceId,
    });
    const openBlueprint = useOpenBlueprintTarget();
    const focusBlueprintEditor = useCallback(() => {
        uiService.focus.setFocus(FocusArea.Editor, tabId);
    }, [tabId, uiService]);

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

    const blueprintHistoryKeybindings = useMemo(
        () => [
            {
                id: "undo-ctrl",
                key: "ctrl+z",
                handler: () => {
                    if (!isTypingInField()) {
                        localBp.undoBlueprint(payload.blueprintId);
                    }
                },
            },
            {
                id: "redo-ctrl",
                key: "ctrl+shift+z",
                handler: () => {
                    if (!isTypingInField()) {
                        localBp.redoBlueprint(payload.blueprintId);
                    }
                },
            },
            {
                id: "undo-meta",
                key: "meta+z",
                handler: () => {
                    if (!isTypingInField()) {
                        localBp.undoBlueprint(payload.blueprintId);
                    }
                },
            },
            {
                id: "redo-meta",
                key: "meta+shift+z",
                handler: () => {
                    if (!isTypingInField()) {
                        localBp.redoBlueprint(payload.blueprintId);
                    }
                },
            },
        ],
        [localBp, payload.blueprintId],
    );

    useKeybindings({
        keybindings: blueprintHistoryKeybindings,
        enabled: Boolean(payload.blueprintId),
        when: whenEditorFocused(tabId),
        idPrefix: `blueprint-editor-${tabId}`,
    });

    const ir = getActiveIr(bp, editor.graphView);

    const commitIr = useCallback(
        (next: BlueprintGraphIr, history?: { mergeKey?: string; mergeWindowMs?: number }) => {
            if (!editor.graphView) {
                return;
            }
            const { blueprintId } = payload;
            const apply = (draft: BlueprintGraphIr) => {
                draft.nodes = next.nodes;
                draft.edges = next.edges;
                draft.meta = next.meta;
                draft.variables = next.variables;
            };
            if (editor.graphView.kind === "event") {
                localBp.updateEventGraphIr(blueprintId, editor.graphView.graphId, apply, history);
            } else {
                localBp.updateFunctionGraphIr(blueprintId, editor.graphView.graphId, apply, history);
            }
        },
        [editor.graphView, localBp, payload],
    );

    const onAddGraphNodeAtFlowPosition = useCallback(
        (type: string, flowPosition: { x: number; y: number }): string | undefined => {
            if (!editor.graphView) {
                return undefined;
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
            return id;
        },
        [editor.graphView, localBp, payload.blueprintId, uuid],
    );

    const onAddEvent = useCallback(async () => {
        const name = await inputDialog.show({
            title: "Create layer",
            placeholder: "Layer name",
            initialValue: `Layer ${eventIds.length + 1}`,
            required: true,
            maxLength: 120,
        });
        if (!name) {
            return;
        }
        const id = uuid.generate();
        localBp.ensureEventGraph(payload.blueprintId, id, name);
        editor.selectEventGraph(id);
    }, [editor, eventIds.length, inputDialog, localBp, payload.blueprintId, uuid]);

    const onDeleteLayer = useCallback(
        (layerId: string) => {
            const wasActive = editor.graphView?.kind === "event" && editor.graphView.graphId === layerId;
            localBp.runBlueprintHistoryTransaction(payload.blueprintId, () => {
                uidoc.stripBlueprintLayerBindings(payload.surfaceId, payload.blueprintId, layerId);
                localBp.removeEventGraph(payload.blueprintId, layerId);
            });
            if (wasActive) {
                const remaining = localBp.listEventGraphIds(payload.blueprintId);
                if (remaining.length > 0) {
                    editor.selectEventGraph(remaining[0]!);
                } else {
                    editor.setGraphView(null);
                    editor.setMemberFocus({ kind: "none" });
                }
            }
        },
        [editor, localBp, payload.blueprintId, payload.surfaceId, uidoc],
    );

    const onDeleteSelectedNode = useCallback(() => {
        if (!editor.graphView || editor.selectedNodeIds.length === 0 || !ir) {
            return;
        }
        const next = cloneBlueprintIr(ir);
        for (const id of editor.selectedNodeIds) {
            removeBlueprintNodeFromIr(next, id);
        }
        commitIr(next);
        editor.setSelectedNodeIds([]);
    }, [commitIr, editor, ir]);

    const onDiagnosticPick = useCallback(
        (d: BlueprintGraphEditorDiagnostic) => {
            const t = d.target;
            if (!t) {
                return;
            }
            if (t.kind === "field") {
                editor.applyDiagnosticTarget({ kind: "field", fieldId: t.fieldId });
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
    const hasAnyGraph = eventIds.length > 0;

    const widgetEventLayerSlots = useMemo(() => {
        if (payload.ownerKind !== "widgetMain" || !widgetElement || editor.graphView?.kind !== "event") {
            return undefined;
        }
        return [];
    }, [editor.graphView, payload.ownerKind, widgetElement]);

    const paletteContext = useMemo(() => {
        const gk = editor.graphView?.kind ?? "event";
        const activeIr = editor.graphView ? ir : null;
        return buildBlueprintPaletteContext({
            graphKind: gk,
            owner: bp.owner,
            widgetElementType: widgetElement?.type,
            widgetBlueprintEvents: widgetLogicEvents,
            widgetEventLayerSlots,
            hasEventHead: false,
            hasFunctionEntry: gk === "function" && activeIr ? graphIrHasFunctionEntry(activeIr) : false,
        });
    }, [bp.owner, editor.graphView, ir, widgetElement?.type, widgetEventLayerSlots, widgetLogicEvents]);

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

    const blueprintMemberVariables = useMemo(() => {
        return Object.values(bp.members?.variables ?? {})
            .map(v => ({ id: v.id, name: v.name }))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [revision, payload.blueprintId, bp]);

    const blueprintMembersSig = useMemo(
        () => blueprintMemberVariables.map(v => `${v.id}:${v.name}`).join("|"),
        [blueprintMemberVariables],
    );

    const dynamicSelectOptions = useMemo<Record<string, BlueprintInspectorParamSelectOption[]>>(() => {
        const doc = uidoc.getDocument();
        const surfaceOptions: BlueprintInspectorParamSelectOption[] = doc.surfaces
            .filter(s => s.kind === "appSurface")
            .map(s => ({ value: s.id, label: s.name || s.id }));
        const opts: Record<string, BlueprintInspectorParamSelectOption[]> = { surfaces: surfaceOptions };
        if (payload.ownerKind === "widgetMain" && payload.surfaceId) {
            const surface = doc.surfaces.find(s => s.id === payload.surfaceId);
            if (surface) {
                const collectElements = (rootId: string): BlueprintInspectorParamSelectOption[] => {
                    const result: BlueprintInspectorParamSelectOption[] = [];
                    const visit = (id: string) => {
                        const el = doc.elements[id];
                        if (!el) return;
                        result.push({ value: el.id, label: el.name || `${el.type} (${el.id.slice(0, 8)})` });
                        for (const cid of el.childrenIds) visit(cid);
                    };
                    visit(rootId);
                    return result;
                };
                opts.elements = collectElements(surface.rootElementId);
            }
        }
        return opts;
    }, [uidoc, revision, payload.ownerKind, payload.surfaceId]);

    const [memberPanelFocusContained, setMemberPanelFocusContained] = useState(false);

    if (bp.program.kind === "scriptModule") {
        const src = bp.program.source.code;
        return (
            <div
                className="h-full min-h-0"
                onMouseDownCapture={focusBlueprintEditor}
                onFocusCapture={focusBlueprintEditor}
            >
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
                    diagnostics={<BlueprintDiagnosticsPanel diagnostics={diagnostics} onPick={onDiagnosticPick} />}
                />
            </div>
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
                    canDelete={editor.selectedNodeIds.length > 0}
                    onDeleteSelectedNode={onDeleteSelectedNode}
                />
                <div className="min-h-0 flex-1">
                    <BlueprintFlowCanvas
                        nodeCatalog={nodeCatalog}
                        graphKey={graphKey}
                        ir={ir}
                        revision={revision}
                        blueprintMembersSig={blueprintMembersSig}
                        blueprintMemberVariables={blueprintMemberVariables}
                        selectedNodeIds={editor.selectedNodeIds}
                        onSelectNodeIds={editor.setSelectedNodeIds}
                        onCommitIr={commitIr}
                        onAddNodeAtFlowPosition={onAddGraphNodeAtFlowPosition}
                        paletteContext={paletteContext}
                        deleteKeyCode={memberPanelFocusContained ? null : undefined}
                        dynamicSelectOptions={dynamicSelectOptions}
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
                    Add layer
                </button>
            </div>
        ) : (
            <div className="flex h-full min-h-0 items-center justify-center text-xs text-gray-500">
                Select a layer on the left.
            </div>
        );

    return (
        <div
            className="h-full min-h-0"
            onMouseDownCapture={focusBlueprintEditor}
            onFocusCapture={focusBlueprintEditor}
        >
            <BlueprintEditorLayout
                header={header}
                onMemberPanelFocusContainedChange={setMemberPanelFocusContained}
                memberTree={
                    <BlueprintMemberTree
                        blueprint={bp}
                        blueprintId={payload.blueprintId}
                        blueprintDocumentRevision={revision}
                        graphView={editor.graphView}
                        diagnostics={diagnostics}
                        localBp={localBp}
                        surfaceId={payload.surfaceId}
                        widgetElementType={widgetElement?.type}
                        onSelectLayer={editor.selectEventGraph}
                        onAddLayer={onAddEvent}
                        onDeleteLayer={onDeleteLayer}
                    />
                }
                canvas={canvas}
                diagnostics={<BlueprintDiagnosticsPanel diagnostics={diagnostics} onPick={onDiagnosticPick} />}
            />
        </div>
    );
}
