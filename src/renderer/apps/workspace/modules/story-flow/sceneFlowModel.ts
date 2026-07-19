/**
 * Pure projection: story document -> scene graph + layered auto-layout.
 *
 * Free of React and @xyflow/react so the graph shape and the layout stay unit-testable and the
 * canvas can remain a thin renderer. Jumps never cross stories (`targetSceneId` resolves inside the
 * same document), so one document is one self-contained graph.
 */

import type {
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";

/** Node box size. The layout and the node component must agree on these. */
export const SCENE_FLOW_NODE_WIDTH = 216;
export const SCENE_FLOW_NODE_HEIGHT = 72;

const COLUMN_GAP = 96;
const ROW_GAP = 28;
/**
 * A hub scene with many branches — or a story with no jumps at all, where every scene is its own
 * root — would otherwise run off the bottom of the canvas as one endless column.
 */
const MAX_ROWS_PER_COLUMN = 6;

export type SceneFlowJumpRef = {
    blockId: StoryBlockId;
    /** The jump sits under an if/loop, so it only fires on some runs. */
    conditional: boolean;
};

export type SceneFlowNodeModel = {
    sceneId: StorySceneId;
    name: string;
    /** Blocks written in the scene — a rough "how much is here" signal. */
    blockCount: number;
    isEntry: boolean;
    /** Reachable from the entry scene by following jumps. Always true when the story has no entry. */
    reachable: boolean;
    /** Jumps with an empty target or one pointing at a deleted scene — the compiler rejects these. */
    danglingJumpCount: number;
    /** Jumps back into the same scene. Shown as a badge: a self-loop edge renders as a smudge. */
    selfJumpCount: number;
};

export type SceneFlowEdgeModel = {
    id: string;
    source: StorySceneId;
    target: StorySceneId;
    /** Every jump block collapsed into this edge — two jumps A->B are one line, not two. */
    jumps: SceneFlowJumpRef[];
    /** Every jump on this edge is conditional, so the branch is not guaranteed. Drawn dashed. */
    conditional: boolean;
};

export type SceneFlowGraph = {
    nodes: SceneFlowNodeModel[];
    edges: SceneFlowEdgeModel[];
    /** Auto-layout result keyed by scene id. Manual drags override this per node. */
    positions: Record<StorySceneId, { x: number; y: number }>;
    danglingJumpCount: number;
    unreachableCount: number;
};

/**
 * Authoring order: chapters first (that is the order the author sees in the outline), then any
 * scene no chapter claims. Layout ties break on this, so the map stays stable across rebuilds.
 */
function orderSceneIds(document: StoryDocument): StorySceneId[] {
    const ordered: StorySceneId[] = [];
    const seen = new Set<StorySceneId>();
    for (const chapter of document.chapters) {
        for (const sceneId of chapter.sceneIds) {
            if (document.scenes[sceneId] && !seen.has(sceneId)) {
                seen.add(sceneId);
                ordered.push(sceneId);
            }
        }
    }
    for (const sceneId of Object.keys(document.scenes)) {
        if (!seen.has(sceneId)) {
            seen.add(sceneId);
            ordered.push(sceneId);
        }
    }
    return ordered;
}

/**
 * Whether a jump is nested under control flow (a condition or a loop), which makes it a branch
 * rather than an unconditional hand-off.
 */
function isUnderControlFlow(scene: StoryScene, block: StoryBlock): boolean {
    const seen = new Set<StoryBlockId>();
    let parentId = block.parentId;
    // A corrupted document must not hang the editor, hence the visited set.
    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = scene.blocks[parentId];
        if (!parent) {
            return false;
        }
        if (parent.kind === "control") {
            return true;
        }
        parentId = parent.parentId;
    }
    return false;
}

/**
 * Layer each scene by its shortest jump distance from a root, one connected component at a time.
 *
 * Breadth-first rather than longest-path: stories loop back (hub scenes, retry branches) and a
 * longest-path layering does not terminate on a cycle.
 */
