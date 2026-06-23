import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenBlueprintTarget } from "../hooks/useOpenBlueprintTarget";
import { EditorComponentProps } from "../../types";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { useKeybindings, whenEditorFocused } from "@/apps/workspace/hooks";
import type { EditorLayout } from "@/apps/workspace/registry/types";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
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
import { BlueprintMemberTree, type BlueprintVariableGroupKey } from "../components/BlueprintMemberTree";
import {
    BlueprintEventLayerDialogContent,
    createDefaultBlueprintEventLayerValue,
    type BlueprintEventLayerDialogValue,
} from "../components/BlueprintEventLayerDialogContent";
import { BlueprintDiagnosticsPanel } from "../components/BlueprintDiagnosticsPanel";
import {
    BlueprintFlowCanvas,
    cloneBlueprintIr,
    removeBlueprintNodeFromIr,
    type BlueprintFlowViewport,
} from "../flow/BlueprintFlowCanvas";
import { BlueprintGraphToolbar } from "../components/BlueprintGraphToolbar";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { TypeScriptBlueprintEditorPane } from "../ts/TypeScriptBlueprintEditorPane";
import { BlueprintFrontendBadge } from "../components/BlueprintFrontendBadge";
import { BlueprintPrivateRevisionBar } from "../components/BlueprintPrivateRevisionBar";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { BlueprintInspectorParamSelectOption } from "@/lib/ui-editor/blueprint-nodes/types";
import { buildAccessibleBlueprintVariableOptions } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { resolveWidgetEventLayerSlotsForPalette } from "./blueprintPaletteContext";
import {
    buildBlueprintGraphClipboardPayload,
    getBlueprintGraphClipboard,
    pasteBlueprintGraphClipboardPayload,
    setBlueprintGraphClipboard,
} from "@/lib/workspace/services/ui-editor/blueprint/graphClipboard";

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

type BlueprintEditorMemberPanelState = {
    memberPanelCollapsed: boolean;
    variableGroupOpen: Partial<Record<BlueprintVariableGroupKey, boolean>>;
};

type BlueprintEditorViewportPanelState = {
    graphViewports?: Record<string, BlueprintFlowViewport>;
};

const BLUEPRINT_EDITOR_MEMBER_PANEL_STATE_ID = "blueprintEditor.memberPanel";
const BLUEPRINT_EDITOR_FLOW_VIEWPORT_STATE_PREFIX = "blueprintEditor.flowViewport";
const BLUEPRINT_VARIABLE_GROUP_KEYS: BlueprintVariableGroupKey[] = ["page", "blueprint", "global"];

function normalizeBlueprintFlowViewport(raw: unknown): BlueprintFlowViewport | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    const zoom = Number(record.zoom);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(zoom) || zoom <= 0) {
        return null;
    }
    return {
        x,
        y,
        zoom: Math.min(4, Math.max(0.05, zoom)),
    };
}

function getBlueprintFlowViewportPanelId(tabId: string): string {
    return `${BLUEPRINT_EDITOR_FLOW_VIEWPORT_STATE_PREFIX}:${tabId}`;
}

function findEditorGroupIdForTab(layout: Readonly<EditorLayout>, tabId: string): string | null {
    if ("tabs" in layout) {
        return layout.tabs.some(tab => tab.id === tabId) ? layout.id : null;
    }
    return findEditorGroupIdForTab(layout.first, tabId) ?? findEditorGroupIdForTab(layout.second, tabId);
}

function buildBlueprintPayloadWithGraphFocus(
    payload: BlueprintEntryTabPayload,
    graphView: BlueprintEditorGraphView | null,
): BlueprintEntryTabPayload {
    const next: BlueprintEntryTabPayload = {
        ...payload,
        focusEventId: undefined,
        focusFunctionId: undefined,
        focusFieldId: undefined,
        focusNodeId: undefined,
    };
    if (graphView?.kind === "event") {
        next.focusEventId = graphView.graphId;
    } else if (graphView?.kind === "function") {
        next.focusFunctionId = graphView.graphId;
    }
    return next;
}

