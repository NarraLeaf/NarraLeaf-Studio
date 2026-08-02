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
import type { StoryBlockId, StorySceneId } from "@shared/types/story";
import type { Translator } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import { SceneFlowNode, type SceneFlowNodeData } from "./SceneFlowNode";
import {
    formatSceneFlowArmLabel,
    SceneFlowBranchNode,
    type SceneFlowBranchNodeData,
} from "./SceneFlowBranchNode";
import {
    SCENE_FLOW_BRANCH_HEADER_HEIGHT,
    SCENE_FLOW_BRANCH_ROW_HEIGHT,
    SCENE_FLOW_NODE_HEIGHT,
    SCENE_FLOW_NODE_WIDTH,
    type SceneFlowBranchLabel,
    type SceneFlowBranchNodeModel,
    type SceneFlowEdgeModel,
    type SceneFlowGraph,
} from "./sceneFlowModel";
import { SceneFlowZoomControls } from "./SceneFlowZoomControls";
import type { SceneFlowViewport } from "./sceneFlowTabId";

/** Stable reference for React Flow (do not recreate per render). */
const sceneFlowNodeTypes = { scene: SceneFlowNode, branch: SceneFlowBranchNode } satisfies NodeTypes;

/**
 * Below this the whole graph fits on screen and the minimap is just chrome — most stories have a
 * couple of dozen scenes, not the hundreds of nodes a blueprint graph reaches.
 */
const MINIMAP_MIN_NODES = 12;

/** Option texts and conditions are arbitrarily long; an edge label is a hint, not the line itself. */
const EDGE_LABEL_MAX_CHARS = 22;

/** What a dimmed element keeps. Low enough to recede, high enough that the path still exists. */
const DIMMED_OPACITY = 0.3;

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
 * The wording of a single arm comes from `formatSceneFlowArmLabel`, shared with the branch rows: an
 * expanded scene draws the arm and the line that leaves it side by side, and two derivations of the
 * same `else` would word them differently.
 */
function edgeLabel(edge: SceneFlowEdgeModel, t: Translator["t"]): string | undefined {
    const named = edge.branches.map(branch => formatSceneFlowArmLabel(branch, t));
    if (named.length === 0) {
        return edge.jumps.length > 1 ? `×${edge.jumps.length}` : undefined;
    }
    if (named.length === 1) {
        return clampLabel(named[0]);
    }
    return `${clampLabel(named[0])} +${named.length - 1}`;
}

/**
 * The scene edge minus the jumps an expanded scene's branch rows have taken over, or null when
 * nothing is left of it.
 *
 * Suppressing every scene edge of an expanded scene is nearly right and quietly wrong: a jump
 * written outside all of its forks belongs to no arm, has no branch row to leave from, and would
 * simply vanish from the map. So the edge is rebuilt from what the rows did *not* claim, label
 * included — the alternative is a line labelled with an option that is no longer on it.
 */
function residualSceneEdge(edge: SceneFlowEdgeModel, claimed: ReadonlySet<StoryBlockId>): SceneFlowEdgeModel | null {
    const jumps = edge.jumps.filter(jump => !claimed.has(jump.blockId));
    if (jumps.length === 0) {
        return null;
    }
    if (jumps.length === edge.jumps.length) {
        return edge;
    }
    const seen = new Set<string>();
    const branches: SceneFlowBranchLabel[] = [];
    for (const jump of jumps) {
        if (!jump.branch) {
            continue;
        }
        const key = `${jump.branch.kind}:${jump.branch.label}`;
        if (!seen.has(key)) {
            seen.add(key);
            branches.push(jump.branch);
        }
    }
    return { ...edge, jumps, conditional: jumps.every(jump => jump.conditional), branches };
}

/** The node title's own CSS size at scale 1 — `text-xs`, in px. The scale multiplies it. */
const NODE_TITLE_BASE_PX = 12;

/**
 * How far the embed is allowed to grow its type before the two lines stop fitting the 72px node box
 * (title + meta line-boxes are 16px each at scale 1, plus the node's 16px of vertical padding). The
 * branch rows are laid out against the same ceiling — see `SceneFlowBranchNode`'s row styles.
 */
const MAX_NODE_TYPE_SCALE = 1.6;

/**
 * Which scenes and edges the map is currently making a point about.
 *
 * Absent or null means "no point is being made" and nothing dims — deliberately distinct from an
 * empty mask, which dims everything and is a legitimate state (a route that reaches nothing).
 */