function assignLayers(
    sceneIds: StorySceneId[],
    edges: SceneFlowEdgeModel[],
    entrySceneId: StorySceneId | undefined,
): Map<StorySceneId, number> {
    const outgoing = new Map<StorySceneId, StorySceneId[]>();
    const inDegree = new Map<StorySceneId, number>(sceneIds.map(id => [id, 0]));
    for (const edge of edges) {
        const list = outgoing.get(edge.source);
        if (list) {
            list.push(edge.target);
        } else {
            outgoing.set(edge.source, [edge.target]);
        }
        inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }

    // Entry scene first, then anything nothing jumps into, then whatever a cycle left stranded.
    const roots: StorySceneId[] = [];
    if (entrySceneId && inDegree.has(entrySceneId)) {
        roots.push(entrySceneId);
    }
    roots.push(...sceneIds.filter(id => id !== entrySceneId && (inDegree.get(id) ?? 0) === 0));
    roots.push(...sceneIds.filter(id => id !== entrySceneId && (inDegree.get(id) ?? 0) > 0));

    const layers = new Map<StorySceneId, number>();
    for (const root of roots) {
        if (layers.has(root)) {
            continue;
        }
        layers.set(root, 0);
        const queue: StorySceneId[] = [root];
        for (let cursor = 0; cursor < queue.length; cursor++) {
            const current = queue[cursor];
            const depth = layers.get(current) ?? 0;
            for (const next of outgoing.get(current) ?? []) {
                if (layers.has(next)) {
                    continue;
                }
                layers.set(next, depth + 1);
                queue.push(next);
            }
        }
    }
    return layers;
}

/** Scenes the player can actually arrive at, following jumps from the entry scene. */
function findReachable(
    edges: SceneFlowEdgeModel[],
    entrySceneId: StorySceneId | undefined,
): Set<StorySceneId> | null {
    if (!entrySceneId) {
        // No entry scene declared — "unreachable" is not a claim we can make.
        return null;
    }
    const outgoing = new Map<StorySceneId, StorySceneId[]>();
    for (const edge of edges) {
        const list = outgoing.get(edge.source);
        if (list) {
            list.push(edge.target);
        } else {
            outgoing.set(edge.source, [edge.target]);
        }
    }
    const reachable = new Set<StorySceneId>([entrySceneId]);
    const queue: StorySceneId[] = [entrySceneId];
    for (let cursor = 0; cursor < queue.length; cursor++) {
        for (const next of outgoing.get(queue[cursor]) ?? []) {
            if (!reachable.has(next)) {
                reachable.add(next);
                queue.push(next);
            }
        }
    }
    return reachable;
}

/** Column-per-layer, rows centred on the column so the trunk of the story reads as a spine. */
function layoutPositions(
    sceneIds: StorySceneId[],
    layers: Map<StorySceneId, number>,
): Record<StorySceneId, { x: number; y: number }> {
    const columns = new Map<number, StorySceneId[]>();
    for (const sceneId of sceneIds) {
        const layer = layers.get(sceneId) ?? 0;
        const column = columns.get(layer);
        if (column) {
            column.push(sceneId);
        } else {
            columns.set(layer, [sceneId]);
        }
    }

    const positions: Record<StorySceneId, { x: number; y: number }> = {};
    let x = 0;
    for (const layer of Array.from(columns.keys()).sort((a, b) => a - b)) {
        const members = columns.get(layer) ?? [];
        // Wrap a tall layer into side-by-side sub-columns, and push the next layer past all of them.
        const subColumns = Math.max(1, Math.ceil(members.length / MAX_ROWS_PER_COLUMN));
        const rows = Math.ceil(members.length / subColumns);
        members.forEach((sceneId, index) => {
            const subColumn = Math.floor(index / rows);
            const row = index % rows;
            const rowsHere = Math.min(rows, members.length - subColumn * rows);
            positions[sceneId] = {
                x: x + subColumn * (SCENE_FLOW_NODE_WIDTH + COLUMN_GAP),
                y: Math.round((row - (rowsHere - 1) / 2) * (SCENE_FLOW_NODE_HEIGHT + ROW_GAP)),
            };
        });
        x += subColumns * (SCENE_FLOW_NODE_WIDTH + COLUMN_GAP);
    }
    return positions;
}

