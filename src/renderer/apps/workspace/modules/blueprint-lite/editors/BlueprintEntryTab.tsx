import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { MotionConfig } from "motion/react";
import { getActiveBrandPalette } from "@shared/brand/brandRegistry";
import { useTranslation, type UseTranslation } from "@/lib/i18n";
import { useOpenBlueprintTarget } from "../hooks/useOpenBlueprintTarget";
import { updateDetachedEditorPayload } from "@/apps/workspace/detached/detachedEditors";
import {
    findEditorGroupIdForTab,
    findEditorTabTitle,
    useDetachBlueprintEditor,
} from "@/apps/workspace/detached/detachBlueprintEditor";
import { useIsDetachedHost } from "@/lib/components/layout";
import { EditorComponentProps } from "../../types";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import { useKeybindings, whenEditorFocused } from "@/apps/workspace/hooks";
import { isDeferredWriteAllowed, useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useRegistry } from "@/apps/workspace/registry";
import type { EditorLayout } from "@/apps/workspace/registry/types";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { VariableRegistryService } from "@/lib/workspace/services/variables/VariableRegistryService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { AudioTrackService } from "@/lib/workspace/services/audio/AudioTrackService";
import type { AppTagService } from "@/lib/workspace/services/appTag/AppTagService";
import type { DlcService } from "@/lib/workspace/services/dlc/DlcService";
import { DLC_OPTIONS_SOURCE } from "@/lib/ui-editor/blueprint-nodes/built-in/dlcNodes";
import { BLUEPRINT_AUDIO_TRACK_OPTIONS_SOURCE } from "@/lib/ui-editor/blueprint-nodes/built-in/soundNodes";
import { BLUEPRINT_COMPONENT_PARAM_OPTIONS_SOURCE } from "@/lib/ui-editor/blueprint-nodes/built-in/componentNodes";
import { LocalizationService } from "@/lib/workspace/services/localization/LocalizationService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";
import type { BlueprintEntryTabPayload } from "../blueprintEntryTabId";
import type { Blueprint, BlueprintGraphIr } from "@shared/types/blueprint/document";
import type { StoryDocument } from "@shared/types/story";
import { listSceneIdsInDocumentOrder, listStoryEndings } from "@shared/types/story";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { getUIComponentParams } from "@shared/types/ui-editor/document";
import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import { findOwningListItemTemplate } from "@shared/types/ui-editor/listItemContext";
import { isListLikeWidgetType } from "@shared/types/ui-editor/list";
import { resolveUIStruct } from "@shared/types/ui-editor/builtinStructs";
import { uiStructFieldLabel } from "@shared/types/ui-editor/struct";
import { BLUEPRINT_LIST_ITEM_FIELD_OPTIONS_SOURCE } from "@/lib/ui-editor/blueprint-nodes/built-in/listNodes";
import {
    BLUEPRINT_INPUT_ACTION_OPTIONS_SOURCE,
    listBlueprintInputActionOptions,
} from "@/lib/ui-editor/blueprint-nodes/built-in/inputActionNodes";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import type { BlueprintInspectorParamDef } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    applyBlueprintIrConnection,
    captureBlueprintNodePinSnapshots,
    createGraphNodeForPalette,
    ensureBlueprintGraphIr,
    graphIrHasFunctionEntry,
    writeNodeEditorLayout,
} from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import { buildBlueprintGraphContext } from "@/lib/ui-editor/behavior-graph/nodeEditorCatalog";
import { useBlueprintDocumentRevision } from "../hooks/useBlueprintDocumentRevision";
import {
    BlueprintGraphAddressProvider,
    UINodeClaimsProvider,
    useUINodeClaimHold,
} from "../blueprintLiveSession";
import type { LiveSessionService } from "@/lib/workspace/services/live/LiveSessionService";
import {
    normalizeBlueprintMinimapPreference,
    type BlueprintMinimapPreference,
} from "../flow/blueprintMinimapPreference";
import { useBlueprintDiagnostics } from "../hooks/useBlueprintDiagnostics";
import { useBlueprintDragConnectSettings } from "../hooks/useBlueprintDragConnectSettings";
import { useBlueprintEditorState, type BlueprintEditorGraphView } from "../state/useBlueprintEditorState";
import { BlueprintEditorLayout } from "../components/BlueprintEditorLayout";
import { BlueprintMemberTree, type BlueprintVariableGroupKey } from "../components/BlueprintMemberTree";
import {
    BlueprintLayerDialogContent,
    createDefaultBlueprintLayerValue,
    type BlueprintLayerDialogValue,
} from "../components/BlueprintLayerDialogContent";
import { BlueprintDiagnosticsPanel } from "../components/BlueprintDiagnosticsPanel";
import { BlueprintBreakpointScope } from "../components/BlueprintBreakpointScope";
import {
    BlueprintFlowCanvas,
    cloneBlueprintIr,
    removeBlueprintNodeFromIr,
    type BlueprintFlowViewport,
} from "../flow/BlueprintFlowCanvas";
import type { BlueprintFlowNodeData } from "../flow/components/BlueprintFlowNode";
import { BlueprintGraphToolbar } from "../components/BlueprintGraphToolbar";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { ScriptSourceView } from "../ts/ScriptPreviewEditor";
import { blueprintContract } from "@shared/blueprint/ownerShape";
import type { FileSystemService } from "@/lib/workspace/services/core/FileSystem";
import {
    scriptBindingsByRef,
    walkProjectScripts,
} from "@/lib/workspace/services/ui-editor/blueprint/projectScripts";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type {
    BlueprintInspectorParamSelectOption,
    BlueprintMagicElementRefPaletteEntry,
    BlueprintNodeEditorCatalogEntry,
} from "@/lib/ui-editor/blueprint-nodes/types";
import { BLUEPRINT_NODE_PARAM_SHOW_MAGIC_ELEMENT_TARGET_PIN } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID,
    BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_SET_VARIANT,
    BLUEPRINT_NODE_TYPE_ELEMENT_FRAME_SET_PAGE,
    BLUEPRINT_NODE_TYPE_ELEMENT_REF,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_CLICK,
    BLUEPRINT_NODE_TYPE_EVENT_HEAD_ELEMENT_FLUSH,
    BLUEPRINT_NODE_TYPE_FLOW_COMMENT,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_FRAME_WIDGET_SET_PAGE,
    BLUEPRINT_NODE_TYPE_GAME_GET_CHARACTER,
    readBlueprintFnSignatureSnapshot,
} from "@shared/types/blueprint/graph";
import {
    buildBlueprintFnSignatureSnapshot,
    isBlueprintFnSnapshotStale,
    listCallableBlueprintFnOptions,
    resolveBlueprintFnCallTarget,
} from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import {
    ELEMENT_REF_PARAM_ELEMENT_ID,
    ELEMENT_REF_PARAM_ELEMENT_TYPE,
    ELEMENT_REF_PARAM_SURFACE_ID,
    readBlueprintElementRefParams,
} from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";
import { UISurfaceEditorTab } from "@/apps/workspace/modules/ui-editor/editors/UISurfaceEditorTab";
import { FileCode2, PanelsTopLeft, SquareArrowOutUpRight } from "lucide-react";
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
import {
    buildAccessibleBlueprintVariableOptions,
    listEffectiveBlueprintVariables,
} from "@/lib/workspace/services/ui-editor/blueprint/blueprintVariableRefs";
import { anchorElementId, isWidgetEventGraph } from "@shared/blueprint/ownerShape";
import { resolveWidgetEventLayerSlotsForPalette } from "./blueprintPaletteContext";
import {
    buildBlueprintGraphClipboardPayload,
    pasteBlueprintGraphClipboardPayload,
    setBlueprintGraphClipboard,
    type BlueprintGraphClipboardPayload,
} from "@/lib/workspace/services/ui-editor/blueprint/graphClipboard";
import {
    graphClipboardSourceStamp,
    importForeignGraphAssets,
    publishGraphClipboard,
    readGraphClipboardEnvironment,
    reportForeignGraphPaste,
    resolveGraphPasteSource,
    type ForeignGraphPasteReport,
} from "@/lib/workspace/services/ui-editor/blueprint/graphClipboardBridge";
import {
    BLUEPRINT_FRAME_TARGET_SURFACE_OPTIONS_SOURCE,
    listBlueprintSetFramePageTargetOptions,
} from "@/lib/ui-editor/blueprint-nodes/frameTargetSurfaceOptions";
import { interfaceDocumentFreezeScope, useLiveUndoOverride } from "../../ui-editor/uiLiveSession";

