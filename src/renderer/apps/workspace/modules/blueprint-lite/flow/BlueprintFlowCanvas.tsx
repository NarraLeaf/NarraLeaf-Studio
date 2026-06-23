import "@xyflow/react/dist/style.css";
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type MouseEvent as ReactMouseEvent,
} from "react";
import {
    ReactFlow,
    Background,
    MiniMap,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Connection,
    type Edge,
    type Node,
} from "@xyflow/react";
import type { BlueprintGraphIr } from "@shared/types/blueprint/document";
import { BLUEPRINT_NODE_PARAM_VARIABLE_VALUE_TYPE } from "@shared/types/blueprint/graph";
import {
    applyBlueprintIrConnection,
    createGraphNodeForPalette,
    isValidBlueprintIrExecConnection,
} from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import { blueprintFlowNodeTypes } from "./nodeTypes";
import {
    applyBlueprintFlowNodeSelection,
    applyFlowPositionsToIr,
    blueprintIrToFlowEdges,
    blueprintIrToFlowNodes,
    blueprintSelectedNodesDependencyKey,
    blueprintSelectionIdsEqual,
} from "./useBlueprintFlowProjection";
import type { BlueprintFlowNodeData } from "./components/BlueprintFlowNode";
import { BlueprintFlowZoomControls } from "./components/BlueprintFlowZoomControls";
import { BlueprintAddNodeMenu } from "../components/BlueprintAddNodeMenu";
import {
    generateNextDynamicInputPinIds,
    getDynamicInputPinRemovalIds,
    readDynamicInputPinIds,
    readDynamicInputPinLabels,
} from "@/lib/ui-editor/blueprint-nodes/effectivePins";
import {
    BLUEPRINT_NODE_PARAMS_INLINE_LITERAL_PINS_KEY,
    type BlueprintInspectorParamSelectOption,
    type BlueprintPaletteContext,
} from "@/lib/ui-editor/blueprint-nodes/types";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";

/** Ephemeral React Flow node while choosing drop position — not in BlueprintGraphIr until commit. */
const BP_PLACEMENT_PREVIEW_ID = "__bp_placement_preview__";

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
    nodeType: string,
    position: { x: number; y: number },
    nodeCatalog: IBlueprintNodeCatalogService,
    memberVariables: BlueprintFlowNodeData["memberVariables"],
): Node<BlueprintFlowNodeData> {
    const stub = createGraphNodeForPalette(nodeType, BP_PLACEMENT_PREVIEW_ID);
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
            catalog: nodeCatalog.resolveCatalogEntry(nodeType),
            nodeId: BP_PLACEMENT_PREVIEW_ID,
            params: stub.params ?? {},
            memberVariables,
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
    selectedNodeIds: readonly string[];
    onSelectNodeIds: (ids: string[]) => void;
    onCommitIr: (next: BlueprintGraphIr, history?: { mergeKey?: string; mergeWindowMs?: number }) => void;
    /**
     * When set, right-click on the pane opens a compact search menu. After picking a type, a preview follows
     * the cursor until click; this callback runs on confirm with the final flow position. Return the new id
     * to select the node.
     */
    onAddNodeAtFlowPosition?: (type: string, flowPosition: { x: number; y: number }) => string | undefined;
    paletteContext: BlueprintPaletteContext;
    /** When null, Delete/Backspace do not remove nodes (e.g. while typing in the sidebar). */
    deleteKeyCode?: string[] | null;
    /**
     * Dynamic select options keyed by `dynamicOptionsSource` id (e.g. `"surfaces"`).
     * Populated from workspace context and forwarded to node cards.
     */
    dynamicSelectOptions?: Record<string, BlueprintInspectorParamSelectOption[]>;
    /** Initial React Flow viewport restored from editor-session state. */
    initialViewport?: BlueprintFlowViewport | null;
    /** Called after pan/zoom changes so the owning editor tab can persist the view. */
    onViewportChange?: (viewport: BlueprintFlowViewport) => void;
};

export type BlueprintFlowViewport = {
    x: number;
    y: number;
    zoom: number;
};