function hasSameBlueprintGraphFocus(a: BlueprintEntryTabPayload, b: BlueprintEntryTabPayload): boolean {
    return (
        a.focusEventId === b.focusEventId &&
        a.focusFunctionId === b.focusFunctionId &&
        a.focusFieldId === b.focusFieldId &&
        a.focusNodeId === b.focusNodeId
    );
}

function normalizeBlueprintEditorMemberPanelState(raw: unknown): BlueprintEditorMemberPanelState {
    if (!raw || typeof raw !== "object") {
        return { memberPanelCollapsed: false, variableGroupOpen: {} };
    }
    const record = raw as Record<string, unknown>;
    const variableGroupOpen: Partial<Record<BlueprintVariableGroupKey, boolean>> = {};
    const storedGroupOpen = record.variableGroupOpen;
    if (storedGroupOpen && typeof storedGroupOpen === "object") {
        const groupRecord = storedGroupOpen as Record<string, unknown>;
        for (const key of BLUEPRINT_VARIABLE_GROUP_KEYS) {
            if (typeof groupRecord[key] === "boolean") {
                variableGroupOpen[key] = groupRecord[key];
            }
        }
    }
    return {
        memberPanelCollapsed:
            typeof record.memberPanelCollapsed === "boolean" ? record.memberPanelCollapsed : false,
        variableGroupOpen,
    };
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
    const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
    const nodeCatalog = context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
    const [memberPanelState, setMemberPanelState] = useState<BlueprintEditorMemberPanelState>(() =>
        normalizeBlueprintEditorMemberPanelState(
            panelStateService.getPanelState<Partial<BlueprintEditorMemberPanelState>>(
                BLUEPRINT_EDITOR_MEMBER_PANEL_STATE_ID,
            ),
        ),
    );
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
        (payload.ownerKind === "widgetMain" || payload.ownerKind === "widgetValue") && payload.elementId
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
        widgetBlueprintEvents: widgetLogicEvents,
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
                propPath: payload.propPath,
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
    const activeIrRef = useRef<BlueprintGraphIr | null>(null);
    activeIrRef.current = ir;

    const commitIr = useCallback(
        (next: BlueprintGraphIr, history?: { mergeKey?: string; mergeWindowMs?: number }) => {
            if (!editor.graphView) {
                return;
            }
            activeIrRef.current = next;
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

    const copySelectedGraphNodes = useCallback(() => {
        if (isTypingInField()) {
            return;
        }
        const activeIr = activeIrRef.current;
        if (!activeIr) {
            return;
        }
        const clipboard = buildBlueprintGraphClipboardPayload(activeIr, editor.selectedNodeIds);
        if (!clipboard) {
            return;
        }
        setBlueprintGraphClipboard(clipboard);
    }, [editor.selectedNodeIds]);

    const cutSelectedGraphNodes = useCallback(() => {
        if (isTypingInField()) {
            return;
        }
        const activeIr = activeIrRef.current;
        if (!activeIr) {
            return;
        }
        const clipboard = buildBlueprintGraphClipboardPayload(activeIr, editor.selectedNodeIds);
        if (!clipboard) {
            return;
        }
        setBlueprintGraphClipboard(clipboard);
        const next = cloneBlueprintIr(activeIr);
        for (const nodeId of clipboard.nodeIds) {
            removeBlueprintNodeFromIr(next, nodeId);
        }
        commitIr(next);
        editor.setSelectedNodeIds([]);
    }, [commitIr, editor]);

    const pasteGraphNodes = useCallback(() => {
        if (isTypingInField()) {
            return;
        }
        const activeIr = activeIrRef.current;
        if (!activeIr) {
            return;
        }
        const pasted = pasteBlueprintGraphClipboardPayload({
            ir: activeIr,
            payload: getBlueprintGraphClipboard(),
            generateId: () => uuid.generate(),
        });
        if (!pasted) {
            return;
        }
        commitIr(pasted.ir);
        editor.setSelectedNodeIds(pasted.newNodeIds);
    }, [commitIr, editor, uuid]);

    const blueprintKeybindings = useMemo(
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
                id: "copy-ctrl",
                key: "ctrl+c",
                handler: copySelectedGraphNodes,
            },
            {
                id: "cut-ctrl",
                key: "ctrl+x",
                handler: cutSelectedGraphNodes,
            },
            {
                id: "paste-ctrl",
                key: "ctrl+v",
                handler: pasteGraphNodes,
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
            {
                id: "copy-meta",
                key: "meta+c",
                handler: copySelectedGraphNodes,
            },
            {
                id: "cut-meta",
                key: "meta+x",
                handler: cutSelectedGraphNodes,
            },
            {
                id: "paste-meta",
                key: "meta+v",
                handler: pasteGraphNodes,
            },
        ],
        [
            copySelectedGraphNodes,
            cutSelectedGraphNodes,
            localBp,
            pasteGraphNodes,
            payload.blueprintId,
        ],
    );

    useKeybindings({
        keybindings: blueprintKeybindings,
        enabled: Boolean(payload.blueprintId),
        when: whenEditorFocused(tabId),
        idPrefix: `blueprint-editor-${tabId}`,
    });

    const persistGraphViewToTabPayload = useCallback(
        (graphView: BlueprintEditorGraphView | null) => {
            const nextPayload = buildBlueprintPayloadWithGraphFocus(payload, graphView);
            if (hasSameBlueprintGraphFocus(payload, nextPayload)) {
                return;
            }
            const store = uiService.getStore();
            const groupId = findEditorGroupIdForTab(store.getEditorLayout(), tabId);
            if (!groupId) {
                return;
            }
            store.updateEditorTabPayload<BlueprintEntryTabPayload>(tabId, nextPayload, groupId);
        },
        [payload, tabId, uiService],
    );

    const selectEventGraph = useCallback(
        (eventId: string) => {
            const view: BlueprintEditorGraphView = { kind: "event", graphId: eventId };
            persistGraphViewToTabPayload(view);
            editor.selectEventGraph(eventId);
        },
        [editor, persistGraphViewToTabPayload],
    );

    const selectFunctionGraph = useCallback(
        (functionId: string) => {
            const view: BlueprintEditorGraphView = { kind: "function", graphId: functionId };
            persistGraphViewToTabPayload(view);
            editor.selectFunctionGraph(functionId);
        },
        [editor, persistGraphViewToTabPayload],
    );

    const clearGraphView = useCallback(() => {
        persistGraphViewToTabPayload(null);
        editor.setGraphView(null);
        editor.setMemberFocus({ kind: "none" });
    }, [editor, persistGraphViewToTabPayload]);

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
        const eventHeadEntries = nodeCatalog.listPaletteEntries(buildBlueprintPaletteContext({
            graphKind: "event",
            owner: bp.owner,
            widgetElementType: widgetElement?.type,
            widgetBlueprintEvents: widgetLogicEvents,
            widgetEventLayerSlots: payload.ownerKind === "widgetMain" && widgetElement ? [] : undefined,
            hasEventHead: false,
            hasFunctionEntry: false,
            isBlueprintValueGraph: bp.owner.kind === "widgetValue",
        })).filter(entry => entry.role === "eventHead");
        const defaultLayerName = `Layer ${eventIds.length + 1}`;

        let selection: BlueprintEventLayerDialogValue = createDefaultBlueprintEventLayerValue(
            eventHeadEntries,
            defaultLayerName,
        );
        const selected = await new Promise<BlueprintEventLayerDialogValue | null>(resolve => {
            let dialogId: string | null = null;
            let settled = false;
            const safeResolve = (value: BlueprintEventLayerDialogValue | null) => {
                if (settled) {
                    return;
                }
                settled = true;
                resolve(value);
            };
            const closeDialog = () => {
                if (dialogId) {
                    uiService.dialogs.close(dialogId);
                    dialogId = null;
                }
            };
            const handleCreate = () => {
                if (!selection.valid) {
                    uiService.showNotification("Select an event and name the layer before creating it.", "warning");
                    return;
                }
                safeResolve({ ...selection });
                closeDialog();
            };
            const handleCancel = () => {
                safeResolve(null);
                closeDialog();
            };
            dialogId = uiService.dialogs.show({
                title: "Create event layer",
                content: (
                    <BlueprintEventLayerDialogContent
                        entries={eventHeadEntries}
                        defaultName={defaultLayerName}
                        onChange={value => {
                            selection = value;
                        }}
                    />
                ),
                closable: true,
                width: 460,
                buttons: [
                    { label: "Cancel", onClick: handleCancel },
                    { label: "Create", primary: true, onClick: handleCreate },
                ],
                onClose: handleCancel,
            });
        });
        if (!selected) {
            return;
        }
        const id = uuid.generate();
        localBp.runBlueprintHistoryTransaction(payload.blueprintId, () => {
            localBp.ensureEventGraph(payload.blueprintId, id, selected.name);
            if (selected.nodeType) {
                localBp.updateEventGraphIr(payload.blueprintId, id, draft => {
                    const node = createGraphNodeForPalette(selected.nodeType, uuid.generate());
                    writeNodeEditorLayout(node, { x: 80, y: 120 });
                    draft.nodes = { ...(draft.nodes ?? {}), [node.id]: node };
                });
            }
        });
        selectEventGraph(id);
    }, [
        bp.owner,
        editor,
        eventIds.length,
        localBp,
        nodeCatalog,
        payload.blueprintId,
        payload.ownerKind,
        selectEventGraph,
        uiService,
        uuid,
        widgetElement,
        widgetLogicEvents,
    ]);

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
                    selectEventGraph(remaining[0]!);
                } else {
                    clearGraphView();
                }
            }
        },
        [clearGraphView, editor.graphView, localBp, payload.blueprintId, payload.surfaceId, selectEventGraph, uidoc],
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
            if ((t.kind === "graph" || t.kind === "node") && t.graphKind && t.graphId) {
                if (t.graphKind === "event") {
                    selectEventGraph(t.graphId);
                } else {
                    selectFunctionGraph(t.graphId);
                }
                if (t.kind === "node" && t.nodeId) {
                    editor.setSelectedNodeIds([t.nodeId]);
                }
                return;
            }
            editor.applyDiagnosticTarget({
                kind: t.kind,
                graphKind: t.graphKind,
                graphId: t.graphId,
                nodeId: t.kind === "node" ? t.nodeId : undefined,
            });
        },
        [editor, selectEventGraph, selectFunctionGraph],
    );

    const graphKey = editor.graphView ? `${editor.graphView.kind}:${editor.graphView.graphId}` : "none";
    const flowViewportPanelId = useMemo(() => getBlueprintFlowViewportPanelId(tabId), [tabId]);
    const initialFlowViewport = useMemo(() => {
        const saved = panelStateService.getPanelState<BlueprintEditorViewportPanelState>(flowViewportPanelId);
        return normalizeBlueprintFlowViewport(saved?.graphViewports?.[graphKey]);
    }, [flowViewportPanelId, graphKey, panelStateService]);
    const onFlowViewportChange = useCallback(
        (viewport: BlueprintFlowViewport) => {
            if (graphKey === "none") {
                return;
            }
            const nextViewport = normalizeBlueprintFlowViewport(viewport);
            if (!nextViewport) {
                return;
            }
            const saved = panelStateService.getPanelState<BlueprintEditorViewportPanelState>(flowViewportPanelId);
            panelStateService.setPanelState<BlueprintEditorViewportPanelState>(flowViewportPanelId, {
                graphViewports: {
                    ...(saved?.graphViewports ?? {}),
                    [graphKey]: nextViewport,
                },
            });
        },
        [flowViewportPanelId, graphKey, panelStateService],
    );
    const hasAnyGraph = eventIds.length > 0;

    const widgetEventLayerSlots = useMemo(() => {
        return resolveWidgetEventLayerSlotsForPalette({
            ownerKind: payload.ownerKind,
            widgetElement,
            graphView: editor.graphView,
            blueprintId: payload.blueprintId,
            widgetBlueprintEvents: widgetLogicEvents,
        });
    }, [editor.graphView, payload.blueprintId, payload.ownerKind, widgetElement, widgetLogicEvents]);

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
            isBlueprintValueGraph: bp.owner.kind === "widgetValue",
        });
    }, [bp.owner, editor.graphView, ir, widgetElement?.type, widgetEventLayerSlots, widgetLogicEvents]);

    const contextTitle = useMemo(
        () =>
            [
                payload.ownerKind,
                payload.surfaceId,
                payload.elementId,
                payload.propPath,
                bp.id,
            ].filter(Boolean).join(" · "),
        [bp.id, payload.elementId, payload.ownerKind, payload.propPath, payload.surfaceId],
    );

    const blueprintMemberVariables = useMemo(() => {
        return buildAccessibleBlueprintVariableOptions({
            doc,
            currentBlueprintId: payload.blueprintId,
            surfaceId: payload.surfaceId,
        }).map(option => ({
            id: option.id,
            name: option.name,
            value: option.value,
            valueType: option.valueType,
            disambiguationLabel: option.disambiguationLabel,
        }));
    }, [doc, revision, payload.blueprintId, payload.surfaceId]);

    const blueprintMembersSig = useMemo(
        () => blueprintMemberVariables.map(v => `${v.value}:${v.name}:${v.valueType ?? ""}:${v.disambiguationLabel ?? ""}`).join("|"),
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

    useEffect(() => {
        setMemberPanelState(
            normalizeBlueprintEditorMemberPanelState(
                panelStateService.getPanelState<Partial<BlueprintEditorMemberPanelState>>(
                    BLUEPRINT_EDITOR_MEMBER_PANEL_STATE_ID,
                ),
            ),
        );
    }, [panelStateService]);

    const setMemberPanelCollapsed = useCallback(
        (collapsed: boolean) => {
            setMemberPanelState(prev => {
                if (prev.memberPanelCollapsed === collapsed) {
                    return prev;
                }
                const next = { ...prev, memberPanelCollapsed: collapsed };
                panelStateService.setPanelState<BlueprintEditorMemberPanelState>(
                    BLUEPRINT_EDITOR_MEMBER_PANEL_STATE_ID,
                    { memberPanelCollapsed: collapsed },
                );
                return next;
            });
        },
        [panelStateService],
    );

    const setVariableGroupOpen = useCallback(
        (groupKey: BlueprintVariableGroupKey, open: boolean) => {
            setMemberPanelState(prev => {
                if (prev.variableGroupOpen[groupKey] === open) {
                    return prev;
                }
                const variableGroupOpen = {
                    ...prev.variableGroupOpen,
                    [groupKey]: open,
                };
                const next = { ...prev, variableGroupOpen };
                panelStateService.setPanelState<BlueprintEditorMemberPanelState>(
                    BLUEPRINT_EDITOR_MEMBER_PANEL_STATE_ID,
                    { variableGroupOpen },
                );
                return next;
            });
        },
        [panelStateService],
    );

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
                    memberPanelCollapsed={memberPanelState.memberPanelCollapsed}
                    onMemberPanelCollapsedChange={setMemberPanelCollapsed}
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
                        diagnostics={diagnostics}
                        initialViewport={initialFlowViewport}
                        onViewportChange={onFlowViewportChange}
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
                memberPanelCollapsed={memberPanelState.memberPanelCollapsed}
                onMemberPanelCollapsedChange={setMemberPanelCollapsed}
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
                        variableGroupOpenState={memberPanelState.variableGroupOpen}
                        onVariableGroupOpenChange={setVariableGroupOpen}
                        onSelectLayer={selectEventGraph}
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
