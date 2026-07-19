import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useId, useMemo, useRef } from "react";
import {
    Background,
    MarkerType,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Edge,
    type Node,
    type NodeTypes,
    type Viewport,
} from "@xyflow/react";
import type { StorySceneId } from "@shared/types/story";
import { SceneFlowNode, type SceneFlowNodeData } from "./SceneFlowNode";
import {
    SCENE_FLOW_NODE_HEIGHT,
    SCENE_FLOW_NODE_WIDTH,
    type SceneFlowGraph,
} from "./sceneFlowModel";
import { SceneFlowZoomControls } from "./SceneFlowZoomControls";
import type { SceneFlowViewport } from "./sceneFlowTabId";

/** Stable reference for React Flow (do not recreate per render). */
const sceneFlowNodeTypes = { scene: SceneFlowNode } satisfies NodeTypes;

/**
 * Below this the whole graph fits on screen and the minimap is just chrome — most stories have a
 * couple of dozen scenes, not the hundreds of nodes a blueprint graph reaches.
 */
const MINIMAP_MIN_NODES = 12;

export interface SceneFlowCanvasProps {
    graph: SceneFlowGraph;
    /** Scenes the author dragged; anything absent falls back to the auto-layout. */
    positionOverrides: Record<StorySceneId, { x: number; y: number }>;
    initialViewport?: SceneFlowViewport;
    onOpenScene: (sceneId: StorySceneId) => void;
    onMoveScene: (sceneId: StorySceneId, position: { x: number; y: number }) => void;
    onViewportChange?: (viewport: SceneFlowViewport) => void;
}

function resolvePosition(
    sceneId: StorySceneId,
    graph: SceneFlowGraph,
    overrides: Record<StorySceneId, { x: number; y: number }>,
): { x: number; y: number } {
    return overrides[sceneId] ?? graph.positions[sceneId] ?? { x: 0, y: 0 };
}

function SceneFlowCanvasInner({
    graph,
    positionOverrides,
    initialViewport,
    onOpenScene,
    onMoveScene,
    onViewportChange,
}: SceneFlowCanvasProps) {
    // React Flow derives document-wide ids from this (the dot-grid `<pattern>`, edge markers, handle
    // element ids) and falls back to a literal "1" when unset, so two canvases on one page collide.
    // The colons `useId` emits break its internal `querySelector` lookups.
    const flowId = useId().replace(/:/g, "");

    const { fitView } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<SceneFlowNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const isDraggingRef = useRef(false);

    const projectedNodes = useMemo<Node<SceneFlowNodeData>[]>(
        () => graph.nodes.map(node => ({
            id: node.sceneId,
            type: "scene",
            position: resolvePosition(node.sceneId, graph, positionOverrides),
            width: SCENE_FLOW_NODE_WIDTH,
            height: SCENE_FLOW_NODE_HEIGHT,
            // Delete belongs to edges here; scenes are deleted from the outline, not the map.
            deletable: false,
            // Projected without `selected`: selection has to flow through `applyNodeChanges`, or
            // React Flow raises error #015.
            data: node as SceneFlowNodeData,
        })),
        [graph, positionOverrides],
    );

    const projectedEdges = useMemo<Edge[]>(
        () => graph.edges.map(edge => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: "smoothstep",
            // Two jumps A->B collapse into one line; the count is what tells them apart.
            label: edge.jumps.length > 1 ? `×${edge.jumps.length}` : undefined,
            labelShowBg: false,
            labelStyle: { fill: "rgb(var(--nl-fg-subtle))", fontSize: 10 },
            markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgb(var(--nl-fg-muted))" },
            style: {
                stroke: "rgb(var(--nl-fg-muted))",
                strokeWidth: 1.5,
                // Dashed = the jump only fires on some runs (it sits under a condition or a loop).
                strokeDasharray: edge.conditional ? "5 4" : undefined,
            },
            interactionWidth: 20,
        })),
        [graph],
    );

    useEffect(() => {
        // Replacing the array mid-drag drops React Flow's drag state (dev warning #015), so live
        // positions win until the pointer is released.
        if (isDraggingRef.current) {
            return;
        }
        setNodes(current => {
            const selection = new Set(current.filter(node => node.selected).map(node => node.id));
            return projectedNodes.map(node =>
                selection.has(node.id) ? { ...node, selected: true } : node);
        });
    }, [projectedNodes, setNodes]);

    useEffect(() => {
        setEdges(projectedEdges);
    }, [projectedEdges, setEdges]);

    // Frame the graph on first paint, unless the tab already carries a viewport to restore.
    const graphKey = graph.nodes.length;
    useEffect(() => {
        if (initialViewport || graphKey === 0) {
            return undefined;
        }
        let second = 0;
        const first = requestAnimationFrame(() => {
            second = requestAnimationFrame(() => fitView({ padding: 0.2, duration: 0 }));
        });
        return () => {
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
        };
        // Deliberately first-mount only: re-framing on every graph edit would yank the view away.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitView]);

    const handleNodeDragStart = useCallback(() => {
        isDraggingRef.current = true;
    }, []);

    const handleNodeDragStop = useCallback((_: unknown, node: Node) => {
        isDraggingRef.current = false;
        onMoveScene(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
    }, [onMoveScene]);

    const handleNodeDoubleClick = useCallback((_: unknown, node: Node) => {
        onOpenScene(node.id);
    }, [onOpenScene]);

    const handleMoveEnd = useCallback((_: unknown, viewport: Viewport) => {
        onViewportChange?.({ x: viewport.x, y: viewport.y, zoom: viewport.zoom });
    }, [onViewportChange]);

    return (
        <ReactFlow
            id={flowId}
            nodes={nodes}
            edges={edges}
            nodeTypes={sceneFlowNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onNodeDoubleClick={handleNodeDoubleClick}
            onMoveEnd={handleMoveEnd}
            defaultViewport={initialViewport ?? undefined}
            // The map reports the story; it does not edit it. Jumps are authored in the scene
            // editor, where the block they belong to and its surrounding control flow are visible -
            // a line drawn between two boxes hides which scene owns the jump and what guards it.
            // Dragging a node is still allowed: that moves the picture, not the story.
            nodesConnectable={false}
            edgesReconnectable={false}
            edgesFocusable={false}
            deleteKeyCode={null}
            nodesDraggable
            panOnScroll
            zoomOnScroll={false}
            zoomOnPinch
            className="narraleaf-scene-flow bg-surface"
            proOptions={{ hideAttribution: true }}
        >
            <Background color="rgb(var(--nl-fg-subtle))" gap={20} size={1} />
            <SceneFlowZoomControls />
            {graph.nodes.length >= MINIMAP_MIN_NODES && (
                <MiniMap
                    pannable
                    // Muted rather than accent-filled: at this size the map is an orientation aid,
                    // and a grid of saturated blocks reads louder than the graph it summarises.
                    nodeColor="rgb(var(--nl-fg-subtle))"
                    maskColor="rgb(var(--nl-surface-sunken) / 0.6)"
                    className="!h-24 !w-40 !bg-surface-sunken !border-edge cursor-grab active:cursor-grabbing"
                />
            )}
        </ReactFlow>
    );
}

export function SceneFlowCanvas(props: SceneFlowCanvasProps) {
    return (
        <div className="h-full w-full min-h-0">
            <ReactFlowProvider>
                <SceneFlowCanvasInner {...props} />
            </ReactFlowProvider>
        </div>
    );
}
