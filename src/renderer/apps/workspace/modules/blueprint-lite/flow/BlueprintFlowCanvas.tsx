import "@xyflow/react/dist/style.css";
import {
    forwardRef,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
    type PointerEvent as ReactPointerEvent,
} from "react";
import {
    ReactFlow,
    Background,
    MiniMap,
    PanOnScrollMode,
    ReactFlowProvider,
    SelectionMode,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Connection,
    type Edge,
    type FinalConnectionState,
    type Node,
    type Viewport,
} from "@xyflow/react";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { blueprintBreakpointKey } from "@shared/types/blueprint/breakpoints";
import { ContextMenu, type ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { useTranslation } from "@/lib/i18n";
import {
    buildBreakpointContextMenu,
    BREAKPOINT_MENU_ROW_IDS,
} from "@/lib/ui-editor/blueprint-debug/breakpointContextMenu";
import { useBlueprintBreakpointScope } from "@/lib/ui-editor/blueprint-debug/BlueprintBreakpointsContext";
import {
    BLUEPRINT_NODE_PARAM_FN_REF,
    BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE,
    BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT,
    BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY,
    BLUEPRINT_NODE_TYPE_FN_CALL,
    BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR,
    BLUEPRINT_NODE_TYPE_LOCAL_GET,
    BLUEPRINT_NODE_TYPE_LOCAL_SET,
    readBlueprintFnSignatureSnapshot,
    type BlueprintFnSignatureSnapshot,
} from "@shared/types/blueprint/graph";
import { resolveBlueprintVariableDefaultValue } from "@shared/types/blueprint/variableTypes";
import {
    applyBlueprintIrConnection,
    createGraphNodeForPalette,
    isValidBlueprintIrExecConnection,
    writeNodeEditorLayout,
} from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import {
    pickBlueprintDragConnectTargetPin,
    resolveBlueprintDragConnectSource,
    type BlueprintDragConnectEnablement,
    type BlueprintDragConnectSource,
} from "@/lib/workspace/services/ui-editor/blueprint/blueprintDragConnect";
import { freezeContextMenuRows, useFreezeGuard } from "../../../components/ui/freezeGuard";
import { editableTextTarget } from "../../../components/EditableTextContextMenu";
import { blueprintFlowNodeTypes } from "./nodeTypes";
import {
    applyBlueprintFlowNodeSelection,
    applyFlowPositionsToIr,
    blueprintDynamicSelectOptionsByNodeSignature,
    blueprintElementPreviewsSignature,
    blueprintIrToFlowEdges,
    blueprintIrToFlowNodes,
    blueprintSelectedNodesDependencyKey,
    blueprintSelectionIdsEqual,
    type BlueprintDynamicSelectOptionsByNodeId,
} from "./useBlueprintFlowProjection";
import type { BlueprintFlowNodeData } from "./components/BlueprintFlowNode";
import { BlueprintCanvasToolbar, type BlueprintCanvasTool } from "./components/BlueprintCanvasToolbar";
import { BLUEPRINT_COMMENT_DEFAULT_COLOR } from "./blueprintCommentColors";
import { layoutBlueprintGraph, type BlueprintLayoutDirection } from "./blueprintAutoLayout";
import {
    blueprintGroupMemberIds,
    computeBlueprintGroupFrame,
    refitBlueprintGroupFrames,
    type BlueprintFrameBox,
} from "./blueprintGroupFrame";
import { BlueprintAddNodeMenu } from "../components/BlueprintAddNodeMenu";
import { SaveSchemaFieldsModal } from "../components/SaveSchemaFieldsModal";
import {
    generateNextDynamicInputPinIds,
    getDynamicInputPinRemovalIds,
    readDynamicInputPinIds,
    readDynamicInputPinLabels,
    readDynamicInputPinValueTypes,
} from "@/lib/ui-editor/blueprint-nodes/effectivePins";
import {
    buildBlueprintFnSignatureSnapshotFromIr,
    parseBlueprintFnRef,
} from "@/lib/workspace/services/ui-editor/blueprint/fnCatalog";
import {
    BLUEPRINT_NODE_PARAM_DISPLAYABLE_ANIMATION_FROM_EXPLICIT,
    BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
    type BlueprintInspectorParamSelectOption,
    type BlueprintNodeEditorCatalogEntry,
    type BlueprintPaletteContext,
} from "@/lib/ui-editor/blueprint-nodes/types";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import type { BlueprintGraphVariableTypeInferenceContext } from "@/lib/workspace/services/ui-editor/blueprint/graphVariableTypeInference";

/** Ephemeral React Flow node while choosing drop position — not in BlueprintGraphIr until commit. */
const BP_PLACEMENT_PREVIEW_ID = "__bp_placement_preview__";

/**
 * Which mouse buttons drag the canvas itself.
 *
 * Middle-drag pans under either tool - that gesture predates the toolbar and nothing about it
 * changes. The hand tool adds the left button, which is the whole of what "hand" means here: a drag
 * on empty canvas moves the view instead of drawing a marquee. `selectionOnDrag` has to come off at
 * the same time, because React Flow gives the marquee priority whenever both are on.
 *
 * Module constants, not inline arrays: React Flow compares this prop by identity, and a fresh array
 * every render would tear down and rebuild d3-zoom's handlers on every keystroke in a node card.
 */
const PAN_BUTTONS_SELECT_TOOL = [1];
const PAN_BUTTONS_HAND_TOOL = [0, 1];

/** A node the way the group and layout geometry sees it: where it is and how big it measured. */
type BlueprintCanvasBox = BlueprintFrameBox & { isComment: boolean; isFrame: boolean };

/**
 * Measured boxes for every real node on the canvas.
 *
 * Unmeasured nodes are left out rather than defaulted to zero: a card React Flow has not sized yet
 * would read as a point, which is inside every frame and takes no room in a layer.
 */
function readBlueprintCanvasBoxes(nodes: readonly Node<BlueprintFlowNodeData>[]): BlueprintCanvasBox[] {
    const out: BlueprintCanvasBox[] = [];
    for (const node of nodes) {
        const width = node.measured?.width ?? 0;
        const height = node.measured?.height ?? 0;
        if (node.id === BP_PLACEMENT_PREVIEW_ID || width <= 0 || height <= 0) {
            continue;
        }
        const isComment = node.data.catalog.role === "comment";
        out.push({
            id: node.id,
            x: node.position.x,
            y: node.position.y,
            width,
            height,
            isComment,
            isFrame: isComment && node.data.params.frame === true,
        });
    }
    return out;
}

type BlueprintNodeParamHistoryOptions = { mergeKey?: string; mergeWindowMs?: number };

function generateUniqueDynamicPinLabel(existing: Record<string, string>, prefix: string): string {
    const used = new Set(Object.values(existing).map(label => label.trim()).filter(Boolean));
    let n = 1;
    for (;;) {
        const candidate = `${prefix}${n}`;
        if (!used.has(candidate)) {
            return candidate;
        }
        n += 1;
    }
}

function buildPlacementPreviewFlowNode(
    entry: BlueprintNodeEditorCatalogEntry,
    position: { x: number; y: number },
    memberVariables: BlueprintFlowNodeData["memberVariables"],
    persistentVariables: BlueprintFlowNodeData["persistentVariables"],
    savedVariables: BlueprintFlowNodeData["savedVariables"],
): Node<BlueprintFlowNodeData> {
    const stub = createGraphNodeForPalette(entry.type, BP_PLACEMENT_PREVIEW_ID);
    return {
        id: BP_PLACEMENT_PREVIEW_ID,
        type: "blueprint",
        position,
        zIndex: 2,
        draggable: false,
        selectable: false,
        focusable: false,
        style: { opacity: 0.92 },
        data: {
            catalog: entry,
            nodeId: BP_PLACEMENT_PREVIEW_ID,
            params: stub.params ?? {},
            memberVariables,
            persistentVariables,
            savedVariables,
            wiredInputPortIds: new Set(),
        },
    };
}

export function cloneBlueprintIr(ir: BlueprintGraphIr): BlueprintGraphIr {
    const c = structuredClone(ir);
    delete (c as { entries?: unknown }).entries;
    return c;
}

export function removeBlueprintNodeFromIr(ir: BlueprintGraphIr, nodeId: string): void {
    const nodes = { ...(ir.nodes ?? {}) };
    delete nodes[nodeId];
    ir.nodes = nodes;
    ir.edges = (ir.edges ?? []).filter(e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId);
}

type BlueprintFlowCanvasInnerProps = {
    nodeCatalog: IBlueprintNodeCatalogService;
    graphKey: string;
    ir: BlueprintGraphIr;
    revision: number;
    /** Bumps React Flow sync when blueprint member variables change (node card dropdowns). */
    blueprintMembersSig: string;
    blueprintMemberVariables: NonNullable<BlueprintFlowNodeData["memberVariables"]>;
    blueprintPersistentVariables: NonNullable<BlueprintFlowNodeData["persistentVariables"]>;
    blueprintSavedVariables: NonNullable<BlueprintFlowNodeData["savedVariables"]>;
    selectedNodeIds: readonly string[];
    onSelectNodeIds: (ids: string[]) => void;
    /**
     * A node to bring into view, on top of selecting it — what the diagnostics list asks for when an
     * error is clicked. Selection alone leaves the node wherever it was, which on a graph bigger
     * than the viewport is off screen.
     */
    focusNodeId?: string | null;
    /** Bumped by the caller to re-centre on the same node; ignored while unchanged. */
    focusNonce?: number;
    onCommitIr: (next: BlueprintGraphIr, history?: { mergeKey?: string; mergeWindowMs?: number }) => void;
    /**
     * When set, right-click on the pane opens a compact search menu. After picking a type, a preview follows
     * the cursor until click; this callback runs on confirm with the final flow position. Return the new id
     * to select the node.
     */
    onAddNodeAtFlowPosition?: (
        entry: BlueprintNodeEditorCatalogEntry,
        flowPosition: { x: number; y: number },
    ) => string | undefined;
    /**
     * Per-kind enablement for the "drag off a pin onto empty canvas → create a compatible node"
     * flow. When a kind is false, dropping such a pin on the pane does nothing (legacy behavior).
     */
    dragConnectCreate?: BlueprintDragConnectEnablement;
    /**
     * Drag-off-a-pin variant of {@link onAddNodeAtFlowPosition}: creates the node at `flowPosition`
     * and wires it to the pin the drag started from, in a single commit. Returns the new node id.
     */
    onAddNodeAtFlowPositionAndConnect?: (
        entry: BlueprintNodeEditorCatalogEntry,
        flowPosition: { x: number; y: number },
        connect: {
            existingNodeId: string;
            existingHandleId: string;
            existingHandleType: "source" | "target";
            newNodePinId: string;
        },
    ) => string | undefined;
    paletteContext: BlueprintPaletteContext;
    /** When null, Delete/Backspace do not remove nodes (e.g. while typing in the sidebar). */
    deleteKeyCode?: string[] | null;
    /**
     * Dynamic select options keyed by `dynamicOptionsSource` id (e.g. `"surfaces"`).
     * Populated from workspace context and forwarded to node cards.
     */
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>;
    /** Per-node dynamic select option overrides for cards whose choices depend on node wiring. */
    dynamicSelectOptionsByNodeId?: BlueprintDynamicSelectOptionsByNodeId;
    /** Active graph diagnostics, used to mark invalid nodes in-place. */
    diagnostics?: readonly BlueprintGraphEditorDiagnostic[];
    /** Preview data for bound Element Literal nodes by node id. */
    elementPreviews?: Record<string, BlueprintFlowNodeData["elementPreview"]>;
    /** Static Variant choices for Displayable Set Variant node cards by node id. */
    displayableTargetVariantsByNodeId?: Record<string, BlueprintFlowNodeData["displayableTargetVariants"]>;
    /** Starts Element Literal binding flow from a node card click. */
    onBindElementLiteral?: (nodeId: string) => void;
    /** Initial React Flow viewport restored from editor-session state. */
    initialViewport?: BlueprintFlowViewport | null;
    /** Called after pan/zoom changes so the owning editor tab can persist the view. */
    onViewportChange?: (viewport: BlueprintFlowViewport) => void;
    /** Active blueprint id; enables same-graph Fn signature snapshot sync on Call Fn nodes. */
    currentBlueprintId?: string;
    /** Resolves a callable fn signature (cross-blueprint) when a Call Fn picks a fnRef. */
    resolveCallableFnSignature?: (fnRef: string) => BlueprintFnSignatureSnapshot | null;
    /**
     * Adds the frame the toolbar's Group button draws around the current selection, and answers
     * with its node id so the canvas can select what it just made.
     *
     * The canvas works out the rectangle, because only it knows how big the selected cards measured
     * on screen; the owning tab makes the node, because only it can mint an id and reach the
     * blueprint document. Withheld (undefined) where grouping is not offered at all.
     */
    onCreateGroupFrame?: (frame: {
        x: number;
        y: number;
        width: number;
        height: number;
        color: string;
        name: string;
    }) => string | undefined;
};

export type BlueprintFlowViewport = {
    x: number;
    y: number;
    zoom: number;
};

function buildNodeDiagnosticsByNodeId(
    diagnostics: readonly BlueprintGraphEditorDiagnostic[] | undefined,
    graphKey: string,
): Map<string, BlueprintGraphEditorDiagnostic[]> {
    const out = new Map<string, BlueprintGraphEditorDiagnostic[]>();
    for (const d of diagnostics ?? []) {
        const target = d.target;
        if (target?.kind !== "node") {
            continue;
        }
        if (`${target.graphKind}:${target.graphId}` !== graphKey) {
            continue;
        }
        const list = out.get(target.nodeId) ?? [];
        list.push(d);
        out.set(target.nodeId, list);
    }
    return out;
}

function nodeDiagnosticsSignature(map: ReadonlyMap<string, readonly BlueprintGraphEditorDiagnostic[]>): string {
    return [...map.entries()]
        .map(([nodeId, items]) =>
            `${nodeId}:${items.map(d => `${d.severity}:${d.code ?? ""}:${d.message}`).sort().join("\x1f")}`,
        )
        .sort()
        .join("\x1e");
}

function displayableTargetVariantsSignature(
    map: Record<string, BlueprintFlowNodeData["displayableTargetVariants"]> | undefined,
): string {
    return Object.entries(map ?? {})
        .map(([nodeId, item]) =>
            `${nodeId}:${item?.supported ? "1" : "0"}:${item?.targetLabel ?? ""}:${item?.message ?? ""}:${
                item?.options.map(option => `${option.value}:${option.label}`).join("\x1f") ?? ""
            }`,
        )
        .sort()
        .join("\x1e");
}

/**
 * Keep Call Fn signature snapshots in sync with fn heads declared in the SAME graph.
 * Runs on every IR commit (covers param edits, pin add/remove, wiring, and Return node changes).
 * Cross-graph staleness is healed by the entry tab on open + the validation warning.
 */
function syncSameGraphFnCallSnapshots(ir: BlueprintGraphIr, currentBlueprintId: string | undefined): void {
    if (!currentBlueprintId) {
        return;
    }
    for (const node of Object.values(ir.nodes ?? {})) {
        if (node.type !== BLUEPRINT_NODE_TYPE_FN_CALL) {
            continue;
        }
        const parsed = parseBlueprintFnRef(node.params?.[BLUEPRINT_NODE_PARAM_FN_REF]);
        if (!parsed || parsed.blueprintId !== currentBlueprintId) {
            continue;
        }
        const snapshot = buildBlueprintFnSignatureSnapshotFromIr(ir, parsed.headNodeId);
        if (!snapshot) {
            continue;
        }
        const current = readBlueprintFnSignatureSnapshot(node.params);
        if (current && JSON.stringify(current) === JSON.stringify(snapshot)) {
            continue;
        }
        node.params = { ...(node.params ?? {}), [BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT]: snapshot };
    }
}

function BlueprintFlowCanvasInner({
    nodeCatalog,
    graphKey,
    ir,
    revision,
    blueprintMembersSig,
    blueprintMemberVariables,
    blueprintPersistentVariables,
    blueprintSavedVariables,
    selectedNodeIds,
    onSelectNodeIds,
    focusNodeId,
    focusNonce,
    onCommitIr,
    onAddNodeAtFlowPosition,
    dragConnectCreate,
    onAddNodeAtFlowPositionAndConnect,
    paletteContext,
    deleteKeyCode = ["Backspace", "Delete"],
    dynamicSelectOptions,
    dynamicSelectOptionsByNodeId,
    diagnostics,
    elementPreviews,
    displayableTargetVariantsByNodeId,
    onBindElementLiteral,
    initialViewport,
    onViewportChange,
    currentBlueprintId,
    resolveCallableFnSignature,
    onCreateGroupFrame,
}: BlueprintFlowCanvasInnerProps) {
    // React Flow derives document-wide ids from this (the dot-grid `<pattern>`, edge
    // markers, handle element ids, ARIA descriptions) and falls back to a literal "1"
    // when unset — so every un-id'd instance on the page collides, and `url(#pattern-1)`
    // resolves to whichever mounted first. Colons would break React Flow's own
    // querySelector lookups for handles, so strip them out of useId's output.
    const flowId = useId().replace(/:/g, "");
    // A frozen workspace makes the canvas' four mutating gestures inert - node drag, pin connect,
    // right-click-to-add, Delete - and leaves selection, panning, zoom and the minimap exactly as they
    // were. There is nothing to grey out on a drag, so the only honest affordance is that it never
    // starts; see `components/ui/freezeGuard`.
    const freeze = useFreezeGuard();
    const { t } = useTranslation();
    const { getNodes, screenToFlowPosition, fitView, getViewport, setViewport, setCenter } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<BlueprintFlowNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    /**
     * Which tool the toolbar has selected, which colour the next group takes, and which way the
     * next format runs.
     *
     * All three are view state and stay out of the document on purpose: the tool is where the
     * author's hand is right now, not something about the blueprint, and a colour or a direction
     * the toolbar remembers for the session is the difference between one click and two without
     * writing a preference nobody asked to set.
     */
    const [tool, setTool] = useState<BlueprintCanvasTool>("select");
    const [groupColor, setGroupColor] = useState<string>(BLUEPRINT_COMMENT_DEFAULT_COLOR);
    const [formatDirection, setFormatDirection] = useState<BlueprintLayoutDirection>("horizontal");
    const nodeDiagnosticsByNodeId = useMemo(
        () => buildNodeDiagnosticsByNodeId(diagnostics, graphKey),
        [diagnostics, graphKey],
    );
    const nodeDiagnosticsSig = useMemo(
        () => nodeDiagnosticsSignature(nodeDiagnosticsByNodeId),
        [nodeDiagnosticsByNodeId],
    );
    const displayableTargetVariantsSig = useMemo(
        () => displayableTargetVariantsSignature(displayableTargetVariantsByNodeId),
        [displayableTargetVariantsByNodeId],
    );
    const dynamicSelectOptionsByNodeSig = useMemo(
        () => blueprintDynamicSelectOptionsByNodeSignature(dynamicSelectOptionsByNodeId),
        [dynamicSelectOptionsByNodeId],
    );
    const elementPreviewsSig = useMemo(
        () => blueprintElementPreviewsSignature(elementPreviews),
        [elementPreviews],
    );
    const variableTypeContext = useMemo<BlueprintGraphVariableTypeInferenceContext>(
        () => ({
            memberVariables: blueprintMemberVariables,
            persistentVariables: blueprintPersistentVariables,
        }),
        [blueprintMemberVariables, blueprintPersistentVariables],
    );
    const variableTypeContextRef = useRef(variableTypeContext);
    variableTypeContextRef.current = variableTypeContext;
    const irRef = useRef(ir);
    irRef.current = ir;

    const commitBlueprintIr = useCallback(
        (next: BlueprintGraphIr, history?: { mergeKey?: string; mergeWindowMs?: number }) => {
            syncSameGraphFnCallSnapshots(next, currentBlueprintId);
            irRef.current = next;
            onCommitIr(next, history);
        },
        [currentBlueprintId, onCommitIr],
    );

    const patchNodeParam = useCallback(
        (nodeId: string, key: string, value: unknown, history?: BlueprintNodeParamHistoryOptions) => {
            const snap = cloneBlueprintIr(irRef.current);
            const n = snap.nodes?.[nodeId];
            if (!n) {
                return;
            }
            const next = { ...(n.params ?? {}) };
            if (value === undefined) {
                delete next[key];
            } else {
                next[key] = value;
            }
            if (
                key === "from" &&
                (n.type === BLUEPRINT_NODE_TYPE_DISPLAYABLE_ANIMATE_PROPERTY ||
                    n.type === BLUEPRINT_NODE_TYPE_ELEMENT_DISPLAYABLE_ANIMATE_PROPERTY)
            ) {
                if (value === undefined) {
                    delete next[BLUEPRINT_NODE_PARAM_DISPLAYABLE_ANIMATION_FROM_EXPLICIT];
                } else {
                    next[BLUEPRINT_NODE_PARAM_DISPLAYABLE_ANIMATION_FROM_EXPLICIT] = true;
                }
            }
            if (n.type === BLUEPRINT_NODE_TYPE_LOCAL_DECLARE_VAR && key === "valueType") {
                next.defaultValue = resolveBlueprintVariableDefaultValue(typeof value === "string" ? value : undefined);
                const variableId = typeof next.variableId === "string" ? next.variableId : undefined;
                for (const other of Object.values(snap.nodes ?? {})) {
                    if (
                        variableId &&
                        (other.type === BLUEPRINT_NODE_TYPE_LOCAL_GET || other.type === BLUEPRINT_NODE_TYPE_LOCAL_SET) &&
                        other.params?.variableId === variableId
                    ) {
                        const otherParams = { ...(other.params ?? {}) };
                        if (typeof value === "string") {
                            otherParams[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE] = value;
                        } else {
                            delete otherParams[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE];
                        }
                        other.params = otherParams;
                    }
                }
            }
            if (key === "variableId") {
                const selectedVariable =
                    typeof value === "string"
                        ? blueprintMemberVariables.find(variable => variable.value === value)
                        : undefined;
                if (selectedVariable?.valueType) {
                    next[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE] = selectedVariable.valueType;
                } else {
                    delete next[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE];
                }
            } else if (key === "persistentVariableId") {
                const selectedVariable =
                    typeof value === "string"
                        ? blueprintPersistentVariables.find(variable => variable.value === value)
                        : undefined;
                if (selectedVariable?.valueType) {
                    next[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE] = selectedVariable.valueType;
                } else {
                    delete next[BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE];
                }
            }
            if (n.type === BLUEPRINT_NODE_TYPE_FN_CALL && key === BLUEPRINT_NODE_PARAM_FN_REF) {
                // Snapshot the selected fn signature so pins render without document access
                // (same-graph refs are re-synced on every commit; cross-blueprint refs need this resolver).
                const snapshot =
                    typeof value === "string" && value.length > 0
                        ? resolveCallableFnSignature?.(value) ?? null
                        : null;
                if (snapshot) {
                    next[BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT] = snapshot;
                } else {
                    delete next[BLUEPRINT_NODE_PARAMS_FN_SIGNATURE_SNAPSHOT];
                }
            }
            n.params = next;
            commitBlueprintIr(snap, history);
        },
        [blueprintMemberVariables, blueprintPersistentVariables, commitBlueprintIr, resolveCallableFnSignature],
    );

    const patchNodeParamRef = useRef(patchNodeParam);
    patchNodeParamRef.current = patchNodeParam;
    /** Stable identity so IR sync effect does not re-run on every parent render (reduces jank). */
    const stablePatchNodeParam = useCallback(
        (nodeId: string, key: string, value: unknown, history?: BlueprintNodeParamHistoryOptions) => {
            patchNodeParamRef.current(nodeId, key, value, history);
        },
        [],
    );

    const nodeCatalogRef = useRef(nodeCatalog);
    nodeCatalogRef.current = nodeCatalog;

    const addDynamicInputPin = useCallback(
        (nodeId: string) => {
            const snap = cloneBlueprintIr(irRef.current);
            const n = snap.nodes?.[nodeId];
            if (!n) {
                return;
            }
            const def = nodeCatalogRef.current.get(n.type);
            const d = def?.dynamicInputPins;
            if (!def || !d) {
                return;
            }
            const params = { ...(n.params ?? {}) };
            const nextIds = generateNextDynamicInputPinIds(def, params);
            const list = [...readDynamicInputPinIds(params, d.storageKey), ...nextIds];
            params[d.storageKey] = list;
            if (d.pinLabelParamKey) {
                const labels = readDynamicInputPinLabels(params, d.pinLabelParamKey);
                const nextLabels = { ...labels };
                for (const nextId of nextIds) {
                    nextLabels[nextId] = generateUniqueDynamicPinLabel(
                        nextLabels,
                        d.defaultPinLabelPrefix ?? d.labelPrefix ?? "input",
                    );
                }
                params[d.pinLabelParamKey] = nextLabels;
            }
            n.params = params;
            commitBlueprintIr(snap);
        },
        [commitBlueprintIr],
    );

    const removeDynamicInputPin = useCallback(
        (nodeId: string, pinId: string) => {
            const snap = cloneBlueprintIr(irRef.current);
            const n = snap.nodes?.[nodeId];
            if (!n) {
                return;
            }
            const def = nodeCatalogRef.current.get(n.type);
            const d = def?.dynamicInputPins;
            if (!def || !d || d.fixedDataInputIds.includes(pinId)) {
                return;
            }
            if (!readDynamicInputPinIds(n.params, d.storageKey).includes(pinId)) {
                return;
            }
            const removalIds = getDynamicInputPinRemovalIds(def, n.params, pinId);
            const removalIdSet = new Set(removalIds);
            const params = { ...(n.params ?? {}) };
            const list = readDynamicInputPinIds(params, d.storageKey).filter(id => !removalIdSet.has(id));
            if (list.length > 0) {
                params[d.storageKey] = list;
            } else {
                delete params[d.storageKey];
            }
            for (const removalId of removalIds) {
                delete params[removalId];
            }
            const openRaw = params[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY];
            if (Array.isArray(openRaw)) {
                const nextOpen = openRaw.filter(
                    (x): x is string => typeof x === "string" && !removalIdSet.has(x),
                );
                if (nextOpen.length > 0) {
                    params[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY] = nextOpen;
                } else {
                    delete params[BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY];
                }
            }
            if (d.pinLabelParamKey) {
                const labels = readDynamicInputPinLabels(params, d.pinLabelParamKey);
                for (const removalId of removalIds) {
                    delete labels[removalId];
                }
                if (Object.keys(labels).length > 0) {
                    params[d.pinLabelParamKey] = labels;
                } else {
                    delete params[d.pinLabelParamKey];
                }
            }
            if (d.pinValueTypeParamKey) {
                const valueTypes = readDynamicInputPinValueTypes(params, d.pinValueTypeParamKey);
                for (const removalId of removalIds) {
                    delete valueTypes[removalId];
                }
                if (Object.keys(valueTypes).length > 0) {
                    params[d.pinValueTypeParamKey] = valueTypes;
                } else {
                    delete params[d.pinValueTypeParamKey];
                }
            }
            n.params = params;
            snap.edges = (snap.edges ?? []).filter(
                e =>
                    !(e.to.nodeId === nodeId && removalIdSet.has(e.to.port)) &&
                    !(e.from.nodeId === nodeId && removalIdSet.has(e.from.port)),
            );
            commitBlueprintIr(snap);
        },
        [commitBlueprintIr],
    );

    const addDynamicInputPinRef = useRef(addDynamicInputPin);
    addDynamicInputPinRef.current = addDynamicInputPin;
    /**
     * The project save-field editor, opened from a save node's card.
     *
     * Owned here rather than by the card: the card is rendered inside the flow surface, which is
     * scaled and translated by the viewport transform, and a dialog mounted inside it would inherit
     * both. The canvas is outside that transform, and the modal itself lands in the window overlay
     * host from there.
     */
    const [saveSchemaEditorOpen, setSaveSchemaEditorOpen] = useState(false);
    const openSaveSchemaEditor = useCallback(() => setSaveSchemaEditorOpen(true), []);
    const closeSaveSchemaEditor = useCallback(() => setSaveSchemaEditorOpen(false), []);

    const stableAddDynamicInputPin = useCallback((nodeId: string) => {
        addDynamicInputPinRef.current(nodeId);
    }, []);

    const removeDynamicInputPinRef = useRef(removeDynamicInputPin);
    removeDynamicInputPinRef.current = removeDynamicInputPin;
    const stableRemoveDynamicInputPin = useCallback((nodeId: string, pinId: string) => {
        removeDynamicInputPinRef.current(nodeId, pinId);
    }, []);

    /** Avoid onSelectionChange feedback while we push selection from props into React Flow (prevents update loops). */
    const suppressSelectionEventsRef = useRef(false);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    selectedNodeIdsRef.current = selectedNodeIds;
    /**
     * The graph whose nodes React Flow has actually been handed. It lags `graphKey` by one commit,
     * and the gap is not cosmetic: `<ReactFlow>` is a child, so React runs its selection listener
     * BEFORE the effect below hands over the new graph — and that first event still describes the
     * graph being left. On a switch that carries a selection (the diagnostics list naming a node in
     * another graph) it says "nothing is selected", which used to be written straight back over the
     * node the author had just asked to be taken to.
     *
     * The suppression flag alone cannot cover this: it is raised in that same parent effect, which
     * is to say one beat too late. It still covers the beat after, so the two run in sequence.
     */
    const syncedGraphKeyRef = useRef<string | null>(null);
    const graphKeyRef = useRef(graphKey);
    graphKeyRef.current = graphKey;

    /**
     * Replacing the nodes array during a drag (e.g. IR revision from inline literal edit) drops React Flow's
     * drag state and triggers dev warning #015. Keep live positions from RF while a drag is active.
     */
    const isNodeDragActiveRef = useRef(false);

    const lastStructuralRef = useRef<{
        graphKey: string;
        revision: number;
        membersSig: string;
        diagnosticsSig: string;
        elementPreviewsSig: string;
        displayableTargetVariantsSig: string;
        dynamicSelectOptionsByNodeSig: string;
    } | null>(null);
    const lastNodeCatalogRef = useRef(nodeCatalog);

    /**
     * The creation menu holds its own open/closed state and is reached through this handle.
     *
     * Deliberately a ref rather than canvas state: opening the menu is a right-click, and a right-click
     * that re-rendered the canvas would put the whole React Flow subtree through reconciliation before
     * the menu could appear — which is most of what made the gesture take a visible moment. Nothing on
     * the canvas depends on whether the menu is up, so nothing here has to know.
     */
    const addMenuRef = useRef<BlueprintAddNodeMenuHostHandle | null>(null);

    const [pendingPlacementEntry, setPendingPlacementEntry] = useState<BlueprintNodeEditorCatalogEntry | null>(null);
    const pendingPlacementEntryRef = useRef<BlueprintNodeEditorCatalogEntry | null>(null);
    pendingPlacementEntryRef.current = pendingPlacementEntry;
    const pendingPlacementPosRef = useRef({ x: 0, y: 0 });
    /** Latest screen pointer; used so preview snaps to cursor when picking a type (menu flow pos is stale). */
    const lastPointerClientRef = useRef({ x: 0, y: 0 });
    const controlPanStateRef = useRef<{
        pointerId: number;
        startClientX: number;
        startClientY: number;
        startViewport: Viewport;
        latestViewport: Viewport;
    } | null>(null);

    useEffect(() => {
        const sync = (e: PointerEvent) => {
            lastPointerClientRef.current = { x: e.clientX, y: e.clientY };
        };
        window.addEventListener("pointermove", sync, { passive: true });
        window.addEventListener("pointerdown", sync, { passive: true });
        return () => {
            window.removeEventListener("pointermove", sync);
            window.removeEventListener("pointerdown", sync);
        };
    }, []);

    const cancelPendingPlacement = useCallback(() => {
        pendingPlacementEntryRef.current = null;
        setPendingPlacementEntry(null);
        setNodes(nds =>
            nds.some(n => n.id === BP_PLACEMENT_PREVIEW_ID)
                ? nds.filter(n => n.id !== BP_PLACEMENT_PREVIEW_ID)
                : nds,
        );
    }, [setNodes]);

    const commitPendingPlacement = useCallback(() => {
        const entry = pendingPlacementEntryRef.current;
        if (!entry) {
            return;
        }
        const pos = pendingPlacementPosRef.current;
        cancelPendingPlacement();
        const newId = onAddNodeAtFlowPosition?.(entry, pos);
        if (typeof newId === "string" && newId.length > 0) {
            onSelectNodeIds([newId]);
        }
    }, [cancelPendingPlacement, onAddNodeAtFlowPosition, onSelectNodeIds]);

    const commitPendingPlacementRef = useRef(commitPendingPlacement);
    commitPendingPlacementRef.current = commitPendingPlacement;

    useLayoutEffect(() => {
        if (!pendingPlacementEntry) {
            return;
        }
        pendingPlacementPosRef.current = screenToFlowPosition(lastPointerClientRef.current);
    }, [pendingPlacementEntry, screenToFlowPosition]);

    useEffect(() => {
        if (!pendingPlacementEntry) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                cancelPendingPlacement();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [cancelPendingPlacement, pendingPlacementEntry]);

    useEffect(() => {
        if (!pendingPlacementEntry) {
            return;
        }
        const onMove = (e: MouseEvent) => {
            const p = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            pendingPlacementPosRef.current = p;
            setNodes(nds =>
                nds.map(n =>
                    n.id === BP_PLACEMENT_PREVIEW_ID ? { ...n, position: p, draggable: false } : n,
                ),
            );
        };
        window.addEventListener("mousemove", onMove);
        return () => window.removeEventListener("mousemove", onMove);
    }, [pendingPlacementEntry, screenToFlowPosition, setNodes]);

    useEffect(() => {
        const handlePointerMove = (event: PointerEvent) => {
            const pan = controlPanStateRef.current;
            if (!pan || event.pointerId !== pan.pointerId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();

            const nextViewport = {
                x: pan.startViewport.x + event.clientX - pan.startClientX,
                y: pan.startViewport.y + event.clientY - pan.startClientY,
                zoom: pan.startViewport.zoom,
            };
            pan.latestViewport = nextViewport;
            void setViewport(nextViewport, { duration: 0 });
        };

        const finishPointerPan = (event: PointerEvent) => {
            const pan = controlPanStateRef.current;
            if (!pan || event.pointerId !== pan.pointerId) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            controlPanStateRef.current = null;
            onViewportChange?.(pan.latestViewport);
        };

        window.addEventListener("pointermove", handlePointerMove, { passive: false });
        window.addEventListener("pointerup", finishPointerPan, { passive: false });
        window.addEventListener("pointercancel", finishPointerPan, { passive: false });
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", finishPointerPan);
            window.removeEventListener("pointercancel", finishPointerPan);
        };
    }, [onViewportChange, setViewport]);

    useEffect(() => {
        const snap = irRef.current;
        suppressSelectionEventsRef.current = true;
        syncedGraphKeyRef.current = graphKey;

        const prevStruct = lastStructuralRef.current;
        const catalogChanged = lastNodeCatalogRef.current !== nodeCatalog;
        lastNodeCatalogRef.current = nodeCatalog;
        const structural =
            catalogChanged ||
            !prevStruct ||
            prevStruct.graphKey !== graphKey ||
            prevStruct.revision !== revision ||
            prevStruct.membersSig !== blueprintMembersSig ||
            prevStruct.diagnosticsSig !== nodeDiagnosticsSig ||
            prevStruct.elementPreviewsSig !== elementPreviewsSig ||
            prevStruct.displayableTargetVariantsSig !== displayableTargetVariantsSig ||
            prevStruct.dynamicSelectOptionsByNodeSig !== dynamicSelectOptionsByNodeSig;

        if (structural) {
            lastStructuralRef.current = {
                graphKey,
                revision,
                membersSig: blueprintMembersSig,
                diagnosticsSig: nodeDiagnosticsSig,
                elementPreviewsSig,
                displayableTargetVariantsSig,
                dynamicSelectOptionsByNodeSig,
            };
            setNodes(prevNodes => {
                const base = blueprintIrToFlowNodes(
                    snap,
                    nodeCatalog,
                    stablePatchNodeParam,
                    blueprintMemberVariables,
                    blueprintPersistentVariables,
                    blueprintSavedVariables,
                    stableAddDynamicInputPin,
                    stableRemoveDynamicInputPin,
                    dynamicSelectOptions,
                    dynamicSelectOptionsByNodeId,
                    nodeDiagnosticsByNodeId,
                    elementPreviews,
                    displayableTargetVariantsByNodeId,
                    onBindElementLiteral,
                    openSaveSchemaEditor,
                );
                const withSel = applyBlueprintFlowNodeSelection(base, selectedNodeIdsRef.current);
                let out = withSel;
                if (pendingPlacementEntry) {
                    out = [
                        ...withSel,
                        buildPlacementPreviewFlowNode(
                            pendingPlacementEntry,
                            pendingPlacementPosRef.current,
                            blueprintMemberVariables,
                            blueprintPersistentVariables,
                            blueprintSavedVariables,
                        ),
                    ];
                }
                if (!isNodeDragActiveRef.current) {
                    return out;
                }
                const prevById = new Map(prevNodes.map(n => [n.id, n]));
                return out.map(n => {
                    const live = prevById.get(n.id);
                    return live ? { ...n, position: live.position } : n;
                });
            });
            setEdges(blueprintIrToFlowEdges(snap, nodeCatalog, variableTypeContext));
        } else {
            setNodes(nds => {
                const withoutPreview = nds.filter(n => n.id !== BP_PLACEMENT_PREVIEW_ID);
                if (withoutPreview.length === 0 && !pendingPlacementEntry) {
                    return nds;
                }
                const next = applyBlueprintFlowNodeSelection(withoutPreview, selectedNodeIdsRef.current);
                if (!pendingPlacementEntry) {
                    return next;
                }
                return [
                    ...next,
                    buildPlacementPreviewFlowNode(
                        pendingPlacementEntry,
                        pendingPlacementPosRef.current,
                        blueprintMemberVariables,
                        blueprintPersistentVariables,
                        blueprintSavedVariables,
                    ),
                ];
            });
        }

        const t = window.setTimeout(() => {
            suppressSelectionEventsRef.current = false;
        }, 0);
        return () => window.clearTimeout(t);
    }, [
        blueprintMemberVariables,
        blueprintPersistentVariables,
        blueprintSavedVariables,
        blueprintMembersSig,
        variableTypeContext,
        graphKey,
        nodeCatalog,
        revision,
        blueprintSelectedNodesDependencyKey(selectedNodeIds),
        pendingPlacementEntry,
        stablePatchNodeParam,
        stableAddDynamicInputPin,
        stableRemoveDynamicInputPin,
        dynamicSelectOptions,
        dynamicSelectOptionsByNodeId,
        dynamicSelectOptionsByNodeSig,
        nodeDiagnosticsByNodeId,
        nodeDiagnosticsSig,
        elementPreviews,
        elementPreviewsSig,
        displayableTargetVariantsByNodeId,
        displayableTargetVariantsSig,
        onBindElementLiteral,
        openSaveSchemaEditor,
        setEdges,
        setNodes,
    ]);

    /**
     * The focus request currently owed, keyed so that clicking the same diagnostic again re-centres
     * after the author has panned away — and so that a request is only owed while the node it names
     * is actually in this graph. Read off the IR rather than off `nodes`, which still holds the
     * previous graph's nodes for the render in which the graph is switched.
     */
    const focusRequestKey =
        focusNodeId && ir.nodes?.[focusNodeId] ? `${graphKey}:${focusNodeId}:${focusNonce ?? 0}` : null;
    const appliedFocusKeyRef = useRef<string | null>(null);
    const focusPendingRef = useRef(false);
    focusPendingRef.current = focusRequestKey !== null && focusRequestKey !== appliedFocusKeyRef.current;

    useEffect(() => {
        // Opening a graph to reveal one node in it: fitting the whole graph first would be a jump
        // to somewhere the author did not ask to look, followed immediately by another one.
        if (initialViewport || focusPendingRef.current) {
            return undefined;
        }
        let secondFrame = 0;
        const firstFrame = window.requestAnimationFrame(() => {
            secondFrame = window.requestAnimationFrame(() => {
                fitView({ padding: 0.18, duration: 0 });
            });
        });
        return () => {
            window.cancelAnimationFrame(firstFrame);
            if (secondFrame) {
                window.cancelAnimationFrame(secondFrame);
            }
        };
    }, [fitView, graphKey, initialViewport]);

    /**
     * Centre on the requested node, keeping the author's zoom: `setCenter` defaults to `maxZoom`,
     * which would slam the canvas to full size on every error clicked.
     *
     * Waits for React Flow to have measured the node. On a graph switch it has not: the effect first
     * runs against the previous graph's `nodes`, then against freshly built ones that carry no
     * dimensions yet, and centring on a node of size 0 lands its top-left corner where its middle
     * belongs — half a card off, which on a wide node reads as "it did not centre". The dimensions
     * arrive as a node change, which puts this effect back on its feet.
     */
    useEffect(() => {
        if (!focusRequestKey || !focusNodeId || focusRequestKey === appliedFocusKeyRef.current) {
            return;
        }
        const node = nodes.find(entry => entry.id === focusNodeId);
        const width = node?.measured?.width ?? 0;
        const height = node?.measured?.height ?? 0;
        if (!node || width <= 0 || height <= 0) {
            return;
        }
        appliedFocusKeyRef.current = focusRequestKey;
        void setCenter(node.position.x + width / 2, node.position.y + height / 2, {
            zoom: getViewport().zoom,
            duration: 220,
        });
    }, [focusRequestKey, focusNodeId, nodes, getViewport, setCenter]);

    const onSelectionChange = useCallback(
        ({ nodes: sel }: { nodes: Node[] }) => {
            if (suppressSelectionEventsRef.current || syncedGraphKeyRef.current !== graphKeyRef.current) {
                return;
            }
            const nextIds = sel.map(n => n.id);
            if (blueprintSelectionIdsEqual(nextIds, selectedNodeIdsRef.current)) {
                return;
            }
            onSelectNodeIds(nextIds);
        },
        [onSelectNodeIds],
    );

    /**
     * What a frame is carrying, fixed the moment the drag starts.
     *
     * Membership has to be settled once and then left alone: recomputing it mid-drag would let a
     * frame pick up every card it swept over and drop the ones it left behind, so the group would
     * change shape while the author was only moving it. `origin` is where the frame stood at the
     * start, which is what the live offset is measured from.
     */
    const groupDragRef = useRef<{
        start: Map<string, { x: number; y: number }>;
        origin: { x: number; y: number };
    } | null>(null);

    const onNodeDragStart = useCallback(
        (_event: MouseEvent | TouchEvent, node: Node, dragged: Node[]) => {
            isNodeDragActiveRef.current = true;
            groupDragRef.current = null;

            const boxes = readBlueprintCanvasBoxes(getNodes() as Node<BlueprintFlowNodeData>[]);
            const draggedIds = new Set(dragged.map(n => n.id));
            const frames = boxes.filter(box => box.isFrame && draggedIds.has(box.id));
            if (frames.length === 0) {
                return;
            }
            // React Flow already moves everything in the selection. Anything it is moving is left
            // out here, or a card that is both selected and inside the frame would travel twice.
            const start = new Map<string, { x: number; y: number }>();
            for (const frame of frames) {
                for (const id of blueprintGroupMemberIds(frame.id, frame, boxes)) {
                    if (draggedIds.has(id) || start.has(id)) {
                        continue;
                    }
                    const member = boxes.find(box => box.id === id);
                    if (member) {
                        start.set(id, { x: member.x, y: member.y });
                    }
                }
            }
            if (start.size > 0) {
                groupDragRef.current = { start, origin: { x: node.position.x, y: node.position.y } };
            }
        },
        [getNodes],
    );

    const onNodeDrag = useCallback(
        (_event: MouseEvent | TouchEvent, node: Node) => {
            const carried = groupDragRef.current;
            if (!carried) {
                return;
            }
            const dx = node.position.x - carried.origin.x;
            const dy = node.position.y - carried.origin.y;
            setNodes(nds =>
                nds.map(n => {
                    const from = carried.start.get(n.id);
                    return from ? { ...n, position: { x: from.x + dx, y: from.y + dy } } : n;
                }),
            );
        },
        [setNodes],
    );

    const onNodeDragStop = useCallback(() => {
        isNodeDragActiveRef.current = false;
        groupDragRef.current = null;
        const next = cloneBlueprintIr(irRef.current);
        applyFlowPositionsToIr(next, getNodes() as Node[]);
        commitBlueprintIr(next);
    }, [commitBlueprintIr, getNodes]);

    /**
     * Draw a frame around a set of cards.
     *
     * The rectangle is worked out here because only the canvas knows how big those cards measured;
     * the node itself is made by the owning tab, which is where ids and the blueprint document are.
     * The colour is remembered so the next group costs one click rather than two.
     *
     * The ids are passed in rather than read off the selection, because the context menu acts on
     * what it captured when it opened - which is not always what the selection has caught up to.
     */
    const createGroupFromIds = useCallback(
        (ids: readonly string[], color: string) => {
            if (!onCreateGroupFrame) {
                return;
            }
            setGroupColor(color);
            const wanted = new Set(ids);
            const boxes = readBlueprintCanvasBoxes(getNodes() as Node<BlueprintFlowNodeData>[]).filter(box =>
                wanted.has(box.id),
            );
            const frame = computeBlueprintGroupFrame(boxes);
            if (!frame) {
                return;
            }
            const id = onCreateGroupFrame({ ...frame, color, name: t("blueprint.group.untitled") });
            if (id) {
                onSelectNodeIds([id]);
            }
        },
        [getNodes, onCreateGroupFrame, onSelectNodeIds, t],
    );

    /** The toolbar's Group button: whatever is selected, in the colour it is showing. */
    const createGroupFromSelection = useCallback(
        (color: string) => createGroupFromIds(selectedNodeIdsRef.current, color),
        [createGroupFromIds],
    );

    /**
     * Lay the whole graph out again: left to right along the way its wires run, or down the page
     * for an author who would rather read a long chain that way.
     *
     * Group frames do not take part in the layout - they have no pins, so they would each be an
     * island of one and end up stacked below the graph. They are re-fitted around wherever their
     * members landed instead, which is what keeps a group a group. Plain comment notes are left
     * exactly where the author put them: they annotate a region rather than enclose it, and
     * resizing somebody's note to fit whatever now happens to sit under it would be worse than
     * leaving it behind.
     */
    const formatGraph = useCallback((direction: BlueprintLayoutDirection) => {
        setFormatDirection(direction);
        const boxes = readBlueprintCanvasBoxes(getNodes() as Node<BlueprintFlowNodeData>[]);
        const cards = boxes.filter(box => !box.isComment);
        if (cards.length === 0) {
            return;
        }
        const frames = boxes.filter(box => box.isFrame);
        // Read before anything moves: afterwards the frames still stand where they were, so the
        // same containment test would be answering about a graph that no longer exists.
        const membersByFrameId = new Map(
            frames.map(frame => [frame.id, blueprintGroupMemberIds(frame.id, frame, boxes)] as const),
        );

        const snap = irRef.current;
        const positions = layoutBlueprintGraph(
            cards,
            (snap.edges ?? []).map(edge => ({ from: edge.from.nodeId, to: edge.to.nodeId })),
            { direction },
        );
        const moved = new Map(
            cards
                .filter(card => positions[card.id])
                .map(card => [
                    card.id,
                    { ...positions[card.id]!, width: card.width, height: card.height },
                ] as const),
        );
        const refitted = refitBlueprintGroupFrames(frames, membersByFrameId, moved);

        const next = cloneBlueprintIr(snap);
        for (const [id, rect] of moved) {
            const node = next.nodes?.[id];
            if (node) {
                writeNodeEditorLayout(node, { x: rect.x, y: rect.y });
            }
        }
        for (const [id, rect] of Object.entries(refitted)) {
            const node = next.nodes?.[id];
            if (node) {
                node.params = { ...(node.params ?? {}), width: rect.width, height: rect.height };
                writeNodeEditorLayout(node, { x: rect.x, y: rect.y });
            }
        }
        commitBlueprintIr(next);
    }, [commitBlueprintIr, getNodes]);

    /** Nothing to arrange on an empty graph, or on one that holds only comments. */
    const canFormat = useMemo(
        () => nodes.some(node => node.id !== BP_PLACEMENT_PREVIEW_ID && node.data.catalog.role !== "comment"),
        [nodes],
    );

    const isValidConnection = useCallback((connection: Connection | Edge) => {
        if (
            connection.source === BP_PLACEMENT_PREVIEW_ID ||
            connection.target === BP_PLACEMENT_PREVIEW_ID
        ) {
            return false;
        }
        const conn: Connection = {
            source: connection.source,
            target: connection.target,
            sourceHandle: connection.sourceHandle ?? null,
            targetHandle: connection.targetHandle ?? null,
        };
        return isValidBlueprintIrExecConnection(irRef.current, conn, variableTypeContextRef.current);
    }, []);

    const onConnect = useCallback(
        (connection: Connection) => {
            const snap = irRef.current;
            if (!isValidBlueprintIrExecConnection(snap, connection, variableTypeContextRef.current)) {
                return;
            }
            if (!connection.sourceHandle || !connection.targetHandle) {
                return;
            }
            const source = connection.source;
            const target = connection.target;
            if (!source || !target) {
                return;
            }
            const next = cloneBlueprintIr(snap);
            next.edges = applyBlueprintIrConnection(next, {
                source,
                target,
                sourceHandle: connection.sourceHandle,
                targetHandle: connection.targetHandle,
            });
            commitBlueprintIr(next);
        },
        [commitBlueprintIr],
    );

    const onConnectEnd = useCallback(
        (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
            if (!onAddNodeAtFlowPositionAndConnect || !dragConnectCreate) {
                return;
            }
            // A drop onto a real handle is either a made connection (onConnect already ran) or an
            // explicit miss on that handle — in both cases the user aimed at a node, so don't hijack
            // it with the create menu. Only bare-canvas drops proceed.
            if (connectionState.isValid || connectionState.toHandle) {
                return;
            }
            const fromHandle = connectionState.fromHandle;
            if (!fromHandle) {
                return;
            }
            const source = resolveBlueprintDragConnectSource(
                irRef.current,
                fromHandle.nodeId,
                fromHandle.id,
                fromHandle.type,
                variableTypeContextRef.current,
            );
            if (!source || source.nodeId === BP_PLACEMENT_PREVIEW_ID) {
                return;
            }
            if (!dragConnectCreate[source.kind]) {
                return;
            }
            if (pendingPlacementEntryRef.current) {
                cancelPendingPlacement();
            }
            const point =
                "clientX" in event
                    ? { x: event.clientX, y: event.clientY }
                    : {
                          x: event.changedTouches[0]?.clientX ?? 0,
                          y: event.changedTouches[0]?.clientY ?? 0,
                      };
            lastPointerClientRef.current = point;
            const flow = screenToFlowPosition(point);
            addMenuRef.current?.open({
                clientX: point.x,
                clientY: point.y,
                flow: { x: flow.x, y: flow.y },
                connectSource: source,
            });
        },
        [cancelPendingPlacement, dragConnectCreate, onAddNodeAtFlowPositionAndConnect, screenToFlowPosition],
    );

    const onEdgesDelete = useCallback(
        (deleted: Edge[]) => {
            if (deleted.length === 0) {
                return;
            }
            const snap = irRef.current;
            const next = cloneBlueprintIr(snap);
            next.edges = (snap.edges ?? []).filter(
                e =>
                    !deleted.some(
                        d =>
                            d.source === e.from.nodeId &&
                            (d.sourceHandle ?? "") === e.from.port &&
                            d.target === e.to.nodeId &&
                            (d.targetHandle ?? "") === e.to.port,
                    ),
            );
            commitBlueprintIr(next);
        },
        [commitBlueprintIr],
    );

    const onEdgeDoubleClick = useCallback(
        (_e: ReactMouseEvent, edge: Edge) => {
            const snap = irRef.current;
            const src = edge.source;
            const tgt = edge.target;
            const sh = edge.sourceHandle ?? "";
            const th = edge.targetHandle ?? "";
            const before = snap.edges ?? [];
            const filtered = before.filter(
                e => !(e.from.nodeId === src && e.from.port === sh && e.to.nodeId === tgt && e.to.port === th),
            );
            if (filtered.length === before.length) {
                return;
            }
            const next = cloneBlueprintIr(snap);
            next.edges = filtered;
            commitBlueprintIr(next);
        },
        [commitBlueprintIr],
    );

    /**
     * The single way a node leaves the graph: the Delete key, and the node menu's Delete row.
     *
     * Both hand over ids, so neither has to know that a node takes its wiring with it. The
     * placement ghost is filtered out here rather than at each caller - it is a React Flow node
     * with no counterpart in the IR, so removing it is the caller's `cancelPendingPlacement`, not a
     * document edit.
     */
    const deleteNodeIds = useCallback(
        (ids: readonly string[]) => {
            const real = ids.filter(id => id !== BP_PLACEMENT_PREVIEW_ID);
            if (real.length === 0) {
                return;
            }
            const next = cloneBlueprintIr(irRef.current);
            for (const id of real) {
                removeBlueprintNodeFromIr(next, id);
            }
            onSelectNodeIds([]);
            commitBlueprintIr(next);
        },
        [commitBlueprintIr, onSelectNodeIds],
    );

    const onNodesDelete = useCallback(
        (deleted: Node[]) => {
            if (deleted.length === 0) {
                return;
            }
            if (deleted.some(n => n.id === BP_PLACEMENT_PREVIEW_ID)) {
                cancelPendingPlacement();
            }
            deleteNodeIds(deleted.map(n => n.id));
        },
        [cancelPendingPlacement, deleteNodeIds],
    );

    const onPaneClick = useCallback(
        (e: ReactMouseEvent) => {
            if (e.button !== 0 || !pendingPlacementEntryRef.current) {
                return;
            }
            e.preventDefault();
            commitPendingPlacementRef.current();
        },
        [],
    );

    const onControlPanPointerDownCapture = useCallback(
        (e: ReactPointerEvent<HTMLDivElement>) => {
            if (e.button !== 0 || !e.ctrlKey || pendingPlacementEntryRef.current) {
                return;
            }
            const target = e.target instanceof HTMLElement ? e.target : null;
            if (target?.closest("textarea, input, select, [contenteditable='true']")) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture?.(e.pointerId);

            const startViewport = getViewport();
            controlPanStateRef.current = {
                pointerId: e.pointerId,
                startClientX: e.clientX,
                startClientY: e.clientY,
                startViewport,
                latestViewport: startViewport,
            };
        },
        [getViewport],
    );

    const onControlPanContextMenuCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
        if (!e.ctrlKey) {
            return;
        }
        e.preventDefault();
        e.stopPropagation();
    }, []);

    const onPlacementPreviewNodeClick = useCallback((_e: ReactMouseEvent, node: Node) => {
        if (node.id !== BP_PLACEMENT_PREVIEW_ID || !pendingPlacementEntryRef.current) {
            return;
        }
        commitPendingPlacementRef.current();
    }, []);

    const breakpointScope = useBlueprintBreakpointScope();
    /**
     * The open node menu, plus the nodes it will act on.
     *
     * `targetIds` is fixed when the menu opens rather than read back off the selection when a row
     * is clicked: the retarget below travels out to the owning tab and back as a prop, so at click
     * time the selection may still be one beat behind what the author is looking at.
     */
    const [nodeMenu, setNodeMenu] = useState<
        { x: number; y: number; nodeId: string | null; targetIds: string[]; frameIds: string[] } | null
    >(null);

    /**
     * Which of these nodes are group frames.
     *
     * A group is a comment card with `frame` set: it owns no members, it simply encloses whatever
     * it is drawn around, and membership is read back off the geometry whenever it matters. So the
     * frames are all "Ungroup" has to remove, and the cards inside them are left untouched.
     */
    const readFrameIds = useCallback(
        (ids: readonly string[]) => {
            const wanted = new Set(ids);
            return (getNodes() as Node<BlueprintFlowNodeData>[])
                .filter(
                    node =>
                        wanted.has(node.id) &&
                        node.data.catalog.role === "comment" &&
                        node.data.params.frame === true,
                )
                .map(node => node.id);
        },
        [getNodes],
    );
    const onNodeContextMenu = useCallback(
        (event: ReactMouseEvent, node: Node) => {
            // The placement ghost is not a node of the graph yet; right-clicking it has nothing to
            // offer, and the click falls through to the pane the ghost is floating over.
            if (node.id === BP_PLACEMENT_PREVIEW_ID) {
                return;
            }
            // A card is not all card: its literal values are text fields, and a right click in one
            // is a text gesture. Left alone (no `preventDefault`), it reaches the window's editable
            // menu and comes back as cut/copy/paste - rather than a menu about the node, with a
            // Delete row sitting over the field the author was typing in.
            if (editableTextTarget(event.target)) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            // Right-click inside a multi-selection keeps the set - deleting five nodes should not
            // need five menus. Right-click outside it moves the selection onto the node under the
            // cursor first, so what the menu acts on is what the author can see is picked.
            const selected = selectedNodeIdsRef.current;
            const inSelection = selected.includes(node.id);
            const targetIds = inSelection ? [...selected] : [node.id];
            if (!inSelection) {
                onSelectNodeIds(targetIds);
            }
            setNodeMenu({
                x: event.clientX,
                y: event.clientY,
                nodeId: node.id,
                targetIds,
                frameIds: readFrameIds(targetIds),
            });
        },
        [onSelectNodeIds, readFrameIds],
    );
    /**
     * The same menu, for a right-click that lands on a box selection.
     *
     * After a marquee, React Flow lays its own rectangle over the picked cards and that rectangle
     * takes the click - `onNodeContextMenu` never fires, and the pane's handler only runs for
     * clicks on the pane itself, so without this the menu simply never appeared. The selection is
     * kept as it stands; nothing about a right-click on what is already picked should change it.
     *
     * Which card the click landed on is worked out from the geometry, because the rectangle covers
     * the gaps between the cards as well as the cards themselves. A click in a gap has no node to
     * speak of, so the menu comes up with the rows that act on the whole selection and none of the
     * per-node ones. Frames lose to the cards they enclose - a click inside a group is a click on
     * the card under the cursor, not on the box drawn around it.
     */
    const onSelectionContextMenu = useCallback(
        (event: ReactMouseEvent, nodes: Node[]) => {
            const targetIds = nodes.map(n => n.id).filter(id => id !== BP_PLACEMENT_PREVIEW_ID);
            if (targetIds.length === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
            const under = readBlueprintCanvasBoxes(nodes as Node<BlueprintFlowNodeData>[])
                .filter(
                    box =>
                        flow.x >= box.x &&
                        flow.x <= box.x + box.width &&
                        flow.y >= box.y &&
                        flow.y <= box.y + box.height,
                )
                .sort((a, b) => a.width * a.height - b.width * b.height);
            setNodeMenu({
                x: event.clientX,
                y: event.clientY,
                nodeId: under[0]?.id ?? null,
                targetIds,
                frameIds: readFrameIds(targetIds),
            });
        },
        [readFrameIds, screenToFlowPosition],
    );
    const nodeMenuItems = useMemo<ContextMenuDef>(() => {
        if (!nodeMenu) {
            return [];
        }
        const { nodeId, targetIds, frameIds } = nodeMenu;
        const items: ContextMenuDef = [
            {
                id: "blueprint.node.delete",
                label: t("common.delete"),
                onClick: () => {
                    setNodeMenu(null);
                    deleteNodeIds(targetIds);
                },
            },
        ];
        // Group and Ungroup are the same pair the toolbar offers, brought to where the cards are:
        // grouping is about the nodes under the cursor, so reaching the far corner of the canvas
        // for it was always a detour. The colour is the one the toolbar is showing - picking a
        // different one stays a toolbar job, so this menu keeps to one row per action.
        const groupRows: ContextMenuDef = [];
        if (onCreateGroupFrame) {
            groupRows.push({
                id: "blueprint.node.group",
                label: t("blueprint.group.create"),
                onClick: () => {
                    setNodeMenu(null);
                    createGroupFromIds(targetIds, groupColor);
                },
            });
        }
        if (frameIds.length > 0) {
            groupRows.push({
                id: "blueprint.node.ungroup",
                label: t("blueprint.group.ungroup"),
                onClick: () => {
                    setNodeMenu(null);
                    deleteNodeIds(frameIds);
                },
            });
        }
        if (groupRows.length > 0) {
            items.push({ separator: true, id: "blueprint.node.sep-group" }, ...groupRows);
        }
        // Formatting rearranges the whole graph rather than the selection, so it offers the two
        // directions outright instead of quietly reusing the last one: a row that moves every card
        // on the canvas should say which way it is about to move them.
        if (canFormat) {
            items.push(
                { separator: true, id: "blueprint.node.sep-format" },
                {
                    id: "blueprint.node.format",
                    label: t("blueprint.format.graph"),
                    // Frozen, this row says so itself rather than leaving the freeze pass below to
                    // grey the two directions inside it: a live row that opens onto two dead ones
                    // makes the author ask for the submenu to find out they cannot have it.
                    ...(freeze.frozen ? { disabled: true, tooltip: freeze.reason } : {}),
                    submenu: [
                        {
                            id: "blueprint.node.format.horizontal",
                            label: t("blueprint.format.horizontal"),
                            onClick: () => {
                                setNodeMenu(null);
                                formatGraph("horizontal");
                            },
                        },
                        {
                            id: "blueprint.node.format.vertical",
                            label: t("blueprint.format.vertical"),
                            onClick: () => {
                                setNodeMenu(null);
                                formatGraph("vertical");
                            },
                        },
                    ],
                },
            );
        }
        if (breakpointScope && nodeId) {
            const existing = breakpointScope.byKey.get(
                blueprintBreakpointKey({
                    blueprintId: breakpointScope.blueprintId,
                    graphId: breakpointScope.graphId,
                    nodeId,
                }),
            );
            items.push(
                { separator: true, id: "blueprint.node.sep-breakpoint" },
                ...buildBreakpointContextMenu({
                    existing,
                    onToggle: () => {
                        breakpointScope.toggle(nodeId);
                        setNodeMenu(null);
                    },
                    onSetEnabled: enabled => {
                        breakpointScope.setEnabled(nodeId, enabled);
                        setNodeMenu(null);
                    },
                    onEdit: () => {
                        breakpointScope.edit(nodeId);
                        setNodeMenu(null);
                    },
                    labels: {
                        add: t("blueprint.breakpoint.add"),
                        remove: t("blueprint.breakpoint.remove"),
                        enable: t("blueprint.breakpoint.enable"),
                        disable: t("blueprint.breakpoint.disable"),
                        edit: t("blueprint.breakpoint.edit"),
                    },
                }),
            );
        }
        // Delete writes the document, so a frozen project greys it and says why. The breakpoint
        // rows are debugger state - readable and settable while frozen - so they are exempt, and
        // the menu stays open on a frozen project instead of being withheld whole the way the
        // pane's creation menu is.
        return freezeContextMenuRows(items, freeze.frozen, BREAKPOINT_MENU_ROW_IDS, freeze.reason);
    }, [
        breakpointScope,
        canFormat,
        createGroupFromIds,
        deleteNodeIds,
        formatGraph,
        freeze.frozen,
        freeze.reason,
        groupColor,
        nodeMenu,
        onCreateGroupFrame,
        t,
    ]);

    const onAddMenuPickEntry = useCallback(
        (
            entry: BlueprintNodeEditorCatalogEntry,
            flowPos: { x: number; y: number },
            connectSource: BlueprintDragConnectSource | undefined,
        ) => {
            if (connectSource) {
                const newNodePinId = pickBlueprintDragConnectTargetPin(connectSource, entry);
                if (!newNodePinId) {
                    return;
                }
                const newId = onAddNodeAtFlowPositionAndConnect?.(entry, flowPos, {
                    existingNodeId: connectSource.nodeId,
                    existingHandleId: connectSource.handleId,
                    existingHandleType: connectSource.handleType,
                    newNodePinId,
                });
                if (typeof newId === "string" && newId.length > 0) {
                    onSelectNodeIds([newId]);
                }
                return;
            }
            setPendingPlacementEntry(entry);
        },
        [onAddNodeAtFlowPositionAndConnect, onSelectNodeIds],
    );

    const onPaneContextMenu = useCallback(
        (e: MouseEvent | ReactMouseEvent<Element>) => {
            if (!onAddNodeAtFlowPosition) {
                return;
            }
            e.preventDefault();
            if ("ctrlKey" in e && e.ctrlKey) {
                return;
            }
            if (pendingPlacementEntryRef.current) {
                commitPendingPlacementRef.current();
            }
            const clientX = "clientX" in e ? e.clientX : 0;
            const clientY = "clientY" in e ? e.clientY : 0;
            lastPointerClientRef.current = { x: clientX, y: clientY };
            const flow = screenToFlowPosition({ x: clientX, y: clientY });
            addMenuRef.current?.open({
                clientX,
                clientY,
                flow: { x: flow.x, y: flow.y },
            });
        },
        [onAddNodeAtFlowPosition, screenToFlowPosition],
    );

    return (
        <div
            className="relative h-full w-full min-h-0"
            style={pendingPlacementEntry ? { cursor: "crosshair" } : undefined}
            onPointerDownCapture={onControlPanPointerDownCapture}
            onContextMenuCapture={onControlPanContextMenuCapture}
        >
            <ReactFlow
                key={graphKey}
                nodes={nodes}
                edges={edges}
                nodeTypes={blueprintFlowNodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                isValidConnection={isValidConnection}
                onConnect={onConnect}
                onConnectEnd={onConnectEnd}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onEdgesDelete={onEdgesDelete}
                // Double-clicking an edge deletes it, so it goes with the rest of the write gestures.
                onEdgeDoubleClick={freeze.gesture(onEdgeDoubleClick)}
                onNodesDelete={onNodesDelete}
                // The pane menu is a creation flow: right-click, pick a type, a ghost follows the
                // cursor, click places the node. Withheld whole rather than refused at the placement
                // click, so a frozen project never gets as far as showing a ghost it will discard.
                onPaneContextMenu={freeze.gesture(onPaneContextMenu)}
                onNodeContextMenu={onNodeContextMenu}
                onSelectionContextMenu={onSelectionContextMenu}
                onPaneClick={onPaneClick}
                // Selection stays on - reading a frozen graph is the point - so only the two gestures
                // that change it are switched off. React Flow keeps the handles drawn either way, so
                // the pins the author is inspecting still look like pins.
                // The hand tool is navigation, so nothing moves under it: a drag that started on a
                // card would otherwise edit the graph while the author believed they were only
                // travelling across it. With node dragging off, that press reaches the pane and
                // pans like every other one, so the hand has no dead spots either.
                nodesDraggable={!freeze.frozen && tool === "select"}
                nodesConnectable={!freeze.frozen}
                deleteKeyCode={freeze.frozen ? null : deleteKeyCode ?? null}
                onNodeClick={onPlacementPreviewNodeClick}
                onSelectionChange={onSelectionChange}
                selectionOnDrag={!pendingPlacementEntry && tool === "select"}
                selectionMode={SelectionMode.Partial}
                multiSelectionKeyCode="Shift"
                panOnDrag={tool === "pan" ? PAN_BUTTONS_HAND_TOOL : PAN_BUTTONS_SELECT_TOOL}
                panOnScroll
                panOnScrollMode={PanOnScrollMode.Free}
                panOnScrollSpeed={1}
                zoomOnScroll={false}
                zoomOnPinch
                onMoveEnd={(_, viewport) => onViewportChange?.({
                    x: viewport.x,
                    y: viewport.y,
                    zoom: viewport.zoom,
                })}
                defaultViewport={initialViewport ?? undefined}
                id={flowId}
                className="narraleaf-blueprint-flow bg-surface"
                proOptions={{ hideAttribution: true }}
                edgesReconnectable={false}
                edgesFocusable
                elevateEdgesOnSelect
                defaultEdgeOptions={{ selectable: true, focusable: true, interactionWidth: 24 }}
                zIndexMode="manual"
            >
                <Background color="rgb(var(--nl-fg-subtle))" gap={20} size={1} />
                <BlueprintCanvasToolbar
                    tool={tool}
                    onToolChange={setTool}
                    groupColor={groupColor}
                    onCreateGroup={createGroupFromSelection}
                    canGroup={Boolean(onCreateGroupFrame) && selectedNodeIds.length > 0}
                    formatDirection={formatDirection}
                    onFormat={formatGraph}
                    canFormat={canFormat}
                />
                <MiniMap
                    // Dragging the minimap pans the viewport — the quickest way to
                    // move across a large graph. xyflow ships no cursor affordance
                    // for it, so add our own (grab, grabbing while held).
                    pannable
                    className="!bg-surface-sunken !border-edge cursor-grab active:cursor-grabbing"
                    maskColor="rgb(var(--nl-surface-sunken) / 0.65)"
                    nodeColor={() => "var(--narraleaf-accent, #40a8c4)"}
                />
            </ReactFlow>
            <BlueprintAddNodeMenuHost
                ref={addMenuRef}
                nodeCatalog={nodeCatalog}
                paletteContext={paletteContext}
                onPickEntry={onAddMenuPickEntry}
            />
            <SaveSchemaFieldsModal isOpen={saveSchemaEditorOpen} onClose={closeSaveSchemaEditor} />
            {nodeMenu ? (
                <ContextMenu
                    items={nodeMenuItems}
                    position={{ x: nodeMenu.x, y: nodeMenu.y }}
                    visible
                    onClose={() => setNodeMenu(null)}
                />
            ) : null}
        </div>
    );
}

/** What the canvas hands the menu when a right-click (or a pin drag) asks for it. */
type BlueprintAddNodeMenuRequest = {
    clientX: number;
    clientY: number;
    flow: { x: number; y: number };
    /** Set when the menu was opened by dragging off a pin; filters to compatible nodes + auto-wires. */
    connectSource?: BlueprintDragConnectSource;
};

export type BlueprintAddNodeMenuHostHandle = {
    open: (request: BlueprintAddNodeMenuRequest) => void;
    close: () => void;
};

/**
 * Owns whether the creation menu is up, so the canvas does not have to.
 *
 * The canvas is the expensive tree on this page — one React Flow instance, every node card, every
 * pin row. Keeping "is the menu open" out of it means a right-click renders the menu and nothing
 * else. The handle is the whole interface: the canvas calls `open` from its gesture handlers and
 * never reads the answer back.
 */
const BlueprintAddNodeMenuHost = forwardRef<
    BlueprintAddNodeMenuHostHandle,
    {
        nodeCatalog: IBlueprintNodeCatalogService;
        paletteContext: BlueprintPaletteContext;
        onPickEntry: (
            entry: BlueprintNodeEditorCatalogEntry,
            flowPosition: { x: number; y: number },
            connectSource: BlueprintDragConnectSource | undefined,
        ) => void;
    }
>(function BlueprintAddNodeMenuHost({ nodeCatalog, paletteContext, onPickEntry }, ref) {
    const [request, setRequest] = useState<BlueprintAddNodeMenuRequest | null>(null);

    useImperativeHandle(ref, () => ({
        open: next => setRequest(next),
        close: () => setRequest(null),
    }), []);

    const connectSource = request?.connectSource;
    const entryFilter = useMemo(
        () =>
            connectSource
                ? (entry: BlueprintNodeEditorCatalogEntry) =>
                      pickBlueprintDragConnectTargetPin(connectSource, entry) !== null
                : undefined,
        [connectSource],
    );

    const close = useCallback(() => setRequest(null), []);
    const pick = useCallback(
        (entry: BlueprintNodeEditorCatalogEntry, flowPosition: { x: number; y: number }) => {
            onPickEntry(entry, flowPosition, connectSource);
        },
        [connectSource, onPickEntry],
    );

    if (!request) {
        return null;
    }

    return (
        <BlueprintAddNodeMenu
            nodeCatalog={nodeCatalog}
            open
            paletteContext={paletteContext}
            anchor={{ x: request.clientX, y: request.clientY }}
            flowPosition={request.flow}
            connectMode={Boolean(connectSource)}
            connectSourceLabel={connectSource && !connectSource.isExec ? connectSource.valueType : undefined}
            entryFilter={entryFilter}
            onClose={close}
            onPickEntry={pick}
        />
    );
});

export type BlueprintFlowCanvasProps = BlueprintFlowCanvasInnerProps;

export function BlueprintFlowCanvas(props: BlueprintFlowCanvasProps) {
    return (
        <div className="h-full w-full min-h-0">
            <ReactFlowProvider>
                <BlueprintFlowCanvasInner {...props} />
            </ReactFlowProvider>
        </div>
    );
}
