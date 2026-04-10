import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
    ReactFlow,
    Background,
    Controls,
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
import { isValidBlueprintIrExecConnection } from "@/lib/workspace/services/ui-editor/blueprint/graphEditing";
import { blueprintFlowNodeTypes } from "./nodeTypes";
import { applyFlowPositionsToIr, blueprintIrToFlowEdges, blueprintIrToFlowNodes } from "./useBlueprintFlowProjection";
import type { BlueprintFlowNodeData } from "./components/BlueprintFlowNode";
import { BlueprintAddNodeMenu } from "../components/BlueprintAddNodeMenu";
import type { BlueprintPaletteContext } from "@/lib/ui-editor/blueprint-nodes/types";

export function cloneBlueprintIr(ir: BlueprintGraphIr): BlueprintGraphIr {
    return structuredClone(ir);
}

export function removeBlueprintNodeFromIr(ir: BlueprintGraphIr, nodeId: string): void {
    const nodes = { ...(ir.nodes ?? {}) };
    delete nodes[nodeId];
    ir.nodes = nodes;
    ir.edges = (ir.edges ?? []).filter(e => e.from.nodeId !== nodeId && e.to.nodeId !== nodeId);
}

type BlueprintFlowCanvasInnerProps = {
    graphKey: string;
    ir: BlueprintGraphIr;
    revision: number;
    selectedNodeId: string | null;
    onSelectNodeId: (id: string | null) => void;
    onCommitIr: (next: BlueprintGraphIr) => void;
    /** When set, right-click on the pane opens a compact search menu to add a node at that position. */
    onAddNodeAtFlowPosition?: (type: string, flowPosition: { x: number; y: number }) => void;
    paletteContext: BlueprintPaletteContext;
};

function BlueprintFlowCanvasInner({
    graphKey,
    ir,
    revision,
    selectedNodeId,
    onSelectNodeId,
    onCommitIr,
    onAddNodeAtFlowPosition,
    paletteContext,
}: BlueprintFlowCanvasInnerProps) {
    const { getNodes, screenToFlowPosition } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<BlueprintFlowNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const irRef = useRef(ir);
    irRef.current = ir;

    /** Avoid onSelectionChange feedback while we push selection from props into React Flow (prevents update loops). */
    const suppressSelectionEventsRef = useRef(false);
    const selectedNodeIdRef = useRef(selectedNodeId);
    selectedNodeIdRef.current = selectedNodeId;

    const [addMenu, setAddMenu] = useState<{
        clientX: number;
        clientY: number;
        flow: { x: number; y: number };
    } | null>(null);

    useEffect(() => {
        const snap = irRef.current;
        suppressSelectionEventsRef.current = true;
        setNodes(blueprintIrToFlowNodes(snap, selectedNodeId));
        setEdges(blueprintIrToFlowEdges(snap));
        const t = window.setTimeout(() => {
            suppressSelectionEventsRef.current = false;
        }, 0);
        return () => window.clearTimeout(t);
    }, [graphKey, revision, selectedNodeId, setEdges, setNodes]);

    const onSelectionChange = useCallback(
        ({ nodes: sel }: { nodes: Node[] }) => {
            if (suppressSelectionEventsRef.current) {
                return;
            }
            const next = sel.length === 1 ? sel[0]!.id : null;
            if (next === selectedNodeIdRef.current) {
                return;
            }
            onSelectNodeId(next);
        },
        [onSelectNodeId],
    );

    const onNodeDragStop = useCallback(() => {
        const next = cloneBlueprintIr(irRef.current);
        applyFlowPositionsToIr(next, getNodes() as Node[]);
        onCommitIr(next);
    }, [getNodes, onCommitIr]);

    const isValidConnection = useCallback((connection: Connection | Edge) => {
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
            const next = cloneBlueprintIr(snap);
            const edgesNext = next.edges ?? [];
            const dup = edgesNext.some(
                e =>
                    e.from.nodeId === connection.source &&
                    e.from.port === (connection.sourceHandle ?? "") &&
                    e.to.nodeId === connection.target &&
                    e.to.port === (connection.targetHandle ?? ""),
            );
            if (dup) {
                return;
            }
            if (!connection.sourceHandle || !connection.targetHandle) {
                return;
            }
            next.edges = [
                ...edgesNext,
                {
                    from: { nodeId: connection.source!, port: connection.sourceHandle },
                    to: { nodeId: connection.target!, port: connection.targetHandle },
                },
            ];
            onCommitIr(next);
        },
        [onCommitIr],
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
            onCommitIr(next);
        },
        [onCommitIr],
    );

    const onNodesDelete = useCallback(
        (deleted: Node[]) => {
            if (deleted.length === 0) {
                return;
            }
            const snap = irRef.current;
            const next = cloneBlueprintIr(snap);
            for (const n of deleted) {
                removeBlueprintNodeFromIr(next, n.id);
            }
            onSelectNodeId(null);
            onCommitIr(next);
        },
        [onCommitIr, onSelectNodeId],
    );

    const onPaneContextMenu = useCallback(
        (e: MouseEvent | ReactMouseEvent<Element>) => {
            if (!onAddNodeAtFlowPosition) {
                return;
            }
            e.preventDefault();
            const clientX = "clientX" in e ? e.clientX : 0;
            const clientY = "clientY" in e ? e.clientY : 0;
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
        <div className="relative h-full w-full min-h-0">
            <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={blueprintFlowNodeTypes}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                isValidConnection={isValidConnection}
                onConnect={onConnect}
                onNodeDragStop={onNodeDragStop}
                onEdgesDelete={onEdgesDelete}
                onNodesDelete={onNodesDelete}
                onPaneContextMenu={onPaneContextMenu}
                onSelectionChange={onSelectionChange}
                fitView
                className="bg-[#0f1115]"
                proOptions={{ hideAttribution: true }}
                deleteKeyCode={["Backspace", "Delete"]}
            >
                <Background color="#334155" gap={20} size={1} />
                <Controls className="!bg-[#1a1d21] !border-white/10 !shadow-lg" />
                <MiniMap
                    className="!bg-[#111315] !border-white/10"
                    maskColor="rgba(15, 23, 42, 0.65)"
                    nodeColor={() => "#0891b2"}
                />
            </ReactFlow>
            {onAddNodeAtFlowPosition && addMenu ? (
                <BlueprintAddNodeMenu
                    open
                    paletteContext={paletteContext}
                    anchor={{ x: addMenu.clientX, y: addMenu.clientY }}
                    flowPosition={addMenu.flow}
                    onClose={() => setAddMenu(null)}
                    onPickType={(type, pos) => onAddNodeAtFlowPosition(type, pos)}
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