export type SceneFlowHighlight = {
    sceneIds: ReadonlySet<StorySceneId>;
    /** Scene edges and branch edges alike; a branch node's own id counts too. */
    edgeIds: ReadonlySet<string>;
};

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
     * Scenes drawn with their branch arms exposed. The graph must have been built with this same
     * set (`buildSceneFlowGraph(document, { expandedSceneIds })`) or the rows will not fit the
     * boxes the layout packed. Absent or empty renders exactly the collapsed map.
     */
    expandedSceneIds?: ReadonlySet<StorySceneId>;
    /**
     * Chevron click. Absent means the surface does not offer expansion and no chevron is drawn —
     * the map still renders any `expandedSceneIds` it is handed.
     */
    onToggleSceneExpanded?: (sceneId: StorySceneId) => void;
    /**
     * Short chip text per branch node id — `+2`, `−1`, `=5`, `?`. Drawn on the arm's row and on the
     * lines leaving it. Plain strings on purpose: whether the number came from a variable pass, a
     * route count or a live run is the caller's business, not the map's.
     */
    branchChips?: Record<string, string>;
    /** Short chip text per scene id — a cumulative range, a route count. */
    sceneChips?: Record<StorySceneId, string>;
    /** Emphasis mask; anything outside it dims. Absent or null dims nothing. */
    highlight?: SceneFlowHighlight | null;
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
    expandedSceneIds,
    onToggleSceneExpanded,
    branchChips,
    sceneChips,
    highlight,
    fitPadding = 0.2,
    minTitleRenderedPx,
}: SceneFlowCanvasProps) {
    // React Flow derives document-wide ids from this (the dot-grid `<pattern>`, edge markers, handle
    // element ids) and falls back to a literal "1" when unset, so two canvases on one page collide.
    // The colons `useId` emits break its internal `querySelector` lookups.
    const flowId = useId().replace(/:/g, "");
    const { t } = useTranslation();

    const { fitView } = useReactFlow();
    const [nodes, setNodes, onNodesChange] = useNodesState<Node<SceneFlowNodeData | SceneFlowBranchNodeData>>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const isDraggingRef = useRef(false);

    const branchesBySceneId = useMemo(() => {
        const bySceneId = new Map<StorySceneId, SceneFlowBranchNodeModel[]>();
        for (const branch of graph.branches) {
            const list = bySceneId.get(branch.sceneId);
            if (list) {
                list.push(branch);
            } else {
                bySceneId.set(branch.sceneId, [branch]);
            }
        }
        return bySceneId;
    }, [graph]);

    /** Which lines leave which arm — the emphasis mask is stated in edge ids, not arm ids. */
    const branchEdgeIdsByBranchId = useMemo(() => {
        const byBranchId = new Map<string, string[]>();
        for (const edge of graph.branchEdges) {
            const list = byBranchId.get(edge.sourceBranchId);
            if (list) {
                list.push(edge.id);
            } else {
                byBranchId.set(edge.sourceBranchId, [edge.id]);
            }
        }
        return byBranchId;
    }, [graph]);

    /**
     * Scenes actually drawn expanded. A scene with no arms grows no box however it is flagged —
     * the same gate the model applies when it sizes the node, so the two cannot disagree.
     */
    const expandedScenes = useMemo(() => {
        const result = new Set<StorySceneId>();
        if (!expandedSceneIds) {
            return result;
        }
        for (const [sceneId, branches] of branchesBySceneId) {
            if (branches.length > 0 && expandedSceneIds.has(sceneId)) {
                result.add(sceneId);
            }
        }
        return result;
    }, [branchesBySceneId, expandedSceneIds]);

    const projectedNodes = useMemo<Node<SceneFlowNodeData | SceneFlowBranchNodeData>[]>(() => {
        const sceneNodes = graph.nodes.map(node => {
            const size = graph.nodeSizes[node.sceneId];
            return {
                id: node.sceneId,
                type: "scene",
                position: resolvePosition(node.sceneId, graph, positionOverrides),
                width: size?.width ?? SCENE_FLOW_NODE_WIDTH,
                height: size?.height ?? SCENE_FLOW_NODE_HEIGHT,
                // Delete belongs to edges here; scenes are deleted from the outline, not the map.
                deletable: false,
                // Projected without `selected`: selection has to flow through `applyNodeChanges`, or
                // React Flow raises error #015.
                data: {
                    ...node,
                    current: currentSceneId != null && node.sceneId === currentSceneId,
                    height: size?.height ?? SCENE_FLOW_NODE_HEIGHT,
                    armCount: branchesBySceneId.get(node.sceneId)?.length ?? 0,
                    expanded: expandedScenes.has(node.sceneId),
                    chip: sceneChips?.[node.sceneId],
                    dimmed: highlight ? !highlight.sceneIds.has(node.sceneId) : false,
                    onToggleExpanded: onToggleSceneExpanded,
                } as SceneFlowNodeData,
            };
        });

        // React Flow needs every parent to precede its children in the array, so the arms go after
        // the whole scene layer rather than next to the scene that owns them.
        const branchNodes: Node<SceneFlowBranchNodeData>[] = [];
        for (const sceneId of expandedScenes) {
            let offset = SCENE_FLOW_NODE_HEIGHT;
            let previousForkId: string | null = null;
            for (const branch of branchesBySceneId.get(sceneId) ?? []) {
                const showForkHeader = branch.forkId !== previousForkId;
                previousForkId = branch.forkId;
                const height = (showForkHeader ? SCENE_FLOW_BRANCH_HEADER_HEIGHT : 0)
                    + SCENE_FLOW_BRANCH_ROW_HEIGHT;
                branchNodes.push({
                    id: branch.id,
                    type: "branch",
                    parentId: sceneId,
                    extent: "parent",
                    // The rows are a reading of the scene, not objects of their own: dragging one
                    // out of its box or selecting it would both claim it is.
                    draggable: false,
                    selectable: false,
                    deletable: false,
                    position: { x: 0, y: offset },
                    width: SCENE_FLOW_NODE_WIDTH,
                    height,
                    data: {
                        ...branch,
                        showForkHeader,
                        chip: branchChips?.[branch.id],
                        dimmed: highlight
                            ? !isBranchEmphasised(branch, branchEdgeIdsByBranchId.get(branch.id), highlight)
                            : false,
                    } as SceneFlowBranchNodeData,
                });
                offset += height;
            }
        }

        return [...sceneNodes, ...branchNodes];
    }, [
        graph,
        positionOverrides,
        currentSceneId,
        branchesBySceneId,
        branchEdgeIdsByBranchId,
        expandedScenes,
        branchChips,
        sceneChips,
        highlight,
        onToggleSceneExpanded,
    ]);

    const projectedEdges = useMemo<Edge[]>(() => {
        // Jumps an expanded scene's arms have taken over, so the scene edge does not draw them twice.
        const claimedJumps = new Set<StoryBlockId>();
        for (const edge of graph.branchEdges) {
            if (!expandedScenes.has(edge.sourceSceneId)) {
                continue;
            }
            for (const jump of edge.jumps) {
                claimedJumps.add(jump.blockId);
            }
        }

        const dim = (edgeId: string): number | undefined =>
            highlight && !highlight.edgeIds.has(edgeId) ? DIMMED_OPACITY : undefined;

        const result: Edge[] = [];
        for (const edge of graph.edges) {
            const residual = expandedScenes.has(edge.source)
                ? residualSceneEdge(edge, claimedJumps)
                : edge;
            if (!residual) {
                continue;
            }
            const opacity = dim(edge.id);
            result.push({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                type: "smoothstep",
                // Two jumps A->B collapse into one line; the label is what tells the paths apart.
                label: edgeLabel(residual, t),
                labelShowBg: false,
                labelStyle: { fill: "rgb(var(--nl-fg-subtle))", fontSize: 10, opacity },
                markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgb(var(--nl-fg-muted))" },
                style: {
                    stroke: "rgb(var(--nl-fg-muted))",
                    strokeWidth: 1.5,
                    // Dashed = the jump only fires on some runs (it sits under a condition or a loop).
                    strokeDasharray: residual.conditional ? "5 4" : undefined,
                    opacity,
                },
                interactionWidth: 20,
            });
        }

        for (const edge of graph.branchEdges) {
            if (!expandedScenes.has(edge.sourceSceneId)) {
                continue;
            }
            const opacity = dim(edge.id);
            result.push({
                id: edge.id,
                source: edge.sourceBranchId,
                sourceHandle: edge.sourceBranchId,
                target: edge.target,
                type: "smoothstep",
                // Only the chip: the arm's words are already on the row this line starts at, and
                // repeating them along the line is noise at exactly the zoom the map is read at.
                label: branchChips?.[edge.sourceBranchId],
                labelShowBg: false,
                labelStyle: { fill: "rgb(var(--nl-fg-subtle))", fontSize: 10, opacity },
                markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgb(var(--nl-fg-muted))" },
                style: {
                    stroke: "rgb(var(--nl-fg-muted))",
                    strokeWidth: 1.5,
                    // A branch edge leaves an arm, so it is conditional by construction.
                    strokeDasharray: "5 4",
                    opacity,
                },
                interactionWidth: 20,
            });
        }
        return result;
    }, [graph, expandedScenes, branchChips, highlight, t]);

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
        // Arms ride along with the box they belong to; only the scene has a position worth storing.
        if (node.type !== "scene") {
            return;
        }
        onMoveScene(node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y) });
    }, [onMoveScene]);

    const handleNodeDoubleClick = useCallback((_: unknown, node: Node) => {
        // An arm row is drawn inside its scene's box, so double-clicking one reads as double-clicking
        // the scene — opening its editor is what the author asked for either way.
        const sceneId = node.type === "branch" ? node.parentId : node.id;
        if (sceneId) {
            onOpenScene(sceneId);
        }
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

/**
 * Whether an arm survives the emphasis mask.
 *
 * An arm is spoken for by the lines that leave it, so it stays bright when one of them does — or
 * when the caller named the arm itself, which is how an arm that moves a variable but jumps nowhere
 * gets to stay lit. An arm with no lines at all has nothing of its own to be judged on and follows
 * its scene; dimming it independently would say the fork has fewer answers than it does.
 */
function isBranchEmphasised(
    branch: SceneFlowBranchNodeModel,
    ownEdgeIds: readonly string[] | undefined,
    highlight: SceneFlowHighlight,
): boolean {
    if (highlight.edgeIds.has(branch.id)) {
        return true;
    }
    if (!ownEdgeIds || ownEdgeIds.length === 0) {
        return highlight.sceneIds.has(branch.sceneId);
    }
    return ownEdgeIds.some(edgeId => highlight.edgeIds.has(edgeId));
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