function BlueprintFlowCanvasInner({
    nodeCatalog,
    graphKey,
    ir,
    revision,
    blueprintMembersSig,
    blueprintMemberVariables,
    selectedNodeIds,
    onSelectNodeIds,
    onCommitIr,
    onAddNodeAtFlowPosition,
    paletteContext,
    deleteKeyCode = ["Backspace", "Delete"],
    dynamicSelectOptions,
    initialViewport,
    onViewportChange,
}: BlueprintFlowCanvasInnerProps) {
    const { getNodes, screenToFlowPosition, fitView } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<BlueprintFlowNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const irRef = useRef(ir);
    irRef.current = ir;

    const commitBlueprintIr = useCallback(
        (next: BlueprintGraphIr, history?: { mergeKey?: string; mergeWindowMs?: number }) => {
            irRef.current = next;
            onCommitIr(next, history);
        },
        [onCommitIr],
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
            }
            n.params = next;
            commitBlueprintIr(snap, history);
        },
        [blueprintMemberVariables, commitBlueprintIr],
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
     * Replacing the nodes array during a drag (e.g. IR revision from inline literal edit) drops React Flow's
     * drag state and triggers dev warning #015. Keep live positions from RF while a drag is active.
     */
    const isNodeDragActiveRef = useRef(false);

    const lastStructuralRef = useRef<{ graphKey: string; revision: number; membersSig: string } | null>(null);
    const lastNodeCatalogRef = useRef(nodeCatalog);

    const [addMenu, setAddMenu] = useState<{
        clientX: number;
        clientY: number;
        flow: { x: number; y: number };
    } | null>(null);

    const [pendingPlacementType, setPendingPlacementType] = useState<string | null>(null);
    const pendingPlacementTypeRef = useRef<string | null>(null);
    pendingPlacementTypeRef.current = pendingPlacementType;
    const pendingPlacementPosRef = useRef({ x: 0, y: 0 });
    /** Latest screen pointer; used so preview snaps to cursor when picking a type (menu flow pos is stale). */
    const lastPointerClientRef = useRef({ x: 0, y: 0 });

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

    const commitPendingPlacement = useCallback(() => {
        const nodeType = pendingPlacementTypeRef.current;
        if (!nodeType) {
            return;
        }
        const pos = pendingPlacementPosRef.current;
        setPendingPlacementType(null);
        const newId = onAddNodeAtFlowPosition?.(nodeType, pos);
        if (typeof newId === "string" && newId.length > 0) {
            onSelectNodeIds([newId]);
        }
    }, [onAddNodeAtFlowPosition, onSelectNodeIds]);

    const commitPendingPlacementRef = useRef(commitPendingPlacement);
    commitPendingPlacementRef.current = commitPendingPlacement;

    useLayoutEffect(() => {
        if (!pendingPlacementType) {
            return;
        }
        pendingPlacementPosRef.current = screenToFlowPosition(lastPointerClientRef.current);
    }, [pendingPlacementType, screenToFlowPosition]);

    useEffect(() => {
        if (!pendingPlacementType) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                setPendingPlacementType(null);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [pendingPlacementType]);

    useEffect(() => {
        if (!pendingPlacementType) {
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
    }, [pendingPlacementType, screenToFlowPosition, setNodes]);

    useEffect(() => {
        const snap = irRef.current;
        suppressSelectionEventsRef.current = true;

        const prevStruct = lastStructuralRef.current;
        const catalogChanged = lastNodeCatalogRef.current !== nodeCatalog;
        lastNodeCatalogRef.current = nodeCatalog;
        const structural =
            catalogChanged ||
            !prevStruct ||
            prevStruct.graphKey !== graphKey ||
            prevStruct.revision !== revision ||
            prevStruct.membersSig !== blueprintMembersSig;

        if (structural) {
            lastStructuralRef.current = { graphKey, revision, membersSig: blueprintMembersSig };
            setNodes(prevNodes => {
                const base = blueprintIrToFlowNodes(
                    snap,
                    nodeCatalog,
                    stablePatchNodeParam,
                    blueprintMemberVariables,
                    stableAddDynamicInputPin,
                    stableRemoveDynamicInputPin,
                    dynamicSelectOptions,
                );
                const withSel = applyBlueprintFlowNodeSelection(base, selectedNodeIdsRef.current);
                let out = withSel;
                if (pendingPlacementType) {
                    out = [
                        ...withSel,
                        buildPlacementPreviewFlowNode(
                            pendingPlacementType,
                            pendingPlacementPosRef.current,
                            nodeCatalog,
                            blueprintMemberVariables,
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
            setEdges(blueprintIrToFlowEdges(snap, nodeCatalog));
        } else {
            setNodes(nds => {
                const withoutPreview = nds.filter(n => n.id !== BP_PLACEMENT_PREVIEW_ID);
                if (withoutPreview.length === 0 && !pendingPlacementType) {
                    return nds;
                }
                const next = applyBlueprintFlowNodeSelection(withoutPreview, selectedNodeIdsRef.current);
                if (!pendingPlacementType) {
                    return next;
                }
                return [
                    ...next,
                    buildPlacementPreviewFlowNode(
                        pendingPlacementType,
                        pendingPlacementPosRef.current,
                        nodeCatalog,
                        blueprintMemberVariables,
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
        blueprintMembersSig,
        graphKey,
        nodeCatalog,
        revision,
        blueprintSelectedNodesDependencyKey(selectedNodeIds),
        pendingPlacementType,
        stablePatchNodeParam,
        stableAddDynamicInputPin,
        stableRemoveDynamicInputPin,
        dynamicSelectOptions,
        setEdges,
        setNodes,
    ]);

    useEffect(() => {
        if (initialViewport) {
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

    const onSelectionChange = useCallback(
        ({ nodes: sel }: { nodes: Node[] }) => {
            if (suppressSelectionEventsRef.current) {
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

    const onNodeDragStart = useCallback(() => {
        isNodeDragActiveRef.current = true;
    }, []);

    const onNodeDragStop = useCallback(() => {
        isNodeDragActiveRef.current = false;
        const next = cloneBlueprintIr(irRef.current);
        applyFlowPositionsToIr(next, getNodes() as Node[]);
        commitBlueprintIr(next);
    }, [commitBlueprintIr, getNodes]);

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
        return isValidBlueprintIrExecConnection(irRef.current, conn);
    }, []);

    const onConnect = useCallback(
        (connection: Connection) => {
            const snap = irRef.current;
            if (!isValidBlueprintIrExecConnection(snap, connection)) {
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

    const onNodesDelete = useCallback(
        (deleted: Node[]) => {
            if (deleted.length === 0) {
                return;
            }
            if (deleted.some(n => n.id === BP_PLACEMENT_PREVIEW_ID)) {
                setPendingPlacementType(null);
            }
            const real = deleted.filter(n => n.id !== BP_PLACEMENT_PREVIEW_ID);
            if (real.length === 0) {
                return;
            }
            const snap = irRef.current;
            const next = cloneBlueprintIr(snap);
            for (const n of real) {
                removeBlueprintNodeFromIr(next, n.id);
            }
            onSelectNodeIds([]);
            commitBlueprintIr(next);
        },
        [commitBlueprintIr, onSelectNodeIds],
    );

    const onPaneClick = useCallback(
        (e: ReactMouseEvent) => {
            if (e.button !== 0 || !pendingPlacementTypeRef.current) {
                return;
            }
            e.preventDefault();
            commitPendingPlacementRef.current();
        },
        [],
    );

    const onPlacementPreviewNodeClick = useCallback((_e: ReactMouseEvent, node: Node) => {
        if (node.id !== BP_PLACEMENT_PREVIEW_ID || !pendingPlacementTypeRef.current) {
            return;
        }
        commitPendingPlacementRef.current();
    }, []);

    const onPaneContextMenu = useCallback(
        (e: MouseEvent | ReactMouseEvent<Element>) => {
            if (!onAddNodeAtFlowPosition) {
                return;
            }
            e.preventDefault();
            if (pendingPlacementTypeRef.current) {
                commitPendingPlacementRef.current();
            }
            const clientX = "clientX" in e ? e.clientX : 0;
            const clientY = "clientY" in e ? e.clientY : 0;
            lastPointerClientRef.current = { x: clientX, y: clientY };
            const flow = screenToFlowPosition({ x: clientX, y: clientY });
            setAddMenu({
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
            style={pendingPlacementType ? { cursor: "crosshair" } : undefined}
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
                onNodeDragStart={onNodeDragStart}
                onNodeDragStop={onNodeDragStop}
                onEdgesDelete={onEdgesDelete}
                onEdgeDoubleClick={onEdgeDoubleClick}
                onNodesDelete={onNodesDelete}
                onPaneContextMenu={onPaneContextMenu}
                onPaneClick={onPaneClick}
                onNodeClick={onPlacementPreviewNodeClick}
                onSelectionChange={onSelectionChange}
                onMoveEnd={(_, viewport) => onViewportChange?.({
                    x: viewport.x,
                    y: viewport.y,
                    zoom: viewport.zoom,
                })}
                defaultViewport={initialViewport ?? undefined}
                className="bg-[#0f1115]"
                proOptions={{ hideAttribution: true }}
                deleteKeyCode={deleteKeyCode ?? null}
                edgesReconnectable={false}
                edgesFocusable
                elevateEdgesOnSelect
                defaultEdgeOptions={{ selectable: true, focusable: true, interactionWidth: 24 }}
                zIndexMode="manual"
            >
                <Background color="#334155" gap={20} size={1} />
                <BlueprintFlowZoomControls />
                <MiniMap
                    className="!bg-[#0b0d12] !border-white/10"
                    maskColor="rgba(15, 23, 42, 0.65)"
                    nodeColor={() => "#0891b2"}
                />
            </ReactFlow>
            {onAddNodeAtFlowPosition && addMenu ? (
                <BlueprintAddNodeMenu
                    nodeCatalog={nodeCatalog}
                    open
                    paletteContext={paletteContext}
                    anchor={{ x: addMenu.clientX, y: addMenu.clientY }}
                    flowPosition={addMenu.flow}
                    onClose={() => setAddMenu(null)}
                    onPickType={type => {
                        setPendingPlacementType(type);
                    }}
                />
            ) : null}
        </div>
    );
}

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
