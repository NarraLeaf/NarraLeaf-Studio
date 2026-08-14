import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
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
    type Connection,
    type Edge,
    type Node,
    type NodeTypes,
    type Viewport,
} from "@xyflow/react";
import { ExternalLink, Unlink } from "lucide-react";
import type { StoryBlockId, StorySceneId } from "@shared/types/story";
import type { Translator } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import { ContextMenu, useContextMenu, type ContextMenuDef } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
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
    type SceneFlowBranchNodeModel,
    type SceneFlowEdgeModel,
    type SceneFlowGraph,
} from "./sceneFlowModel";
import { buildSceneFlowLines, type SceneFlowDrawnLine } from "./sceneFlowLines";
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

/**
 * What a switched-off jump's line keeps.
 *
 * Weaker than a dim but not invisible: the branch is written and the author has to be able to see
 * that it is, while nothing about the line should read as a path a player takes.
 */
const DISABLED_LINE_OPACITY = 0.45;

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
function edgeLabel(
    edge: Pick<SceneFlowEdgeModel, "branches" | "jumps">,
    t: Translator["t"],
): string | undefined {
    const named = edge.branches.map(branch => formatSceneFlowArmLabel(branch, t));
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

/**
 * A line the author has just drawn between two boxes — a request, not a change.
 *
 * The map never writes it. It says which scene the jump would leave from, which one it would go to,
 * and (when the line was pulled off an option's row rather than the scene's rim) which arm it belongs
 * inside; the surface holding the map turns that into a `/jump` waiting in the scene editor for the
 * author's Enter. See `SceneFlowEditing`.
 */
export type SceneFlowConnectProposal = {
    sourceSceneId: StorySceneId;
    targetSceneId: StorySceneId;
    /** The choice option / condition arm the line left from, when it left from one. */
    branchBlockId?: StoryBlockId;
};

/**
 * What an *interactive* reading of the map may ask for. Absent — the Dev Mode embed, a frozen
 * workspace — leaves the map exactly as read-only as it has always been: no handles on the rims, no
 * delete key, no menu on a line.
 *
 * Every entry is a request aimed at the story editor, never a write of its own. The map stays a
 * derivation of the document: it shows the jumps that exist, and if the author backs out of the line
 * it proposed, nothing about it changes. That is the whole design — a diagram that edits itself and
 * then writes the story to match is a second, quieter copy of the story, and the two drift.
 */
export type SceneFlowEditing = {
    /** A line was drawn. Open the source scene with the `/jump` typed but uncommitted. */
    connect: (proposal: SceneFlowConnectProposal) => void;
    /**
     * A line was deleted. Confirm, then remove exactly the jump blocks it named — the map hands the
     * blocks over rather than the pair of scenes, because with a scene expanded a line is only some
     * of the jumps between them (see {@link SceneFlowDrawnLine}).
     */
    disconnect: (line: SceneFlowDrawnLine) => void | Promise<void>;
    /** Show me the jumps behind this line, in the editor. */
    reveal?: (line: SceneFlowDrawnLine) => void;
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
    /** Turns the map into an interactive reading of the story. See {@link SceneFlowEditing}. */
    editing?: SceneFlowEditing;
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
    editing,
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
                            ? !isBranchEmphasized(branch, branchEdgeIdsByBranchId.get(branch.id), highlight)
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

    /**
     * Every line on screen, with the jump blocks it actually stands for.
     *
     * One walk, feeding both the rendering below and the delete gesture, because the two must not
     * disagree about which jumps a line is: with a scene expanded, some of its jumps have moved onto
     * arm rows and the scene line is only the RESIDUAL. A delete that re-derived "the jumps of the
     * A→B edge" from the graph would take the arm-owned ones with it — lines the author can still see
     * drawn beside the one they deleted.
     */
    const drawnLines = useMemo(() => buildSceneFlowLines(graph, expandedScenes), [graph, expandedScenes]);

    const projectedEdges = useMemo<Edge[]>(() => {
        const dim = (edgeId: string): number | undefined =>
            highlight && !highlight.edgeIds.has(edgeId) ? DIMMED_OPACITY : undefined;

        return drawnLines.map(line => {
            // A switched-off jump fades rather than disappears: the author wrote this branch, and a
            // map that removed it would be answering "what will the compiler emit" instead of "what
            // does my story look like". Fading composes with the highlight dim rather than replacing
            // it - a disabled line outside the highlighted route is the faintest thing on the map,
            // which is the right reading of both facts at once.
            const opacity = (dim(line.id) ?? 1) * (line.disabled ? DISABLED_LINE_OPACITY : 1);
            const fromArm = line.sourceBranchId !== undefined;
            return {
                id: line.id,
                source: fromArm ? line.sourceBranchId! : line.sourceSceneId,
                ...(fromArm ? { sourceHandle: line.sourceBranchId } : {}),
                target: line.targetSceneId,
                type: "smoothstep",
                deletable: Boolean(editing),
                // A scene line collapses two jumps A->B into one, and its label is what tells the
                // paths apart. An arm's line takes only the chip: the arm's words are already on the
                // row it starts at, and repeating them along the line is noise at exactly the zoom
                // the map is read at.
                label: fromArm ? branchChips?.[line.sourceBranchId!] : edgeLabel(line, t),
                labelShowBg: false,
                labelStyle: { fill: "rgb(var(--nl-fg-subtle))", fontSize: 10, opacity },
                markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgb(var(--nl-fg-muted))" },
                style: {
                    stroke: "rgb(var(--nl-fg-muted))",
                    strokeWidth: 1.5,
                    // Dashed = the jump only fires on some runs (it sits under a condition or a
                    // loop). A line leaving an arm is conditional by construction.
                    strokeDasharray: line.conditional ? "5 4" : undefined,
                    opacity,
                },
                interactionWidth: 20,
            } satisfies Edge;
        });
    }, [drawnLines, branchChips, highlight, t, editing]);

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
        // Selection carried across the rebuild for the same reason the nodes carry theirs: an edit
        // anywhere in the story re-projects every line, and a selected line that silently deselects
        // takes the Delete key's target with it.
        setEdges(current => {
            const selection = new Set(current.filter(edge => edge.selected).map(edge => edge.id));
            return projectedEdges.map(edge => (selection.has(edge.id) ? { ...edge, selected: true } : edge));
        });
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

    // ---------------------------------------------------------------------------
    // Interactive reading (see SceneFlowEditing). Every branch below is inert without `editing`.
    // ---------------------------------------------------------------------------

    /** Lit rims for the length of a drag — see `SCENE_FLOW_CONNECTABLE_HANDLE_CLASS`. */
    const [connecting, setConnecting] = useState(false);
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuEdgeId, setMenuEdgeId] = useState<string | null>(null);

    const lineById = useMemo(() => new Map(drawnLines.map(line => [line.id, line])), [drawnLines]);

    /** The arm behind a source handle: its own block, and the scene the row belongs to. */
    const armByNodeId = useMemo(() => {
        const byNodeId = new Map<string, { blockId: StoryBlockId; sceneId: StorySceneId }>();
        for (const branch of graph.branches) {
            byNodeId.set(branch.id, { blockId: branch.blockId, sceneId: branch.sceneId });
        }
        return byNodeId;
    }, [graph]);

    /**
     * A line the author finished drawing.
     *
     * Resolved here rather than in `isValidConnection`, which runs on every pointer move over a
     * handle and can only say yes or no — it cannot say *why*, and a drag that silently refuses to
     * land reads as the map being broken. What it resolves is which SCENE the line left: a line off
     * an arm's row starts on the branch node, whose id is not a scene id, and handing that straight
     * on would open the editor for a scene that does not exist.
     *
     * A scene connected to itself is passed through rather than rejected: a `/jump` back into the
     * current scene is a legal thing to write (the node badges count them), and refusing the gesture
     * would be the map overruling the story.
     */
    const handleConnect = useCallback((connection: Connection) => {
        if (!editing) {
            return;
        }
        const arm = connection.sourceHandle ? armByNodeId.get(connection.sourceHandle) : undefined;
        const sourceSceneId = arm ? arm.sceneId : connection.source;
        if (!sourceSceneId || !connection.target) {
            return;
        }
        editing.connect({
            sourceSceneId,
            targetSceneId: connection.target,
            ...(arm ? { branchBlockId: arm.blockId } : {}),
        });
    }, [armByNodeId, editing]);

    /**
     * Delete, from the key or the menu — and always a veto.
     *
     * React Flow is asking permission to drop the line from its own array. The answer is always no:
     * the line is not React Flow's to drop, it is a reading of jump blocks in the document, and it
     * disappears when — and only when — those blocks do. Removing it optimistically would show the
     * author a map that disagrees with their story for as long as the confirm dialog is open, and
     * would leave it disagreeing forever if they cancelled.
     */
    const handleBeforeDelete = useCallback(async ({ edges: deleted }: { edges: Edge[] }) => {
        if (editing) {
            for (const edge of deleted) {
                const line = lineById.get(edge.id);
                if (line) {
                    // Awaited, and so one line at a time: the confirm is a dialog, and firing the
                    // whole selection at once stacks several of them on top of each other with no
                    // way to tell which line each is asking about.
                    await editing.disconnect(line);
                }
            }
        }
        return false;
    }, [editing, lineById]);

    const handleEdgeContextMenu = useCallback((event: ReactMouseEvent, edge: Edge) => {
        if (!editing) {
            return;
        }
        setMenuEdgeId(edge.id);
        showMenu(event);
    }, [editing, showMenu]);

    const closeMenu = useCallback(() => {
        hideMenu();
        // Forgotten as well as hidden: the hook keeps its last position, and a stale edge id would
        // let the next open flash the previous line's menu before the new one is set.
        setMenuEdgeId(null);
    }, [hideMenu]);

    const menuItems = useMemo<ContextMenuDef>(() => {
        const line = menuEdgeId ? lineById.get(menuEdgeId) : null;
        if (!editing || !line) {
            return [];
        }
        const items: ContextMenuDef = [];
        if (editing.reveal) {
            const reveal = editing.reveal;
            items.push({
                id: "reveal",
                label: t("story.flow.edge.reveal"),
                icon: <ExternalLink className="h-3.5 w-3.5" />,
                onClick: () => reveal(line),
            });
            items.push({ id: "separator", separator: true });
        }
        items.push({
            id: "disconnect",
            label: t("story.flow.edge.disconnect"),
            icon: <Unlink className="h-3.5 w-3.5" />,
            onClick: () => editing.disconnect(line),
        });
        return items;
    }, [editing, lineById, menuEdgeId, t]);

    return (
        <>
        {menuState.visible && menuItems.length > 0 && (
            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible
                iconsEnabled
                onClose={closeMenu}
            />
        )}
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
            onConnect={handleConnect}
            onConnectStart={() => setConnecting(true)}
            onConnectEnd={() => setConnecting(false)}
            onBeforeDelete={editing ? handleBeforeDelete : undefined}
            onEdgeContextMenu={handleEdgeContextMenu}
            defaultViewport={initialViewport ?? undefined}
            // The map never edits the story itself, with or without `editing` — it reports it. What
            // an interactive reading adds is a way to ASK: a line dragged between two boxes opens
            // the scene editor with the `/jump` typed and waiting, because that is the only surface
            // that can show which fork the jump lands under and what guards it. Deleting a line is
            // the mirror image — a confirm, then the jump blocks it stood for.
            //
            // Dragging a node is allowed either way: that moves the picture, not the story.
            nodesConnectable={Boolean(editing)}
            // Retargeting a line would rewrite an existing jump straight from the map, with none of
            // the context the connect gesture is careful to send the author to. Deliberately absent.
            edgesReconnectable={false}
            edgesFocusable={Boolean(editing)}
            deleteKeyCode={editing ? ["Backspace", "Delete"] : null}
            nodesDraggable
            panOnScroll
            zoomOnScroll={false}
            zoomOnPinch
            className={cn("narraleaf-scene-flow bg-surface", connecting && "narraleaf-scene-flow-connecting")}
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
        </>
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
function isBranchEmphasized(
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
