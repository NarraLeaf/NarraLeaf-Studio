import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useId, useMemo, useRef, type CSSProperties } from "react";
import {
    Background,
    MarkerType,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
    useStore,
    type Edge,
    type Node,
    type NodeTypes,
    type Viewport,
} from "@xyflow/react";
import type { StorySceneId } from "@shared/types/story";
import type { Translator } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import { SceneFlowNode, type SceneFlowNodeData } from "./SceneFlowNode";
import {
    SCENE_FLOW_NODE_HEIGHT,
    SCENE_FLOW_NODE_WIDTH,
    type SceneFlowEdgeModel,
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

/** Option texts and conditions are arbitrarily long; an edge label is a hint, not the line itself. */
const EDGE_LABEL_MAX_CHARS = 22;

function clampLabel(text: string): string {
    return text.length > EDGE_LABEL_MAX_CHARS ? `${text.slice(0, EDGE_LABEL_MAX_CHARS - 1)}…` : text;
}

/**
 * What a collapsed edge says about itself.
 *
 * One fork prints its own words (the option the player picks, the condition that has to hold);
 * several print the first plus how many more there are, because the alternative — stacking every
 * branch on one line — is unreadable at any zoom the map is actually used at. With no fork at all
 * the only thing worth saying is how many jumps collapsed into the line, and only when it is more
 * than one.
 *
 * An `else if` arm is prefixed with the container's own "Else if" wording: its condition summary
 * reads exactly like an `if`, and an unqualified one would say this path is taken whenever the
 * condition holds rather than only when the arms above it did not.
 */
function edgeLabel(edge: SceneFlowEdgeModel, t: Translator["t"]): string | undefined {
    const named = edge.branches.map(branch => {
        if (branch.kind === "conditionElse") {
            return t("story.containerHeader.else");
        }
        if (branch.kind === "conditionElseIf") {
            const elseIf = t("story.containerHeader.elseIf");
            return branch.label ? `${elseIf} ${branch.label}` : elseIf;
        }
        return branch.label || t("story.containerHeader.option");
    });
    if (named.length === 0) {
        return edge.jumps.length > 1 ? `×${edge.jumps.length}` : undefined;
    }
    if (named.length === 1) {
        return clampLabel(named[0]);
    }
    return `${clampLabel(named[0])} +${named.length - 1}`;
}

/** The node title's own CSS size at scale 1 — `text-xs`, in px. The scale multiplies it. */
const NODE_TITLE_BASE_PX = 12;

/**
 * How far the embed is allowed to grow its type before the two lines stop fitting the 72px node box
 * (title + meta line-boxes are 16px each at scale 1, plus the node's 16px of vertical padding).
 */
const MAX_NODE_TYPE_SCALE = 1.6;

export interface SceneFlowCanvasProps {
    graph: SceneFlowGraph;
    /** Scenes the author dragged; anything absent falls back to the auto-layout. */
    positionOverrides: Record<StorySceneId, { x: number; y: number }>;
    initialViewport?: SceneFlowViewport;
    /** Highlight one scene as the running / active one (Dev Mode play head). */
    currentSceneId?: StorySceneId | null;
    onOpenScene: (sceneId: StorySceneId) => void;
    onMoveScene: (sceneId: StorySceneId, position: { x: number; y: number }) => void;
    onViewportChange?: (viewport: SceneFlowViewport) => void;
    /**
     * Framing padding for the first fit, as React Flow's viewport fraction. The workspace tab keeps
     * the roomy default; a narrow embed trades the margin for zoom.
     */
    fitPadding?: number;
    /**
     * On-screen px a node title must never render below — CSS size × viewport zoom. Set it and the
     * canvas scales its type up as the fit zooms out; leave it unset (the workspace tab) and nothing
     * about the node's type changes at all.
     *
     * The alternative was refusing to zoom out that far, which fails the other half of the
     * requirement: at a legible zoom a 380px panel cannot hold the whole graph, and a map with nodes
     * off the edge is worse than a small one.
     */
    minTitleRenderedPx?: number;
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
    currentSceneId,
    onOpenScene,
    onMoveScene,
    onViewportChange,
    fitPadding = 0.2,
    minTitleRenderedPx,
}: SceneFlowCanvasProps) {
    // React Flow derives document-wide ids from this (the dot-grid `<pattern>`, edge markers, handle
    // element ids) and falls back to a literal "1" when unset, so two canvases on one page collide.
    // The colons `useId` emits break its internal `querySelector` lookups.
    const flowId = useId().replace(/:/g, "");
    const { t } = useTranslation();

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
            data: { ...node, current: currentSceneId != null && node.sceneId === currentSceneId } as SceneFlowNodeData,
        })),
        [graph, positionOverrides, currentSceneId],
    );

    const projectedEdges = useMemo<Edge[]>(
        () => graph.edges.map(edge => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: "smoothstep",
            // Two jumps A->B collapse into one line; the label is what tells the paths apart.
            label: edgeLabel(edge, t),
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
        [graph, t],
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
            second = requestAnimationFrame(() => fitView({ padding: fitPadding, duration: 0 }));
        });
        return () => {
            cancelAnimationFrame(first);
            cancelAnimationFrame(second);
        };
        // Deliberately first-mount only: re-framing on every graph edit would yank the view away.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fitView]);

    // Live zoom, so the type scale below follows a fit, a pinch and the zoom buttons alike.
    const zoom = useStore(state => state.transform[2]);
    const typeScale = minTitleRenderedPx
        ? Math.min(MAX_NODE_TYPE_SCALE, Math.max(1, minTitleRenderedPx / (NODE_TITLE_BASE_PX * (zoom || 1))))
        : 1;

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
            // Read by SceneFlowNode's type. Unset in the workspace tab (scale 1), where the CSS
            // fallbacks in the node leave every computed size exactly where it was.
            style={typeScale === 1 ? undefined : ({ "--nl-scene-flow-type-scale": String(typeScale) } as CSSProperties)}
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