/** Why a drawn connection cannot become a jump. `null` means it can. */
export type SceneFlowConnectionRejection = "unknownScene" | "selfJump" | "duplicate" | "sourceLocked";

/**
 * Gate a connection the author is drawing.
 *
 * Pass `ignoreEdgeId` when re-targeting an existing edge, so the edge being moved does not count
 * itself as the duplicate.
 */
export function validateSceneFlowConnection(
    graph: SceneFlowGraph,
    source: StorySceneId | null | undefined,
    target: StorySceneId | null | undefined,
    ignoreEdgeId?: string,
): SceneFlowConnectionRejection | null {
    if (!source || !target) {
        return "unknownScene";
    }
    const known = new Set(graph.nodes.map(node => node.sceneId));
    if (!known.has(source) || !known.has(target)) {
        return "unknownScene";
    }
    // A self-jump has no edge to draw — it lands as a badge — so drawing one would look like a no-op.
    if (source === target) {
        return "selfJump";
    }
    // The map already collapses repeats into one line, and a second identical unconditional jump is
    // dead code: the first one always wins.
    if (graph.edges.some(edge => edge.id !== ignoreEdgeId && edge.source === source && edge.target === target)) {
        return "duplicate";
    }
    return null;
}

export function buildSceneFlowGraph(document: StoryDocument): SceneFlowGraph {
    const sceneIds = orderSceneIds(document);
    const entrySceneId = document.entrySceneId && document.scenes[document.entrySceneId]
        ? document.entrySceneId
        : undefined;

    const edgeByKey = new Map<string, SceneFlowEdgeModel>();
    const danglingBySceneId = new Map<StorySceneId, number>();
    const selfJumpsBySceneId = new Map<StorySceneId, number>();

    for (const sceneId of sceneIds) {
        const scene = document.scenes[sceneId];
        // `blocks` is a flat record — control-flow nesting lives in id lists, not in the values —
        // so this reaches jumps buried inside conditions and loops without recursing.
        for (const block of Object.values(scene.blocks)) {
            if (block.kind !== "jump") {
                continue;
            }
            const target = block.payload.targetSceneId;
            if (!target || !document.scenes[target]) {
                danglingBySceneId.set(sceneId, (danglingBySceneId.get(sceneId) ?? 0) + 1);
                continue;
            }
            if (target === sceneId) {
                selfJumpsBySceneId.set(sceneId, (selfJumpsBySceneId.get(sceneId) ?? 0) + 1);
                continue;
            }
            const key = `${sceneId}->${target}`;
            const jump: SceneFlowJumpRef = { blockId: block.id, conditional: isUnderControlFlow(scene, block) };
            const existing = edgeByKey.get(key);
            if (existing) {
                existing.jumps.push(jump);
            } else {
                edgeByKey.set(key, {
                    id: `scene-flow:${key}`,
                    source: sceneId,
                    target,
                    jumps: [jump],
                    conditional: false,
                });
            }
        }
    }

    const edges = Array.from(edgeByKey.values()).map(edge => ({
        ...edge,
        conditional: edge.jumps.every(jump => jump.conditional),
    }));

    const layers = assignLayers(sceneIds, edges, entrySceneId);
    const reachable = findReachable(edges, entrySceneId);

    const nodes: SceneFlowNodeModel[] = sceneIds.map(sceneId => {
        const scene = document.scenes[sceneId];
        return {
            sceneId,
            name: scene.name,
            blockCount: Object.keys(scene.blocks).length,
            isEntry: sceneId === entrySceneId,
            reachable: reachable ? reachable.has(sceneId) : true,
            danglingJumpCount: danglingBySceneId.get(sceneId) ?? 0,
            selfJumpCount: selfJumpsBySceneId.get(sceneId) ?? 0,
        };
    });

    return {
        nodes,
        edges,
        positions: layoutPositions(sceneIds, layers),
        danglingJumpCount: nodes.reduce((total, node) => total + node.danglingJumpCount, 0),
        unreachableCount: nodes.filter(node => !node.reachable).length,
    };
}
