import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useRef } from "react";
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
};

function BlueprintFlowCanvasInner({
    graphKey,
    ir,
    revision,
    selectedNodeId,
    onSelectNodeId,
    onCommitIr,
}: BlueprintFlowCanvasInnerProps) {
    const { getNodes } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<BlueprintFlowNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const irRef = useRef(ir);
    irRef.current = ir;

    useEffect(() => {
        const snap = irRef.current;
        setNodes(blueprintIrToFlowNodes(snap, selectedNodeId));
        setEdges(blueprintIrToFlowEdges(snap));
    }, [graphKey, revision, selectedNodeId, setEdges, setNodes]);

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

    return (
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
            onSelectionChange={({ nodes: sel }) => {
                onSelectNodeId(sel.length === 1 ? sel[0].id : null);
            }}
            fitView
            className="bg-[#0d0f11]"
            proOptions={{ hideAttribution: true }}
            deleteKeyCode={["Backspace", "Delete"]}
        >
            <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[min(100%,20rem)] rounded border border-white/10 bg-[#0b0d12]/95 px-2 py-1.5 text-[10px] leading-snug text-gray-400 shadow-md backdrop-blur-sm">
                <span className="font-medium text-gray-300">Execution graph</span> — connect white execution pins only.
                Data pins (e.g. Branch condition) are edited in the inspector until typed data edges ship.
            </div>
            <Background color="#334155" gap={20} size={1} />
            <Controls className="!bg-[#1a1d21] !border-white/10 !shadow-lg" />
            <MiniMap
                className="!bg-[#111315] !border-white/10"
                maskColor="rgba(15, 23, 42, 0.65)"
                nodeColor={() => "#0891b2"}
            />
        </ReactFlow>
    );
}

export type BlueprintFlowCanvasProps = Omit<BlueprintFlowCanvasInnerProps, never>;

export function BlueprintFlowCanvas(props: BlueprintFlowCanvasProps) {
    return (
        <div className="h-full w-full min-h-[280px]">
            <ReactFlowProvider>
                <BlueprintFlowCanvasInner {...props} />
            </ReactFlowProvider>
        </div>
    );
}
