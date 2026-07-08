import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOpenBlueprintTarget } from "../hooks/useOpenBlueprintTarget";
import { EditorComponentProps } from "../../types";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { useKeybindings, whenEditorFocused } from "@/apps/workspace/hooks";
import { useRegistry } from "@/apps/workspace/registry";
import type { EditorLayout } from "@/apps/workspace/registry/types";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";
import type { BlueprintEntryTabPayload } from "../blueprintEntryTabId";
import type { Blueprint, BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { StoryDocument } from "@shared/types/story";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import { getUIListChildSlot, isListLikeWidgetType } from "@shared/types/ui-editor/list";
import {
    applyBlueprintIrConnection,
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
import type { BlueprintFlowNodeData } from "../flow/components/BlueprintFlowNode";
import { BlueprintGraphToolbar } from "../components/BlueprintGraphToolbar";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { TypeScriptBlueprintEditorPane } from "../ts/TypeScriptBlueprintEditorPane";
import { BlueprintFrontendBadge } from "../components/BlueprintFrontendBadge";
import { BlueprintPrivateRevisionBar } from "../components/BlueprintPrivateRevisionBar";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type {
    BlueprintInspectorParamSelectOption,
    BlueprintMagicElementRefPaletteEntry,
    BlueprintNodeEditorCatalogEntry,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { BLUEPRINT_NODE_PARAM_SHOW_MAGIC_ELEMENT_TARGET_PIN } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
    readBlueprintFnSignatureSnapshot,
} from "@shared/types/blueprint/graph";
import {
    buildBlueprintFnSignatureSnapshot,
    findBlueprintFnByRef,
    isBlueprintFnSnapshotStale,
    isBlueprintFnVisibleToOwner,
    listCallableBlueprintFnOptions,
} from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import {
    ELEMENT_REF_PARAM_ELEMENT_ID,
    ELEMENT_REF_PARAM_ELEMENT_TYPE,
    ELEMENT_REF_PARAM_SURFACE_ID,
    readBlueprintElementRefParams,
} from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";
import { UISurfaceEditorTab } from "@/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab";
import { PanelsTopLeft } from "lucide-react";
import {
    clearElementBindingCompletion,
    readElementBindingCompletion,
    startElementBindingSession,
    subscribeElementBindingSession,
} from "../elementBindingSession";
import {
    createComponentDocumentServiceAdapter,
    getComponentTabId,
} from "@/apps/workspace/modules/ui-editor/editors/componentEditorAdapter";
import { buildAccessibleBlueprintVariableOptions } from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { resolveWidgetEventLayerSlotsForPalette } from "./blueprintPaletteContext";
import {
    buildBlueprintGraphClipboardPayload,
    getBlueprintGraphClipboard,
    pasteBlueprintGraphClipboardPayload,
    setBlueprintGraphClipboard,
} from "@/lib/workspace/services/ui-editor/blueprint/graphClipboard";
import {
    BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE,
    listBlueprintSetFramePageTargetOptions,
} from "@/lib/ui-editor/blueprint-nodes/frameTargetSurfaceOptions";

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

function isListItemContextElement(document: UIDocument, element: UIElement | undefined): boolean {
    let child = element;
    while (child?.parentId) {
        const parent = document.elements[child.parentId];
        if (!parent) {
            return false;
        }
        if (isListLikeWidgetType(parent.type)) {
            const slot = getUIListChildSlot(child.extra);
            return slot == null || slot === "itemTemplate";
        }
        child = parent;
    }
    return false;
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
const BLUEPRINT_VARIABLE_GROUP_KEYS: BlueprintVariableGroupKey[] = ["page", "global", "persistent"];
const SURFACE_TAB_PREFIX = "ui-editor:surface:";

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

function getSurfaceTabId(targetSurfaceId: string): string {
    return `${SURFACE_TAB_PREFIX}${targetSurfaceId}`;
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

function collectMagicElementRefs(input: {
    ir: BlueprintGraphIr | null;
    document: ReturnType<UIDocumentService["getDocument"]>;
    surfaceId: string | undefined;
}): BlueprintMagicElementRefPaletteEntry[] {
    if (!input.ir || !input.surfaceId) {
        return [];
    }
    const out: BlueprintMagicElementRefPaletteEntry[] = [];
    for (const node of Object.values(input.ir.nodes ?? {})) {
        if (!isElementBindingNodeType(node.type)) {
            continue;
        }
        const ref = readBlueprintElementRefParams(node.params);
        if (!ref || ref.surfaceId !== input.surfaceId) {
            continue;
        }
        const element = input.document.elements[ref.elementId];
        if (!element || element.type !== ref.elementType) {
            continue;
        }
        out.push({
            sourceNodeId: node.id,
            sourcePortId: "element",
            targetPortId: "element",
            surfaceId: ref.surfaceId,
            elementId: ref.elementId,
            elementType: ref.elementType,
            label: element.name?.trim() || element.type,
        });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label) || a.sourceNodeId.localeCompare(b.sourceNodeId));
}

const ELEMENT_LITERAL_PREVIEW_WIDTH = 176;
const ELEMENT_LITERAL_PREVIEW_HEIGHT = 72;

function isElementBindingNodeType(type: string): boolean {
    return (
        type === BLUEPRINT_NODE_TYPE_ELEMENT_REF ||
        type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH ||
        type === BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK
    );
}

function elementVariantOptions(
    element: UIElement | undefined,
    targetLabel?: string,
): NonNullable<BlueprintFlowNodeData["displayableTargetVariants"]> {
    if (!element) {
        return {
            supported: false,
            options: [],
            message: "Target element is missing",
        };
    }
    const appearance = (element.props as { appearance?: unknown } | undefined)?.appearance;
    if (!isAppearanceModel(appearance)) {
        return {
            supported: false,
            targetLabel,
            options: [],
            message: `${targetLabel ?? element.name ?? element.type} does not support variants`,
        };
    }
    return {
        supported: true,
        targetLabel,
        options: appearance.variants.map((variant, index) => ({
            value: variant.id,
            label: variant.name?.trim() || `Variant ${index + 1}`,
        })),
        message: targetLabel,
    };
}

function previewNumber(value: number | undefined, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ElementLiteralSurfacePreview({
    runtimeBridge,
    document,
    surface,
    element,
}: {
    runtimeBridge: UIRuntimeBridgeService;
    document: UIDocument;
    surface: UISurface;
    element: UIElement;
}) {
    const width = Math.max(1, Math.abs(previewNumber(element.layout.width, 1)));
    const height = Math.max(1, Math.abs(previewNumber(element.layout.height, 1)));
    const scale = Math.max(
        0.02,
        Math.min(2.2, ELEMENT_LITERAL_PREVIEW_WIDTH / width, ELEMENT_LITERAL_PREVIEW_HEIGHT / height),
    );
    const frameWidth = Math.max(24, Math.min(ELEMENT_LITERAL_PREVIEW_WIDTH, width * scale));
    const frameHeight = Math.max(18, Math.min(ELEMENT_LITERAL_PREVIEW_HEIGHT, height * scale));
    const previewSurfaceId = `${surface.id}:element-preview:${element.id}`;
    const previewDocument = useMemo<UIDocument>(() => {
        const previewRoot: UIElement = {
            ...element,
            parentId: null,
            childrenIds: [...element.childrenIds],
            layout: {
                ...element.layout,
                x: 0,
                y: 0,
                width,
                height,
            },
            props: element.props ? { ...element.props } : undefined,
            style: element.style ? { ...element.style } : undefined,
            behavior: element.behavior ? { ...element.behavior } : undefined,
            valueBindings: element.valueBindings ? { ...element.valueBindings } : undefined,
            extra: element.extra ? { ...element.extra } : undefined,
        };
        const previewSurface: UISurface = {
            ...surface,
            id: previewSurfaceId,
            name: `${surface.name} Element Preview`,
            designSize: { width, height },
            rootElementId: element.id,
            settings: {
                ...(surface.settings ?? {}),
                backgroundColor: "transparent",
            },
        };
        return {
            ...document,
            surfaces: [previewSurface, ...document.surfaces.filter(item => item.id !== previewSurfaceId)],
            elements: {
                ...document.elements,
                [element.id]: previewRoot,
            },
        };
    }, [document, element, height, previewSurfaceId, surface, width]);
    const rendered = runtimeBridge.renderDocumentSurface({
        document: previewDocument,
        surfaceId: previewSurfaceId,
        hostAdapter: { host: surface.host },
        className: "pointer-events-none select-none",
        style: { backgroundColor: "transparent" },
        editorChrome: false,
    });

    if (!rendered) {
        return (
            <div className="flex h-[72px] w-full items-center justify-center rounded-sm bg-[#0d1117] text-2xs text-fg-subtle">
                Preview unavailable
            </div>
        );
    }

    return (
        <div className="relative flex h-[72px] w-full items-center justify-center overflow-hidden rounded-sm bg-[#0d1117]">
            <div
                className="relative overflow-hidden rounded-[3px] border border-edge shadow-sm"
                style={{
                    width: frameWidth,
                    height: frameHeight,
                    backgroundColor: surface.settings?.backgroundColor ?? "#ffffff",
                }}
            >
                <div
                    className="absolute"
                    style={{
                        left: 0,
                        top: 0,
                        transform: `scale(${scale})`,
                        transformOrigin: "top left",
                        pointerEvents: "none",
                    }}
                >
                    {rendered}
                </div>
            </div>
        </div>
    );
}

/**
 * Guard wrapper: resolves the target blueprint and only mounts the editor when it exists.
 * If the blueprint is deleted while open (e.g. a Blueprint Value binding is reverted to a
 * literal), this unmounts the inner editor as a whole instead of returning early between its
 * hooks — which would otherwise trip React's "rendered fewer hooks than expected" error.
 */
export function BlueprintEntryTab(props: EditorComponentProps<BlueprintEntryTabPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    // Subscribe so the wrapper re-evaluates (and can unmount the inner editor) on deletion.
    useBlueprintDocumentRevision();

    if (!isInitialized || !context || !props.payload?.blueprintId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
                Blueprint tab is invalid.
            </div>
        );
    }
    const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    if (!localBp.getBlueprintDocument().blueprints[props.payload.blueprintId]) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-amber-400">
                Blueprint not found: {props.payload.blueprintId}
            </div>
        );
    }
    return <BlueprintEntryTabInner key={props.payload.blueprintId} {...props} />;
}

function BlueprintEntryTabInner({ tabId, payload }: EditorComponentProps<BlueprintEntryTabPayload | undefined>) {
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    const revision = useBlueprintDocumentRevision();

    if (!isInitialized || !context || !payload?.blueprintId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
                Blueprint tab is invalid.
            </div>
        );
    }

    const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    const uuid = context.services.get<UuidService>(Services.Uuid);
    const uidoc = context.services.get<UIDocumentService>(Services.UIDocument);
    const isComponentDefinitionGraph = payload.ownerKind === "componentWidgetMain";
    const blueprintDocumentService = useMemo(
        () =>
            isComponentDefinitionGraph && payload.componentId
                ? createComponentDocumentServiceAdapter(uidoc, payload.componentId)
                : uidoc,
        [isComponentDefinitionGraph, payload.componentId, uidoc],
    );
    const uiService = context.services.get<UIService>(Services.UI);
    const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
    const nodeCatalog = context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
    const runtimeBridge = context.services.get<UIRuntimeBridgeService>(Services.RuntimeBridge);
    const storyService = context.services.get<StoryService>(Services.Story);
    const [uiDocumentRevision, setUiDocumentRevision] = useState(() => uidoc.getRevision());
    const [storyDocumentsById, setStoryDocumentsById] = useState<Record<string, StoryDocument>>({});
    const [storyLibraryRevision, setStoryLibraryRevision] = useState(0);
    const [dynamicSelectOptionsRevision, setDynamicSelectOptionsRevision] = useState(0);
    const [memberPanelState, setMemberPanelState] = useState<BlueprintEditorMemberPanelState>(() =>
        normalizeBlueprintEditorMemberPanelState(
            panelStateService.getPanelState<Partial<BlueprintEditorMemberPanelState>>(
                BLUEPRINT_EDITOR_MEMBER_PANEL_STATE_ID,
            ),
        ),
    );
    useEffect(() => uidoc.onDocumentChanged(() => setUiDocumentRevision(uidoc.getRevision())), [uidoc]);
    useEffect(
        () => nodeCatalog.onDynamicSelectOptionsChanged(() => setDynamicSelectOptionsRevision(value => value + 1)),
        [nodeCatalog],
    );
    useEffect(() => {
        let disposed = false;
        const refreshLibrary = () => {
            setStoryLibraryRevision(value => value + 1);
            const entries = storyService.listStories();
            void Promise.all(
                entries.map(entry => (
                    storyService.loadStory(entry.id)
                        .then(document => [entry.id, document] as const)
                        .catch(() => null)
                )),
            ).then(results => {
                if (disposed) {
                    return;
                }
                const next: Record<string, StoryDocument> = {};
                for (const result of results) {
                    if (result) {
                        next[result[0]] = result[1];
                    }
                }
                setStoryDocumentsById(next);
            });
        };

        refreshLibrary();
        const offLibrary = storyService.onLibraryChanged(refreshLibrary);
        const offDocument = storyService.onDocumentChanged(({ storyId, document }) => {
            setStoryDocumentsById(prev => ({ ...prev, [storyId]: document }));
            setStoryLibraryRevision(value => value + 1);
        });
        return () => {
            disposed = true;
            offLibrary();
            offDocument();
        };
    }, [storyService]);
    const doc = localBp.getBlueprintDocument();
    // Existence is guaranteed by the BlueprintEntryTab wrapper, which unmounts this component
    // when the blueprint is deleted (avoids an early return between the hooks below).
    const bp = doc.blueprints[payload.blueprintId]!;

    const uiDocument = blueprintDocumentService.getDocument();
    const widgetElement =
        (payload.ownerKind === "widgetMain" ||
            payload.ownerKind === "widgetValue" ||
            payload.ownerKind === "componentWidgetMain") &&
        payload.elementId
            ? uiDocument.elements[payload.elementId]
            : undefined;
    const listItemContextAvailable = isListItemContextElement(uiDocument, widgetElement);
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
        isComponentDefinitionGraph,
    });
    const openBlueprint = useOpenBlueprintTarget();
    const focusBlueprintEditor = useCallback(() => {
        uiService.focus.setFocus(FocusArea.Editor, tabId);
    }, [tabId, uiService]);

    useEffect(() => {
        const handleCompletion = () => {
            const completion = readElementBindingCompletion();
            if (!completion || completion.session.blueprintId !== payload.blueprintId) {
                return;
            }
            const { session, target } = completion;
            const apply = (draft: BlueprintGraphIr) => {
                const node = draft.nodes?.[session.nodeId];
                if (!node) {
                    return;
                }
                node.params = {
                    ...(node.params ?? {}),
                    [ELEMENT_REF_PARAM_SURFACE_ID]: target.surfaceId,
                    [ELEMENT_REF_PARAM_ELEMENT_ID]: target.elementId,
                    [ELEMENT_REF_PARAM_ELEMENT_TYPE]: target.elementType,
                };
            };
            if (session.graphKind === "event") {
                localBp.updateEventGraphIr(payload.blueprintId, session.graphId, apply);
            } else if (session.graphKind === "function") {
                localBp.updateFunctionGraphIr(payload.blueprintId, session.graphId, apply);
            }
            clearElementBindingCompletion();
            openBlueprint({
                blueprintId: payload.blueprintId,
                ownerKind: payload.ownerKind,
                surfaceId: payload.surfaceId,
                componentId: payload.componentId,
                elementId: payload.elementId,
                propPath: payload.propPath,
                title: "Blueprint",
                focusEventId: session.graphKind === "event" ? session.graphId : undefined,
                focusFunctionId: session.graphKind === "function" ? session.graphId : undefined,
                focusNodeId: session.nodeId,
            });
        };
        handleCompletion();
        return subscribeElementBindingSession(handleCompletion);
    }, [localBp, openBlueprint, payload, tabId]);

    const reopenRevision = useCallback(
        (blueprintId: string) => {
            openBlueprint({
                blueprintId,
                ownerKind: payload.ownerKind,
                surfaceId: payload.surfaceId,
                componentId: payload.componentId,
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
            targetBlueprintId: payload.blueprintId,
        });
        if (!pasted) {
            return;
        }
        commitIr(pasted.ir);
        editor.setSelectedNodeIds(pasted.newNodeIds);
    }, [commitIr, editor, uuid, payload.blueprintId]);

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
        (entry: BlueprintNodeEditorCatalogEntry, flowPosition: { x: number; y: number }): string | undefined => {
            if (!editor.graphView) {
                return undefined;
            }
            const id = uuid.generate();
            const node = createGraphNodeForPalette(entry.type, id);
            if (entry.magicElementRef) {
                node.params = {
                    ...(node.params ?? {}),
                    [BLUEPRINT_NODE_PARAM_SHOW_MAGIC_ELEMENT_TARGET_PIN]: true,
                };
            }
            writeNodeEditorLayout(node, flowPosition);
            const mut = (draft: BlueprintGraphIr) => {
                // Mutate `draft` in place — `ensureBlueprintGraphIr(draft)` returns a new object, so assigning
                // to that copy would not update the IR reference held by LocalBlueprintService.
                draft.nodes = { ...(draft.nodes ?? {}), [node.id]: node };
                if (entry.magicElementRef) {
                    draft.edges = applyBlueprintIrConnection(draft, {
                        source: entry.magicElementRef.sourceNodeId,
                        sourceHandle: entry.magicElementRef.sourcePortId,
                        target: node.id,
                        targetHandle: entry.magicElementRef.targetPortId,
                    });
                }
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

    const onBindElementLiteral = useCallback(
        (nodeId: string) => {
            if (!editor.graphView || !payload.surfaceId) {
                return;
            }
            const surface = blueprintDocumentService.getDocument().surfaces.find(item => item.id === payload.surfaceId);
            if (!surface) {
                return;
            }
            startElementBindingSession({
                id: uuid.generate(),
                blueprintId: payload.blueprintId,
                blueprintTabId: tabId,
                graphKind: editor.graphView.kind,
                graphId: editor.graphView.graphId,
                nodeId,
                surfaceId: surface.id,
            });
            const tabPayload = isComponentDefinitionGraph && payload.componentId
                ? { componentId: payload.componentId }
                : { surfaceId: surface.id };
            openEditorTab({
                id: isComponentDefinitionGraph && payload.componentId ? getComponentTabId(payload.componentId) : getSurfaceTabId(surface.id),
                title: surface.name,
                icon: <PanelsTopLeft className="w-4 h-4" />,
                component: UISurfaceEditorTab,
                payload: tabPayload,
                closable: true,
                modified: false,
            });
        },
        [
            blueprintDocumentService,
            editor.graphView,
            isComponentDefinitionGraph,
            openEditorTab,
            payload.blueprintId,
            payload.componentId,
            payload.surfaceId,
            tabId,
            uuid,
        ],
    );

    const onAddEvent = useCallback(async () => {
        const eventHeadEntries = nodeCatalog.listPaletteEntries(buildBlueprintPaletteContext({
            graphKind: "event",
            owner: bp.owner,
            widgetElementType: widgetElement?.type,
            widgetBlueprintEvents: widgetLogicEvents,
            widgetEventLayerSlots:
                (payload.ownerKind === "widgetMain" || payload.ownerKind === "componentWidgetMain") && widgetElement
                    ? []
                    : undefined,
            hasEventHead: false,
            hasFunctionEntry: false,
            isBlueprintValueGraph: bp.owner.kind === "widgetValue",
            listItemContextAvailable,
            isComponentDefinitionGraph,
        })).filter(entry => entry.role === "eventHead" || entry.role === "elementEventHead");
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
        listItemContextAvailable,
        localBp,
        nodeCatalog,
        payload.blueprintId,
        isComponentDefinitionGraph,
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
                blueprintDocumentService.stripBlueprintLayerBindings(payload.surfaceId ?? "", payload.blueprintId, layerId);
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
        [
            blueprintDocumentService,
            clearGraphView,
            editor.graphView,
            localBp,
            payload.blueprintId,
            payload.surfaceId,
            selectEventGraph,
        ],
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
        const magicElementRefs = collectMagicElementRefs({
            ir: activeIr,
            document: blueprintDocumentService.getDocument(),
            surfaceId: payload.surfaceId,
        });
        return buildBlueprintPaletteContext({
            graphKind: gk,
            owner: bp.owner,
            widgetElementType: widgetElement?.type,
            widgetBlueprintEvents: widgetLogicEvents,
            widgetEventLayerSlots,
            hasEventHead: false,
            hasFunctionEntry: gk === "function" && activeIr ? graphIrHasFunctionEntry(activeIr) : false,
            isBlueprintValueGraph: bp.owner.kind === "widgetValue",
            listItemContextAvailable,
            magicElementRefs,
            isComponentDefinitionGraph,
        });
    }, [
        blueprintDocumentService,
        bp.owner,
        editor.graphView,
        ir,
        isComponentDefinitionGraph,
        listItemContextAvailable,
        payload.surfaceId,
        revision,
        widgetElement?.type,
        widgetEventLayerSlots,
        widgetLogicEvents,
    ]);

    const elementPreviews = useMemo(() => {
        const activeIr = editor.graphView ? ir : null;
        if (!activeIr) {
            return {};
        }
        const uiDocument = blueprintDocumentService.getDocument();
        const previews: Record<string, NonNullable<BlueprintFlowNodeData["elementPreview"]>> = {};
        for (const node of Object.values(activeIr.nodes ?? {})) {
            if (!isElementBindingNodeType(node.type)) {
                continue;
            }
            const ref = readBlueprintElementRefParams(node.params);
            const element = ref ? uiDocument.elements[ref.elementId] : undefined;
            const surface = ref ? uiDocument.surfaces.find(item => item.id === ref.surfaceId) : undefined;
            if (!ref || !element || !surface) {
                continue;
            }
            const revisionKey = `${node.id}:${ref.surfaceId}:${ref.elementId}:${uiDocumentRevision}`;
            previews[node.id] = {
                revisionKey,
                name: element.name?.trim() || element.type,
                type: element.type,
                text: typeof element.props?.text === "string" ? element.props.text : undefined,
                layout: {
                    width: element.layout.width,
                    height: element.layout.height,
                },
                preview: (
                    <ElementLiteralSurfacePreview
                        key={revisionKey}
                        runtimeBridge={runtimeBridge}
                        document={uiDocument}
                        surface={surface}
                        element={element}
                    />
                ),
            };
        }
        return previews;
    }, [blueprintDocumentService, editor.graphView, ir, runtimeBridge, uiDocumentRevision]);

    const displayableTargetVariantsByNodeId = useMemo(() => {
        const activeIr = editor.graphView ? ir : null;
        if (!activeIr) {
            return {};
        }
        const currentDocument = blueprintDocumentService.getDocument();
        const out: Record<string, BlueprintFlowNodeData["displayableTargetVariants"]> = {};
        for (const node of Object.values(activeIr.nodes ?? {})) {
            if (node.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT) {
                const label = widgetElement?.name?.trim() || widgetElement?.type;
                out[node.id] = elementVariantOptions(widgetElement, label);
                continue;
            }
            if (node.type !== BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT) {
                continue;
            }
            const edge = activeIr.edges?.find(item => item.to.nodeId === node.id && item.to.port === "element");
            if (!edge) {
                out[node.id] = {
                    supported: false,
                    options: [],
                    message: "Connect an Element ref to preview variants",
                };
                continue;
            }
            const sourceNode = activeIr.nodes?.[edge.from.nodeId];
            if (!sourceNode || !isElementBindingNodeType(sourceNode.type) || edge.from.port !== "element") {
                out[node.id] = {
                    supported: false,
                    options: [],
                    message: "Static Element target required for variant list",
                };
                continue;
            }
            const ref = readBlueprintElementRefParams(sourceNode.params);
            const element = ref ? currentDocument.elements[ref.elementId] : undefined;
            const label = element?.name?.trim() || element?.type;
            out[node.id] = elementVariantOptions(element, label);
        }
        return out;
    }, [blueprintDocumentService, editor.graphView, ir, revision, uiDocumentRevision, widgetElement]);

    const dynamicSelectOptionsByNodeId = useMemo(() => {
        const activeIr = editor.graphView ? ir : null;
        if (!activeIr) {
            return {};
        }
        const currentDocument = blueprintDocumentService.getDocument();
        const out: Record<string, Record<string, BlueprintInspectorParamSelectOption[]>> = {};
        for (const node of Object.values(activeIr.nodes ?? {})) {
            if (
                node.type !== BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE &&
                node.type !== BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE
            ) {
                continue;
            }
            out[node.id] = {
                [BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE]: listBlueprintSetFramePageTargetOptions({
                    document: currentDocument,
                    owner: bp.owner,
                    ir: activeIr,
                    nodeId: node.id,
                    nodeType: node.type,
                }),
            };
        }
        return out;
    }, [blueprintDocumentService, bp.owner, editor.graphView, ir, revision, uiDocumentRevision]);

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

    const blueprintPersistentVariables = useMemo(() => {
        return Object.values(doc.persistentVariables ?? {})
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(variable => ({
                id: variable.id,
                name: variable.name,
                value: variable.id,
                valueType: variable.valueType,
            }));
    }, [doc, revision]);

    const blueprintMembersSig = useMemo(
        () =>
            [
                blueprintMemberVariables
                    .map(v => `${v.value}:${v.name}:${v.valueType ?? ""}:${v.disambiguationLabel ?? ""}`)
                    .join("|"),
                blueprintPersistentVariables
                    .map(v => `${v.value}:${v.name}:${v.valueType ?? ""}`)
                    .join("|"),
            ].join("||"),
        [blueprintMemberVariables, blueprintPersistentVariables],
    );

    const dynamicSelectOptions = useMemo<Record<string, BlueprintInspectorParamSelectOption[]>>(() => {
        const uiDocument = blueprintDocumentService.getDocument();
        const surfaceOptions: BlueprintInspectorParamSelectOption[] = uiDocument.surfaces
            .filter(s => s.kind === "appSurface")
            .map(s => ({ value: s.id, label: s.name || "Untitled surface" }));
        const storyEntries = storyService.listStories();
        const storyOptions: BlueprintInspectorParamSelectOption[] = storyEntries
            .map(story => ({ value: story.id, label: story.name || "Untitled story" }));
        const storySceneOptions: BlueprintInspectorParamSelectOption[] = [];
        for (const story of storyEntries) {
            const storyDocument = storyDocumentsById[story.id];
            if (!storyDocument) {
                continue;
            }
            const orderedSceneIds: string[] = [];
            const seenSceneIds = new Set<string>();
            for (const chapter of storyDocument.chapters) {
                for (const sceneId of chapter.sceneIds) {
                    if (!seenSceneIds.has(sceneId) && storyDocument.scenes[sceneId]) {
                        seenSceneIds.add(sceneId);
                        orderedSceneIds.push(sceneId);
                    }
                }
            }
            for (const sceneId of Object.keys(storyDocument.scenes).sort()) {
                if (!seenSceneIds.has(sceneId)) {
                    seenSceneIds.add(sceneId);
                    orderedSceneIds.push(sceneId);
                }
            }
            for (const sceneId of orderedSceneIds) {
                const scene = storyDocument.scenes[sceneId];
                if (!scene) {
                    continue;
                }
                storySceneOptions.push({
                    value: scene.id,
                    label: scene.name || scene.runtimeName || "Untitled scene",
                    meta: { storyId: story.id },
                });
            }
        }
        const opts: Record<string, BlueprintInspectorParamSelectOption[]> = {
            surfaces: surfaceOptions,
            stories: storyOptions,
            storyScenes: storySceneOptions,
            callableFns: listCallableBlueprintFnOptions({
                blueprintDocument: doc,
                uiDocument,
                caller: bp.owner,
            }),
            ...nodeCatalog.getDynamicSelectOptions(),
        };
        if (
            (payload.ownerKind === "widgetMain" || payload.ownerKind === "componentWidgetMain") &&
            payload.surfaceId
        ) {
            const surface = uiDocument.surfaces.find(s => s.id === payload.surfaceId);
            if (surface) {
                const collectElements = (rootId: string): BlueprintInspectorParamSelectOption[] => {
                    const result: BlueprintInspectorParamSelectOption[] = [];
                    const visit = (id: string) => {
                        const el = uiDocument.elements[id];
                        if (!el) return;
                        if (el.type !== "nl.root") {
                            result.push({ value: el.id, label: el.name || el.type });
                        }
                        for (const cid of el.childrenIds) visit(cid);
                    };
                    visit(rootId);
                    return result;
                };
                opts.elements = collectElements(surface.rootElementId);
            }
        }
        return opts;
    }, [
        blueprintDocumentService,
        revision,
        payload.ownerKind,
        payload.surfaceId,
        storyService,
        storyDocumentsById,
        storyLibraryRevision,
        nodeCatalog,
        dynamicSelectOptionsRevision,
        doc,
        bp.owner,
    ]);

    const resolveCallableFnSignature = useCallback(
        (fnRef: string) => {
            const currentDoc = localBp.getBlueprintDocument();
            const decl = findBlueprintFnByRef(currentDoc, fnRef);
            if (!decl || !isBlueprintFnVisibleToOwner(decl.owner, bp.owner)) {
                return null;
            }
            return buildBlueprintFnSignatureSnapshot(decl);
        },
        [localBp, bp.owner],
    );

    // Heal stale Call Fn signature snapshots when this blueprint is opened. Cross-blueprint
    // signature changes are pull-based: same-graph edits sync on commit, other graphs are
    // covered by the fn.call_signature_stale diagnostic until reopened or re-picked.
    useEffect(() => {
        const currentDoc = localBp.getBlueprintDocument();
        const currentBp = currentDoc.blueprints[payload.blueprintId];
        if (!currentBp || currentBp.program.kind !== "graph") {
            return;
        }
        for (const [graphId, eventGraph] of Object.entries(currentBp.program.graphs.events ?? {})) {
            const staleSnapshots = new Map<string, ReturnType<typeof buildBlueprintFnSignatureSnapshot>>();
            for (const [nodeId, node] of Object.entries(eventGraph.graph?.nodes ?? {})) {
                if (node.type !== BLUEPRINT_NODE_TYPE_FN_CALL) {
                    continue;
                }
                const fnRef = node.params?.[BLUEPRINT_NODE_PARAM_FN_REF];
                if (typeof fnRef !== "string" || fnRef.length === 0) {
                    continue;
                }
                const decl = findBlueprintFnByRef(currentDoc, fnRef);
                if (!decl || !isBlueprintFnVisibleToOwner(decl.owner, currentBp.owner)) {
                    // Missing/out-of-scope targets stay untouched — validation reports the error.
                    continue;
                }
                if (isBlueprintFnSnapshotStale(readBlueprintFnSignatureSnapshot(node.params), decl)) {
                    staleSnapshots.set(nodeId, buildBlueprintFnSignatureSnapshot(decl));
                }
            }
            if (staleSnapshots.size === 0) {
                continue;
            }
            localBp.updateEventGraphIr(payload.blueprintId, graphId, draft => {
                for (const [nodeId, snapshot] of staleSnapshots) {
                    const node = draft.nodes?.[nodeId];
                    if (!node) {
                        continue;
                    }
                    node.params = { ...(node.params ?? {}), [BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT]: snapshot };
                }
            });
        }
    }, [localBp, payload.blueprintId]);

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
                            <span className="truncate font-mono text-2xs text-fg-muted">{bp.name}</span>
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
            <span className="truncate font-mono text-2xs text-fg-muted">{bp.name}</span>
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
                        blueprintPersistentVariables={blueprintPersistentVariables}
                        selectedNodeIds={editor.selectedNodeIds}
                        onSelectNodeIds={editor.setSelectedNodeIds}
                        onCommitIr={commitIr}
                        onAddNodeAtFlowPosition={onAddGraphNodeAtFlowPosition}
                        paletteContext={paletteContext}
                        deleteKeyCode={memberPanelFocusContained ? null : undefined}
                        dynamicSelectOptions={dynamicSelectOptions}
                        dynamicSelectOptionsByNodeId={dynamicSelectOptionsByNodeId}
                        diagnostics={diagnostics}
                        elementPreviews={elementPreviews}
                        displayableTargetVariantsByNodeId={displayableTargetVariantsByNodeId}
                        onBindElementLiteral={onBindElementLiteral}
                        initialViewport={initialFlowViewport}
                        onViewportChange={onFlowViewportChange}
                        currentBlueprintId={payload.blueprintId}
                        resolveCallableFnSignature={resolveCallableFnSignature}
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
            <div className="flex h-full min-h-0 items-center justify-center text-xs text-fg-subtle">
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