function getActiveIr(bp: Blueprint, view: BlueprintEditorGraphView | null): BlueprintGraphIr | null {
    if (!view) {
        return null;
    }
    if (view.kind === "event") {
        const layer = bp.graphs.events[view.graphId];
        // A script layer has no graph to hand back, and the canvas shows its file instead.
        return layer && !layer.script ? ensureBlueprintGraphIr(layer.graph) : null;
    }
    return ensureBlueprintGraphIr(bp.graphs.functions[view.graphId]?.graph);
}

function getGraphToolbarLabel(bp: Blueprint, view: BlueprintEditorGraphView | null): string {
    if (!view) {
        return "";
    }
    if (view.kind === "event") {
        const name = bp.graphs.events[view.graphId]?.name ?? view.graphId;
        return `Event · ${name}`;
    }
    const name = bp.graphs.functions[view.graphId]?.name ?? view.graphId;
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
/**
 * The graph overview's size and whether it is up.
 *
 * One record for every blueprint rather than one per graph: it is a preference about the editor,
 * not about a particular layer, and an overview that came and went as the author moved between
 * layers would read as a bug rather than a setting.
 */
const BLUEPRINT_EDITOR_MINIMAP_STATE_ID = "blueprintEditor.minimap";
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
    targetLabel: string | undefined,
    t: UseTranslation["t"],
): NonNullable<BlueprintFlowNodeData["displayableTargetVariants"]> {
    if (!element) {
        return {
            supported: false,
            options: [],
            message: t("blueprint.displayable.variant.targetMissing"),
        };
    }
    const appearance = (element.props as { appearance?: unknown } | undefined)?.appearance;
    if (!isAppearanceModel(appearance)) {
        return {
            supported: false,
            targetLabel,
            options: [],
            message: t("blueprint.displayable.variant.unsupportedNamed", {
                name: targetLabel ?? element.name ?? element.type,
            }),
        };
    }
    return {
        supported: true,
        targetLabel,
        options: appearance.variants.map((variant, index) => ({
            value: variant.id,
            label: variant.name?.trim() || t("blueprint.displayable.variant.fallbackName", { index: index + 1 }),
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
    const { t } = useTranslation();
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
    // `nl-motion-keep` for the same reason the UI editor's canvas carries it (see the exemption note
    // in styles.css): what is drawn here is the game's own widget, and `ui.reduceMotion` is a
    // promise about Studio's chrome rather than about the thing being authored. It costs no calm —
    // this preview is inert (`editorChrome: false`, `pointer-events-none`, nothing changes state on
    // it), so the tag holds the rule rather than restarting any motion.
    const rendered = runtimeBridge.renderDocumentSurface({
        document: previewDocument,
        surfaceId: previewSurfaceId,
        hostAdapter: { host: surface.host },
        className: "nl-motion-keep pointer-events-none select-none",
        style: { backgroundColor: "transparent" },
        editorChrome: false,
    });

    if (!rendered) {
        return (
            <div className="flex h-[72px] w-full items-center justify-center rounded-sm bg-surface-sunken text-2xs text-fg-subtle">
                {t("blueprint.canvas.previewUnavailable")}
            </div>
        );
    }

    return (
        <div className="relative flex h-[72px] w-full items-center justify-center overflow-hidden rounded-sm bg-surface-sunken">
            <div
                className="relative overflow-hidden rounded-sm border border-edge shadow-sm"
                style={{
                    width: frameWidth,
                    height: frameHeight,
                    // Resolved rather than used as stored: a surface background can be a brand link,
                    // and an `nlbrand:` token in a CSS declaration paints nothing at all. The white
                    // default stays this thumbnail's own - `getSurfaceBackgroundColor` answers
                    // `transparent` for an unset stage surface, which is right on the canvas and
                    // would leave a hole here.
                    backgroundColor: getActiveBrandPalette().resolveValueCss(surface.settings?.backgroundColor ?? "") ?? "#ffffff",
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
                    {/* The other half of the exemption: the widget renderers animate from
                        framer-motion, which no CSS rule reaches. Renders no node of its own. */}
                    <MotionConfig reducedMotion="never">{rendered}</MotionConfig>
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
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    // Subscribe so the wrapper re-evaluates (and can unmount the inner editor) on deletion.
    useBlueprintDocumentRevision();

    if (!isInitialized || !context || !props.payload?.blueprintId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
                {t("blueprint.tab.invalid")}
            </div>
        );
    }
    const localBp = context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    if (!localBp.getBlueprintDocument().blueprints[props.payload.blueprintId]) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-warning">
                {t("blueprint.tab.notFound", { id: props.payload.blueprintId })}
            </div>
        );
    }
    return <BlueprintEntryTabInner key={props.payload.blueprintId} {...props} />;
}

function BlueprintEntryTabInner({ tabId, payload }: EditorComponentProps<BlueprintEntryTabPayload | undefined>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab } = useRegistry();
    /** Already in a window of its own: the pop-out control has nothing left to offer. */
    const isDetachedHost = useIsDetachedHost();
    const detachBlueprint = useDetachBlueprintEditor();
    const revision = useBlueprintDocumentRevision();
    // The canvas and its cards carry their own clamp (`BlueprintFlowCanvas`, `BlueprintFlowNode`);
    // what is left in this file is the keyboard, the empty state and one on-open normalisation.
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    const undoOverride = useLiveUndoOverride();
    const live = useMemo(
        () => (context && isInitialized ? context.services.get<LiveSessionService>(Services.Live) : null),
        [context, isInitialized],
    );

    if (!isInitialized || !context || !payload?.blueprintId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-fg-muted">
                {t("blueprint.tab.invalid")}
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
    const characterService = context.services.get<CharacterService>(Services.Character);
    const variableRegistry = context.services.get<VariableRegistryService>(Services.VariableRegistry);
    const audioTrackService = context.services.get<AudioTrackService>(Services.AudioTracks);
    const appTagService = context.services.get<AppTagService>(Services.AppTags);
    const dlcService = context.services.get<DlcService>(Services.Dlc);
    // DLC live in a project document of their own, so adding or renaming one has to reach the
    // `Is DLC Installed` picker without anything touching the blueprint.
    const [dlcRevision, setDlcRevision] = useState(0);
    useEffect(
        () => dlcService.onDlcChanged(() => setDlcRevision(r => r + 1)),
        [dlcService],
    );
    // The declared addresses live in the variants document, so adding one has to reach the
    // `Open Link` picker without anything touching the blueprint.
    const [appTagRevision, setAppTagRevision] = useState(0);
    useEffect(
        () => appTagService.onTagsChanged(() => setAppTagRevision(r => r + 1)),
        [appTagService],
    );
    // Persistent variables live in the M-VAR registry; its edits do not bump the blueprint revision.
    const [registryRevision, setRegistryRevision] = useState(0);
    useEffect(() => variableRegistry.onRegistryChanged(() => setRegistryRevision(r => r + 1)), [variableRegistry]);
    // Audio tracks are a project document of their own, so renaming or adding one has to reach the
    // `Play Sound` picker without anything touching the blueprint.
    const [audioTrackRevision, setAudioTrackRevision] = useState(0);
    useEffect(
        () => audioTrackService.onTracksChanged(() => setAudioTrackRevision(r => r + 1)),
        [audioTrackService],
    );
    const [uiDocumentRevision, setUiDocumentRevision] = useState(() => uidoc.getRevision());
    const [storyDocumentsById, setStoryDocumentsById] = useState<Record<string, StoryDocument>>({});
    const [storyLibraryRevision, setStoryLibraryRevision] = useState(0);
    const [dynamicSelectOptionsRevision, setDynamicSelectOptionsRevision] = useState(0);
    // The `characters` source is reactive: renaming or deleting a character while a blueprint tab is
    // open has to be visible in the picker, otherwise a stale list is the only evidence the author
    // ever sees that the reference they are about to pick no longer exists.
    const [characterLibraryRevision, setCharacterLibraryRevision] = useState(0);
    useEffect(
        () => characterService.subscribe(() => setCharacterLibraryRevision(value => value + 1)),
        [characterService],
    );
    const [memberPanelState, setMemberPanelState] = useState<BlueprintEditorMemberPanelState>(() =>
        normalizeBlueprintEditorMemberPanelState(
            panelStateService.getPanelState<Partial<BlueprintEditorMemberPanelState>>(
                BLUEPRINT_EDITOR_MEMBER_PANEL_STATE_ID,
            ),
        ),
    );
    const [minimapPreference, setMinimapPreference] = useState<BlueprintMinimapPreference>(() =>
        normalizeBlueprintMinimapPreference(
            panelStateService.getPanelState<Partial<BlueprintMinimapPreference>>(
                BLUEPRINT_EDITOR_MINIMAP_STATE_ID,
            ),
        ),
    );
    const onMinimapChange = useCallback(
        (next: BlueprintMinimapPreference) => {
            setMinimapPreference(next);
            panelStateService.replacePanelState<BlueprintMinimapPreference>(
                BLUEPRINT_EDITOR_MINIMAP_STATE_ID,
                next,
            );
        },
        [panelStateService],
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
        anchorElementId(bp.owner) !== null && payload.elementId
            ? uiDocument.elements[payload.elementId]
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
    /**
     * Which graph the canvas is drawing, for the cards to resolve their own claims against.
     *
     * Node ids are not unique across the document - the seeded entry nodes use fixed ids, and
     * `global.appBoot` is in every project - so a card asking "is anybody in me" has to name the
     * blueprint and the graph as well as itself.
     */
    const graphAddress = useMemo(
        () => (editor.graphView ? { blueprintId: payload.blueprintId, graphId: editor.graphView.graphId } : null),
        [editor.graphView, payload.blueprintId],
    );
    // One node, the first of a selection: a rubber-band over forty cards is a gesture about their
    // arrangement rather than about anything written in them. Silent outside a session.
    useUINodeClaimHold({
        service: live,
        blueprintId: graphAddress?.blueprintId ?? null,
        graphId: graphAddress?.graphId ?? null,
        nodeId: editor.selectedNodeIds.length === 1 ? editor.selectedNodeIds[0] : null,
    });
    const diagnostics = useBlueprintDiagnostics(doc, payload.blueprintId, revision + registryRevision, {
        widgetElement,
        // The same document the palette walks, so the two agree about which element a list draws.
        uiDocument,
        widgetSurfaceId: payload.surfaceId,
        widgetBlueprintEvents: widgetLogicEvents,
        isComponentDefinitionGraph,
        // REGISTRY ONLY, and deliberately not the merged persistent view the story surfaces read.
        //
        // A blueprint `persistentVariableId` is resolved at runtime against the table the bundle
        // carries (`bundle.ui.persistentVariables`), which `loadPersistentVariableTable` builds from
        // `editor/variables.json` alone - a story `/persis` row is not in it. Accepting a story row's
        // id here would silence the "unknown persistent variable" warning on a node that throws
        // "Persistent variable not found" the moment it executes, which is the one case the
        // diagnostic exists for.
        persistentVariables: localBp.listPersistentVariables(),
        // Same reasoning, other scope: a saved id is resolved against the `saved` half of the registry,
        // so the picker's options and the diagnostic's accepted set have to be the one same list.
        savedVariables: localBp.listSavedVariables(),
    });
    const openBlueprint = useOpenBlueprintTarget();
    const dragConnectCreate = useBlueprintDragConnectSettings();
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
                title: t("blueprint.tab.title"),
                focusEventId: session.graphKind === "event" ? session.graphId : undefined,
                focusFunctionId: session.graphKind === "function" ? session.graphId : undefined,
                focusNodeId: session.nodeId,
            });
        };
        handleCompletion();
        return subscribeElementBindingSession(handleCompletion);
    }, [localBp, openBlueprint, payload, tabId, t]);

    const reopenRevision = useCallback(
        (blueprintId: string) => {
            openBlueprint({
                blueprintId,
                ownerKind: payload.ownerKind,
                surfaceId: payload.surfaceId,
                componentId: payload.componentId,
                elementId: payload.elementId,
                propPath: payload.propPath,
                title: t("blueprint.tab.title"),
            });
        },
        [openBlueprint, payload, t],
    );

    /**
     * The layer on screen, when it is one of the author's files rather than a graph.
     *
     * There is no separate script tab any more, and there is nothing for one to be: a slot is one
     * blueprint, its layers are a graph or a file, and the tab is the slot. A tab per script was
     * what the model needed while a script displaced the blueprint it sat in.
     */
    const activeScriptLayer =
        editor.graphView?.kind === "event" ? bp.graphs.events[editor.graphView.graphId]?.script ?? null : null;

    const ir = getActiveIr(bp, editor.graphView);
    const activeIrRef = useRef<BlueprintGraphIr | null>(null);
    activeIrRef.current = ir;

    const commitIr = useCallback(
        (next: BlueprintGraphIr, history?: { mergeKey?: string; mergeWindowMs?: number }) => {
            if (!editor.graphView) {
                return;
            }
            // Keep every plugin node's recorded pin shape current while its plugin is loaded, so the
            // node stays legible if that plugin is later removed. A no-op once the shapes are settled.
            captureBlueprintNodePinSnapshots(next);
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

    // The project behind a copy and a paste: what stamps a payload with where it came from, and
    // what a foreign one is compared against. Read at each gesture rather than once, because a
    // service that was still coming up when this tab mounted is available by the time the author
    // presses anything - and a null cached then would cost the editor its cross-project reach for
    // as long as the tab stayed open.
    const readGraphClipboard = useCallback(() => readGraphClipboardEnvironment(context), [context]);

    /**
     * Fill both clipboards from the current selection, or answer null when it holds nothing.
     *
     * The in-window payload is written first and synchronously, so the copy has happened by the time
     * the gesture returns; the platform clipboard is filled behind it, which is what carries the
     * fragment to another project's window.
     */
    const fillGraphClipboard = useCallback(
        (activeIr: BlueprintGraphIr): BlueprintGraphClipboardPayload | null => {
            const environment = readGraphClipboard();
            const clipboard = buildBlueprintGraphClipboardPayload(activeIr, editor.selectedNodeIds, {
                copyId: uuid.generate(),
                ...(environment ? { source: graphClipboardSourceStamp(environment) } : {}),
            });
            if (!clipboard) {
                return null;
            }
            setBlueprintGraphClipboard(clipboard);
            if (environment) {
                publishGraphClipboard(environment, clipboard);
            }
            return clipboard;
        },
        [editor.selectedNodeIds, readGraphClipboard, uuid],
    );

    const copySelectedGraphNodes = useCallback(() => {
        if (isTypingInField()) {
            return;
        }
        const activeIr = activeIrRef.current;
        if (activeIr) {
            fillGraphClipboard(activeIr);
        }
    }, [fillGraphClipboard]);

    const cutSelectedGraphNodes = useCallback(() => {
        if (isTypingInField()) {
            return;
        }
        const activeIr = activeIrRef.current;
        if (!activeIr) {
            return;
        }
        const clipboard = fillGraphClipboard(activeIr);
        if (!clipboard) {
            return;
        }
        const next = cloneBlueprintIr(activeIr);
        for (const nodeId of clipboard.nodeIds) {
            removeBlueprintNodeFromIr(next, nodeId);
        }
        commitIr(next);
        editor.setSelectedNodeIds([]);
    }, [commitIr, editor, fillGraphClipboard]);

    /**
     * Paste whatever the author last copied, from this window or from another project's.
     *
     * Asynchronous because the platform clipboard and the file transfer both are, and the freeze is
     * re-read after each await: nodes written into a frozen workspace reach the in-memory blueprint,
     * are refused at the file-system boundary, and are gone again at the thaw. The graph is read
     * from the ref rather than captured, so the paste lands on what the editor holds now.
     */
    const pasteGraphNodes = useCallback(() => {
        if (isTypingInField()) {
            return;
        }
        void (async () => {
            const environment = readGraphClipboard();
            const source = await resolveGraphPasteSource(environment);
            if (!source || environment?.isFrozen()) {
                return;
            }
            let imported: ForeignGraphPasteReport = { imported: 0, frozen: false };
            if (source.foreign) {
                imported = await importForeignGraphAssets(source);
                if (imported.frozen || environment?.isFrozen()) {
                    return;
                }
            }
            const activeIr = activeIrRef.current;
            if (!activeIr) {
                return;
            }
            const pasted = pasteBlueprintGraphClipboardPayload({
                ir: activeIr,
                payload: source.payload,
                generateId: () => uuid.generate(),
                targetBlueprintId: payload.blueprintId,
            });
            if (!pasted) {
                return;
            }
            commitIr(pasted.ir);
            editor.setSelectedNodeIds(pasted.newNodeIds);
            if (source.foreign) {
                reportForeignGraphPaste(source, imported);
            }
        })();
    }, [commitIr, editor, readGraphClipboard, uuid, payload.blueprintId]);

    // A keystroke has no button to grey out, so `freeze.run` is how these are refused: undo, redo,
    // cut and paste all rewrite the graph, and on a frozen project they moved nodes about on screen
    // and threw the result away on thaw - a graph that visibly edits itself and then does not.
    // Copy is left alone: it only fills the clipboard, which is the author's, not the project's.
    const blueprintKeybindings = useMemo(
        () => [
            // `mod` resolves to ⌘/Ctrl per platform, replacing the ctrl/meta twin
            // registrations this list used to carry.
            {
                id: "undo",
                key: "mod+z",
                handler: freeze.run(() => {
                    if (isTypingInField()) {
                        return;
                    }
                    if (undoOverride) {
                        // A live session owns undo. This editor's own stack holds whole-blueprint
                        // snapshots of a document only this author ever had, so restoring one would
                        // delete every node anybody else has added since. See `useLiveUndoOverride`.
                        undoOverride.undo();
                        return;
                    }
                    localBp.undoBlueprint(payload.blueprintId);
                }),
            },
            {
                id: "redo",
                key: "mod+shift+z",
                handler: freeze.run(() => {
                    if (isTypingInField()) {
                        return;
                    }
                    if (undoOverride) {
                        undoOverride.redo();
                        return;
                    }
                    localBp.redoBlueprint(payload.blueprintId);
                }),
            },
            {
                id: "copy",
                key: "mod+c",
                handler: copySelectedGraphNodes,
            },
            {
                id: "cut",
                key: "mod+x",
                handler: freeze.run(cutSelectedGraphNodes),
            },
            {
                id: "paste",
                key: "mod+v",
                handler: freeze.run(pasteGraphNodes),
            },
        ],
        [
            copySelectedGraphNodes,
            cutSelectedGraphNodes,
            freeze,
            localBp,
            pasteGraphNodes,
            payload.blueprintId,
            undoOverride,
        ],
    );

    useKeybindings({
        keybindings: blueprintKeybindings,
        enabled: Boolean(payload.blueprintId),
        when: whenEditorFocused(tabId),
        idPrefix: `blueprint-editor-${tabId}`,
        catalogPrefix: "blueprint.",
    });

    const persistGraphViewToTabPayload = useCallback(
        (graphView: BlueprintEditorGraphView | null) => {
            const nextPayload = buildBlueprintPayloadWithGraphFocus(payload, graphView);
            if (hasSameBlueprintGraphFocus(payload, nextPayload)) {
                return;
            }
            // Detached, this editor has no tab to write to; its restore payload takes the state
            // instead, so which graph was open survives the trip back to the workspace.
            if (updateDetachedEditorPayload(tabId, nextPayload)) {
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

    /**
     * Move this editor out of the tab strip and into a window of its own.
     *
     * The entry goes in first and the tab closes second: the detached host mounts the window from
     * that entry, and closing the tab is what unmounts this component, so the other order would
     * tear the editor down before anything had been asked to rebuild it elsewhere.
     */
    const detachToOwnWindow = useCallback(() => {
        if (isDetachedHost) {
            return;
        }
        // The same route a right click on any blueprint entry takes, so the window this editor
        // moves into is named, keyed and restored exactly like one opened from outside.
        detachBlueprint({
            blueprintId: payload.blueprintId,
            ownerKind: payload.ownerKind,
            surfaceId: payload.surfaceId,
            componentId: payload.componentId,
            elementId: payload.elementId,
            propPath: payload.propPath,
            // Carried across so closing the window puts back the tab that was here, name included -
            // this editor is opened under several names (the blueprint's own, the widget it belongs
            // to), and re-deriving one would rename it on the way back.
            title:
                findEditorTabTitle(uiService.getStore().getEditorLayout(), tabId)
                ?? t("blueprint.tab.title"),
        });
    }, [detachBlueprint, isDetachedHost, payload, t, tabId, uiService]);

    /**
     * Middle click on the title row detaches, matching the control beside it.
     *
     * Only on the title row: the canvas already spends the middle button on panning, and a stray
     * click there while panning would throw the editor into a window the author never asked for.
     */
    const onHeaderAuxClick = useCallback(
        (event: ReactMouseEvent) => {
            if (event.button !== 1 || isDetachedHost) {
                return;
            }
            event.preventDefault();
            detachToOwnWindow();
        },
        [detachToOwnWindow, isDetachedHost],
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

    /**
     * The node behind a group: a comment card in frame mode, at the rectangle the canvas measured
     * around the selection.
     *
     * `background: false` is what puts it behind its members - a frame drawn on the node layer
     * would tint every card it encloses. There is no group record anywhere; a frame and the cards
     * that happen to sit inside it are all a group ever is, which is why creating one is a single
     * ordinary node write and undoes like one.
     */
    const onCreateGroupFrame = useCallback(
        (frame: {
            x: number;
            y: number;
            width: number;
            height: number;
            color: string;
            name: string;
        }): string | undefined => {
            if (!editor.graphView) {
                return undefined;
            }
            const id = uuid.generate();
            const node = createGraphNodeForPalette(BLUEPRINT_NODE_TYPE_FLOW_COMMENT, id);
            node.params = {
                ...(node.params ?? {}),
                text: frame.name,
                color: frame.color,
                background: false,
                frame: true,
                width: frame.width,
                height: frame.height,
            };
            writeNodeEditorLayout(node, { x: frame.x, y: frame.y });
            const mut = (draft: BlueprintGraphIr) => {
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

    const onAddGraphNodeAtFlowPositionAndConnect = useCallback(
        (
            entry: BlueprintNodeEditorCatalogEntry,
            flowPosition: { x: number; y: number },
            connect: {
                existingNodeId: string;
                existingHandleId: string;
                existingHandleType: "source" | "target";
                newNodePinId: string;
            },
        ): string | undefined => {
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
                draft.nodes = { ...(draft.nodes ?? {}), [node.id]: node };
                // Wire the dragged pin to the new node. The dragged pin's direction decides which
                // end of the edge the new node is: an output pin feeds the new node's input, an
                // input pin is fed by the new node's output.
                const wiring =
                    connect.existingHandleType === "source"
                        ? {
                              source: connect.existingNodeId,
                              sourceHandle: connect.existingHandleId,
                              target: node.id,
                              targetHandle: connect.newNodePinId,
                          }
                        : {
                              source: node.id,
                              sourceHandle: connect.newNodePinId,
                              target: connect.existingNodeId,
                              targetHandle: connect.existingHandleId,
                          };
                draft.edges = applyBlueprintIrConnection(draft, wiring);
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

    /**
     * Every file under `scripts/`, with how many layers already run it.
     *
     * Read when the dialog is opened rather than held: a file can arrive without Studio - an author
     * writes one in their own editor - and opening the dialog is the only moment that can be
     * noticed. Files nothing runs and files something runs are both offered, because a file two
     * layers share is a legitimate arrangement and hiding it makes it look like Studio lost track.
     */
    const listScriptFilesWithUse = useCallback(async () => {
        const fs = context.services.get<FileSystemService>(Services.FileSystem);
        const files = await walkProjectScripts(async relative => {
            const result = await fs.list(context.project.resolve(relative.split("/")));
            return result.ok ? result.data : null;
        });
        const bound = scriptBindingsByRef(localBp.getBlueprintDocument());
        return files.map(scriptRef => ({ scriptRef, usedBy: bound.get(scriptRef)?.length ?? 0 }));
    }, [context, localBp]);

    /**
     * Declare a layer, having asked which of the two it is.
     *
     * The one place that choice is made. It used to live under a "revisions" list beside the
     * blueprint, where picking a script displaced the whole blueprint and its graphs went inactive;
     * here a script joins the layer list like any other layer and the graphs beside it keep running.
     */
    const onAddEvent = useCallback(async () => {
        const defaultLayerName = t("blueprint.eventLayer.defaultName", { index: eventIds.length + 1 });
        // A value binding is re-run whenever a dependency changes, and only a graph has a palette
        // cut down to the nodes that are safe to re-run - so it is the one slot with no choice.
        const scriptAllowed = blueprintContract(bp.owner).invocation !== "valueBinding";
        const scriptFiles = scriptAllowed ? await listScriptFilesWithUse() : [];

        let selection: BlueprintLayerDialogValue = createDefaultBlueprintLayerValue(defaultLayerName);
        const selected = await new Promise<BlueprintLayerDialogValue | null>(resolve => {
            let dialogId: string | null = null;
            let settled = false;
            const safeResolve = (value: BlueprintLayerDialogValue | null) => {
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
                    uiService.showNotification(t("blueprint.eventLayer.createInvalid"), "warning");
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
                title: t("blueprint.eventLayer.createTitle"),
                content: (
                    <BlueprintLayerDialogContent
                        defaultName={defaultLayerName}
                        scriptFiles={scriptFiles}
                        scriptAllowed={scriptAllowed}
                        onChange={value => {
                            selection = value;
                        }}
                    />
                ),
                closable: true,
                width: 460,
                buttons: [
                    { label: t("common.cancel"), onClick: handleCancel },
                    { label: t("common.create"), primary: true, onClick: handleCreate },
                ],
                onClose: handleCancel,
            });
        });
        if (!selected) {
            return;
        }
        if (selected.kind === "script") {
            // Not inside a history transaction: writing the starter file is a disk write that no
            // undo can take back, so the document edit stands alone the way every other one does.
            const layerId = await localBp.addScriptLayer(payload.blueprintId, {
                existingScriptRef: selected.scriptRef ?? undefined,
            });
            selectEventGraph(layerId);
            return;
        }
        const id = uuid.generate();
        localBp.ensureEventGraph(payload.blueprintId, id, selected.name);
        selectEventGraph(id);
    }, [
        bp.owner,
        eventIds.length,
        listScriptFilesWithUse,
        localBp,
        payload.blueprintId,
        selectEventGraph,
        uiService,
        uuid,
        t,
    ]);

    const onDeleteLayer = useCallback(
        (layerId: string) => {
            const wasActive = editor.graphView?.kind === "event" && editor.graphView.graphId === layerId;
            localBp.runBlueprintHistoryTransaction(payload.blueprintId, () => {
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
        [clearGraphView, editor.graphView, localBp, payload.blueprintId, selectEventGraph],
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

    /** The node the diagnostics list last asked the canvas to reveal; see {@link onDiagnosticPick}. */
    const [diagnosticNodeFocus, setDiagnosticNodeFocus] = useState<{ nodeId: string; nonce: number } | null>(null);

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
                    const nodeId = t.nodeId;
                    editor.setSelectedNodeIds([nodeId]);
                    // Selecting a node off screen selects something the author cannot see. The nonce
                    // is what makes clicking the same row twice bring it back after a pan.
                    setDiagnosticNodeFocus(previous => ({ nodeId, nonce: (previous?.nonce ?? 0) + 1 }));
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
            owner: bp.owner,
            widgetElement,
            graphView: editor.graphView,
            widgetBlueprintEvents: widgetLogicEvents,
        });
    }, [bp.owner, editor.graphView, widgetElement, widgetLogicEvents]);

    const paletteContext = useMemo(() => {
        const gk = editor.graphView?.kind ?? "event";
        const activeIr = editor.graphView ? ir : null;
        const magicElementRefs = collectMagicElementRefs({
            ir: activeIr,
            document: blueprintDocumentService.getDocument(),
            surfaceId: payload.surfaceId,
        });
        return buildBlueprintGraphContext({
            graphKind: gk,
            owner: bp.owner,
            widgetElement,
            uiDocument,
            widgetBlueprintEvents: widgetLogicEvents,
            widgetEventLayerSlots,
            hasEventHead: false,
            hasFunctionEntry: gk === "function" && activeIr ? graphIrHasFunctionEntry(activeIr) : false,
            magicElementRefs,
            isComponentDefinitionGraph,
        });
    }, [
        blueprintDocumentService,
        bp.owner,
        editor.graphView,
        ir,
        isComponentDefinitionGraph,
        payload.surfaceId,
        revision,
        uiDocument,
        widgetElement,
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
                out[node.id] = elementVariantOptions(widgetElement, label, t);
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
                    message: t("blueprint.displayable.variant.connectElement"),
                };
                continue;
            }
            const sourceNode = activeIr.nodes?.[edge.from.nodeId];
            if (!sourceNode || !isElementBindingNodeType(sourceNode.type) || edge.from.port !== "element") {
                out[node.id] = {
                    supported: false,
                    options: [],
                    message: t("blueprint.displayable.variant.staticRequired"),
                };
                continue;
            }
            const ref = readBlueprintElementRefParams(sourceNode.params);
            const element = ref ? currentDocument.elements[ref.elementId] : undefined;
            const label = element?.name?.trim() || element?.type;
            out[node.id] = elementVariantOptions(element, label, t);
        }
        return out;
    }, [blueprintDocumentService, editor.graphView, ir, revision, uiDocumentRevision, widgetElement, t]);

    const dynamicSelectOptionsByNodeId = useMemo(() => {
        const activeIr = editor.graphView ? ir : null;
        if (!activeIr) {
            return {};
        }
        const currentDocument = blueprintDocumentService.getDocument();
        const out: Record<string, Record<string, BlueprintInspectorParamSelectOption[]>> = {};

        /**
         * Which list one field picker is asking about.
         *
         * Three shapes, in the order a node can carry them: a node wired to an Element follows that
         * wire, a node on a list's own blueprint is asking about that list, and a node inside an
         * item template is asking about the list drawing it. An unwired Element pin resolves to
         * nothing, which leaves the picker empty rather than offering another list's fields.
         */
        const resolveFieldPickerList = (node: { id: string; type: string }): UIElement | undefined => {
            const edge = activeIr.edges?.find(item => item.to.nodeId === node.id && item.to.port === "list");
            if (edge) {
                const sourceNode = activeIr.nodes?.[edge.from.nodeId];
                const ref = sourceNode ? readBlueprintElementRefParams(sourceNode.params) : null;
                return ref ? currentDocument.elements[ref.elementId] : undefined;
            }
            if (widgetElement && isListLikeWidgetType(widgetElement.type)) {
                return widgetElement;
            }
            const context = findOwningListItemTemplate(currentDocument, widgetElement);
            return context ? currentDocument.elements[context.listElementId] : undefined;
        };
        // Built lazily: most graphs have no Get Character node, and listing the cast per projection
        // would be pure cost for them.
        let characterOptions: BlueprintInspectorParamSelectOption[] | null = null;
        for (const node of Object.values(activeIr.nodes ?? {})) {
            const def = blueprintNodeRegistry.get(node.type);
            if (def?.inspectorParams?.some((param: BlueprintInspectorParamDef) => param.dynamicOptionsSource === BLUEPRINT_INPUT_ACTION_OPTIONS_SOURCE)) {
                out[node.id] = {
                    [BLUEPRINT_INPUT_ACTION_OPTIONS_SOURCE]: listBlueprintInputActionOptions({
                        document: currentDocument,
                        pickedId: String(node.params?.[BLUEPRINT_NODE_PARAM_INPUT_ACTION_ID] ?? ""),
                        unnamedLabel: t("blueprint.options.unnamedInputAction"),
                        missingLabel: () => t("blueprint.options.missingInputAction"),
                    }),
                };
                continue;
            }
            if (def?.inspectorParams?.some((param: BlueprintInspectorParamDef) => param.dynamicOptionsSource === BLUEPRINT_LIST_ITEM_FIELD_OPTIONS_SOURCE)) {
                const listElement = resolveFieldPickerList(node);
                const structId = (listElement?.props as Record<string, unknown> | undefined)?.itemStructId;
                const struct = resolveUIStruct(currentDocument, typeof structId === "string" ? structId : null);
                out[node.id] = {
                    [BLUEPRINT_LIST_ITEM_FIELD_OPTIONS_SOURCE]: (struct?.fields ?? []).map(field => ({
                        value: field.id,
                        label: uiStructFieldLabel(field),
                    })),
                };
                continue;
            }
            if (node.type === BLUEPRINT_NODE_TYPE_GAME_GET_CHARACTER) {
                const pickedId = String(node.params?.characterId ?? "").trim();
                if (!pickedId) {
                    continue;
                }
                characterOptions ??= characterService.listCharacter().map(character => ({
                    value: character.profile.getId(),
                    label: character.profile.getName().trim() || t("blueprint.options.unnamedCharacter"),
                }));
                if (characterOptions.some(option => option.value === pickedId)) {
                    continue;
                }
                // The character this node points at is gone. Append a stand-in so the picker keeps
                // showing the dangling id: without it the `<select>` falls back to the empty option
                // and a deleted reference looks exactly like one that was never set.
                out[node.id] = {
                    characters: [
                        ...characterOptions,
                        { value: pickedId, label: t("blueprint.options.missingCharacter") },
                    ],
                };
                continue;
            }
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
    }, [
        blueprintDocumentService,
        bp.owner,
        characterService,
        characterLibraryRevision,
        editor.graphView,
        ir,
        revision,
        t,
        uiDocumentRevision,
        widgetElement,
    ]);

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

    // A breakpoint condition may only test the blueprint's OWN variables: the debugger reads them
    // off the paused frame's locals by bare id, and a variable belonging to another blueprint is
    // reachable there only under its explicit `bp:` ref.
    const breakpointConditionVariables = useMemo(
        () =>
            listEffectiveBlueprintVariables(bp).map(variable => ({
                id: variable.id,
                name: variable.name || variable.id,
            })),
        [bp, revision],
    );

    // The node-param picker, and registry-only for the same reason the diagnostic above is: this list
    // is what an author may PICK, and every option in it has to be one the runtime table can resolve.
    const blueprintPersistentVariables = useMemo(() => {
        return localBp.listPersistentVariables()
            .map(variable => ({
                id: variable.id,
                name: variable.name,
                value: variable.id,
                valueType: variable.valueType,
            }));
    }, [localBp, registryRevision]);

    /** The `Get/Set Saved Var` picker; the saved half of the same registry, offered on the same terms. */
    const blueprintSavedVariables = useMemo(() => {
        return localBp.listSavedVariables()
            .map(variable => ({
                id: variable.id,
                name: variable.name,
                value: variable.id,
                valueType: variable.valueType,
            }));
    }, [localBp, registryRevision]);

    const blueprintMembersSig = useMemo(
        () =>
            [
                blueprintMemberVariables
                    .map(v => `${v.value}:${v.name}:${v.valueType ?? ""}:${v.disambiguationLabel ?? ""}`)
                    .join("|"),
                blueprintPersistentVariables
                    .map(v => `${v.value}:${v.name}:${v.valueType ?? ""}`)
                    .join("|"),
                blueprintSavedVariables
                    .map(v => `${v.value}:${v.name}:${v.valueType ?? ""}`)
                    .join("|"),
            ].join("||"),
        [blueprintMemberVariables, blueprintPersistentVariables, blueprintSavedVariables],
    );

    const dynamicSelectOptions = useMemo<Record<string, BlueprintInspectorParamSelectOption[]>>(() => {
        const uiDocument = blueprintDocumentService.getDocument();
        const surfaceOptions: BlueprintInspectorParamSelectOption[] = uiDocument.surfaces
            .filter(s => s.kind === "appSurface")
            .map(s => ({ value: s.id, label: s.name || t("blueprint.options.untitledSurface") }));
        const storyEntries = storyService.listStories();
        const storyOptions: BlueprintInspectorParamSelectOption[] = storyEntries
            .map(story => ({ value: story.id, label: story.name || t("blueprint.options.untitledStory") }));
        const storySceneOptions: BlueprintInspectorParamSelectOption[] = [];
        // The `Is Option Picked` picker. Author order, same as the scene list above, and labelled
        // "<scene> / <option text>": an option's own text is rarely unique across a story ("Yes."
        // appears everywhere), so the scene it belongs to is what makes the row identifiable. The
        // VALUE is the option row's block id - a rewrite of the text must not invalidate a graph
        // that already points at it, which is the same reason the scene picker stores scene ids.
        const storyChoiceOptions: BlueprintInspectorParamSelectOption[] = [];
        // The ending picker, for `Is Ending Reached` / `Get Endings` / `Clear Ending State`.
        //
        // Built from `listStoryEndings` - the one scan the compiler emits from - rather than a
        // second walk of the blocks, so the picker can never offer an ending that is not in the
        // build. It skips disabled rows for the same reason.
        //
        // Labelled "<scene> / <ending>" like the option picker above: an ending's own name is rarely
        // unique across a story ("Bad End" appears more than once by design), so the scene it sits
        // in is what makes the row identifiable. The value is the ending row's block id, so
        // renaming an ending leaves every graph and every unlock pointing at it.
        const storyEndings: BlueprintInspectorParamSelectOption[] = [];
        for (const story of storyEntries) {
            const storyDocument = storyDocumentsById[story.id];
            if (!storyDocument) {
                continue;
            }
            // This used to compose chapters itself and then `.sort()` the leftovers, because key
            // order could not be trusted to be stable. Sorting UUIDs is stable but it is not the
            // author's order; `unassignedSceneIds` now carries that, so the picker can show it.
            for (const sceneId of listSceneIdsInDocumentOrder(storyDocument)) {
                const scene = storyDocument.scenes[sceneId];
                if (!scene) {
                    continue;
                }
                const sceneLabel = scene.name || scene.runtimeName || t("blueprint.options.untitledScene");
                storySceneOptions.push({
                    value: scene.id,
                    label: sceneLabel,
                    meta: { storyId: story.id },
                });
                // Block order within the scene, not `rootBlockIds` order: an option is a child of a
                // choice row, so a document-order walk would have to descend anyway, and the block
                // table is already the flat form of that.
                for (const block of Object.values(scene.blocks)) {
                    if (block?.kind !== "nodeAction" || block.payload.action !== "choiceOption") {
                        continue;
                    }
                    const optionText = block.payload.text.value.trim();
                    storyChoiceOptions.push({
                        value: block.id,
                        label: `${sceneLabel} / ${optionText || t("blueprint.options.untitledChoiceOption")}`,
                        meta: { storyId: story.id },
                    });
                }
            }
            // Document order too, but from the scan rather than this walk: an ending is a fact about
            // the whole story, and the scan is what decides which rows the build actually emits.
            for (const ending of listStoryEndings(storyDocument)) {
                const endingSceneLabel = ending.sceneName || t("blueprint.options.untitledScene");
                storyEndings.push({
                    value: ending.endingId,
                    label: `${endingSceneLabel} / ${ending.name || t("blueprint.options.untitledEnding")}`,
                    meta: { storyId: story.id },
                });
            }
        }
        // Named localization keys: pick by source text, key name as context.
        let localizationKeyOptions: BlueprintInspectorParamSelectOption[] = [];
        try {
            const keys = LocalizationService.getInstance().getKeysIfLoaded()?.keys ?? {};
            localizationKeyOptions = Object.entries(keys)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([name, definition]) => ({
                    value: name,
                    label: definition.sourceText.trim() ? `${definition.sourceText} (${name})` : name,
                }));
        } catch {
            // Outside a workspace context; no key options.
        }
        // The project's cast, for `Get Character`. Ids, not names: a rename must not invalidate a
        // graph that already points at the character.
        const characterOptions: BlueprintInspectorParamSelectOption[] = characterService
            .listCharacter()
            .map(character => ({
                value: character.profile.getId(),
                label: character.profile.getName().trim() || t("blueprint.options.unnamedCharacter"),
            }));
        const opts: Record<string, BlueprintInspectorParamSelectOption[]> = {
            surfaces: surfaceOptions,
            stories: storyOptions,
            storyScenes: storySceneOptions,
            storyChoiceOptions,
            storyEndings,
            // The `Is DLC Installed` picker. Author order, and the label is the DLC's name while the
            // stored value is its id - the id is the filename a player already has, so renaming a
            // DLC must not unpoint a graph.
            [DLC_OPTIONS_SOURCE]: dlcService.list().map(dlc => ({ value: dlc.id, label: dlc.name })),
            characters: characterOptions,
            localizationKeys: localizationKeyOptions,
            // The `Play Sound` Track picker. Author order, built-ins first - the same order the
            // project Audio surface shows, so the first row here is the one an author looks for.
            [BLUEPRINT_AUDIO_TRACK_OPTIONS_SOURCE]: audioTrackService
                .listTracks()
                .map(track => ({ value: track.id, label: track.name })),
            callableFns: listCallableBlueprintFnOptions({
                blueprintDocument: doc,
                uiDocument,
                caller: bp.owner,
            }),
            ...nodeCatalog.getDynamicSelectOptions(),
        };
        // The params of the component this blueprint belongs to, for `Get Component Param`. Ids, not
        // names: the id is what the node stores, so renaming a param must not unpoint a graph.
        if (payload.ownerKind === "componentWidgetMain" && payload.componentId) {
            const component = uiDocument.components?.find(item => item.id === payload.componentId);
            opts[BLUEPRINT_COMPONENT_PARAM_OPTIONS_SOURCE] = getUIComponentParams(component).map(param => ({
                value: param.id,
                label: param.name.trim() || param.id,
            }));
        }
        if (isWidgetEventGraph(bp.owner) && payload.surfaceId) {
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
        bp.owner,
        payload.ownerKind,
        payload.surfaceId,
        payload.componentId,
        storyService,
        storyDocumentsById,
        storyLibraryRevision,
        characterService,
        characterLibraryRevision,
        audioTrackService,
        audioTrackRevision,
        dlcRevision,
        dlcService,
        appTagService,
        appTagRevision,
        nodeCatalog,
        dynamicSelectOptionsRevision,
        doc,
        bp.owner,
        t,
    ]);

    const resolveCallableFnSignature = useCallback(
        (fnRef: string) => {
            const currentDoc = localBp.getBlueprintDocument();
            const decl = resolveBlueprintFnCallTarget(currentDoc, fnRef, bp.owner);
            return decl ? buildBlueprintFnSignatureSnapshot(decl) : null;
        },
        [localBp, bp.owner],
    );

    // Heal stale Call Fn signature snapshots when this blueprint is opened. Cross-blueprint
    // signature changes are pull-based: same-graph edits sync on commit, other graphs are
    // covered by the fn.call_signature_stale diagnostic until reopened or re-picked.
    //
    // Deferred, not refused, while the workspace is frozen: nobody asked for this write, so merely
    // opening a blueprint on a frozen project raised "Nothing is being saved right now" about the
    // editor's own bookkeeping. `frozen` is an input of the effect, so the heal runs the moment the
    // workspace is writable again - sound because whatever snapshot was stale still is.
    useEffect(() => {
        if (!isDeferredWriteAllowed(freeze.frozen)) {
            return;
        }
        const currentDoc = localBp.getBlueprintDocument();
        const currentBp = currentDoc.blueprints[payload.blueprintId];
        if (!currentBp) {
            return;
        }
        for (const [graphId, eventGraph] of Object.entries(currentBp.graphs.events ?? {})) {
            const staleSnapshots = new Map<string, ReturnType<typeof buildBlueprintFnSignatureSnapshot>>();
            for (const [nodeId, node] of Object.entries(eventGraph.graph?.nodes ?? {})) {
                if (node.type !== BLUEPRINT_NODE_TYPE_FN_CALL) {
                    continue;
                }
                const fnRef = node.params?.[BLUEPRINT_NODE_PARAM_FN_REF];
                if (typeof fnRef !== "string" || fnRef.length === 0) {
                    continue;
                }
                const decl = resolveBlueprintFnCallTarget(currentDoc, fnRef, currentBp.owner);
                if (!decl) {
                    // A target that does not resolve is left exactly as it is: the graph editor and
                    // `blueprint/fn-target-missing` both report it, and the stored snapshot is the
                    // only remaining record of what it used to name.
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
    }, [freeze.frozen, localBp, payload.blueprintId]);

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

    /**
     * The pop-out control, absent once the editor is already in its own window.
     *
     * Its middle-click twin is on the whole title row (`onHeaderAuxClick`), so the gesture works
     * anywhere along the row rather than only on this 24px square.
     */
    const detachAction = isDetachedHost ? null : (
        <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-sm text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg"
            onClick={detachToOwnWindow}
            data-tip={t("blueprint.header.detach")}
            aria-label={t("blueprint.header.detach")}
        >
            <SquareArrowOutUpRight className="h-4 w-4" />
        </button>
    );

    const header = (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5" data-tip={contextTitle}>
            <span className="text-sm font-semibold text-fg">{t("blueprint.header.title")}</span>
            <span className="truncate font-mono text-2xs text-fg-muted">{bp.name}</span>
        </div>
    );

    const canvas =
        activeScriptLayer ? (
            <ScriptSourceView scriptRef={activeScriptLayer.scriptRef} />
        ) : editor.graphView && ir ? (
            <BlueprintBreakpointScope
                projectPath={context.project.getConfig().projectPath}
                blueprintId={payload.blueprintId}
                graphId={editor.graphView.graphId}
                ir={ir}
                variables={breakpointConditionVariables}
            >
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
                        blueprintSavedVariables={blueprintSavedVariables}
                        selectedNodeIds={editor.selectedNodeIds}
                        onSelectNodeIds={editor.setSelectedNodeIds}
                        focusNodeId={diagnosticNodeFocus?.nodeId ?? null}
                        focusNonce={diagnosticNodeFocus?.nonce}
                        onCommitIr={commitIr}
                        onAddNodeAtFlowPosition={onAddGraphNodeAtFlowPosition}
                        dragConnectCreate={dragConnectCreate}
                        onAddNodeAtFlowPositionAndConnect={onAddGraphNodeAtFlowPositionAndConnect}
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
                        minimap={minimapPreference}
                        onMinimapChange={onMinimapChange}
                        currentBlueprintId={payload.blueprintId}
                        resolveCallableFnSignature={resolveCallableFnSignature}
                        onCreateGroupFrame={onCreateGroupFrame}
                    />
                </div>
            </div>
            </BlueprintBreakpointScope>
        ) : !hasAnyGraph ? (
            <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-4 py-8">
                <button
                    type="button"
                    className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-primary/10"
                    onClick={onAddEvent}
                    // Declaring a layer writes the blueprint, the same as the member panel's New
                    // button beside it - which was already refused while this one was not, so an
                    // empty frozen blueprint offered a layer it could not keep.
                    {...freeze.writes()}
                >
                    {t("blueprint.canvas.addLayer")}
                </button>
            </div>
        ) : (
            <div className="flex h-full min-h-0 items-center justify-center text-xs text-fg-subtle">
                {t("blueprint.canvas.selectLayer")}
            </div>
        );

    return (
        <UINodeClaimsProvider>
        <BlueprintGraphAddressProvider value={graphAddress}>
        <div
            className="h-full min-h-0"
            onMouseDownCapture={focusBlueprintEditor}
            onFocusCapture={focusBlueprintEditor}
        >
            <BlueprintEditorLayout
                header={header}
                helpTopic={activeScriptLayer ? "scripts" : "blueprints"}
                headerActions={detachAction}
                onHeaderAuxClick={onHeaderAuxClick}
                memberPanelCollapsed={memberPanelState.memberPanelCollapsed}
                onMemberPanelCollapsedChange={setMemberPanelCollapsed}
                onMemberPanelFocusContainedChange={setMemberPanelFocusContained}
                memberTree={
                    <div className="flex min-h-0 flex-col gap-3">
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
                    </div>
                }
                canvas={canvas}
                diagnostics={<BlueprintDiagnosticsPanel diagnostics={diagnostics} onPick={onDiagnosticPick} />}
            />
        </div>
        </BlueprintGraphAddressProvider>
        </UINodeClaimsProvider>
    );
}
