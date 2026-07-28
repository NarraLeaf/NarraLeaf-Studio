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
import { listSceneBlocksInDocumentOrder, listSceneIdsInDocumentOrder } from "@shared/types/story";
import { formatStoryConditionSummary } from "../story/projection/storySceneProjection";

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

/**
 * What kind of fork put a jump on one path rather than another.
 *
 * `conditionElse` carries no text of its own — the branch is defined by the ones it is not — so the
 * renderer supplies the existing "otherwise" wording rather than the model inventing a second one.
 * `conditionElseIf` carries a condition like an `if` does, but reaching it also means every earlier
 * arm failed; without its own kind the two render as the same bare condition text and the map claims
 * a path is taken whenever the condition holds, which is not what an `else if` means.
 */
export type SceneFlowBranchKind = "choice" | "condition" | "conditionElseIf" | "conditionElse";

/** The nearest branching ancestor of a jump, as the edge label renders it. */
export type SceneFlowBranchLabel = {
    kind: SceneFlowBranchKind;
    /**
     * Option text, or the condition summary (both `condition` and `conditionElseIf` carry one).
     * Empty for `conditionElse` and for an unnamed option.
     */
    label: string;
};

export type SceneFlowJumpRef = {
    blockId: StoryBlockId;
    /** The jump sits under a choice option or a condition branch, so it only fires on some runs. */
    conditional: boolean;
    /** The fork it hangs off, when there is one. Absent exactly when `conditional` is false. */
    branch?: SceneFlowBranchLabel;
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
    /**
     * The distinct forks that reach this target, in document order — what the collapsed line hides.
     * Deduplicated, so two options worded the same read as one path (they are, to a reader of the
     * map). Empty when nothing on the edge is branched.
     */
    branches: SceneFlowBranchLabel[];
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
 * The nearest fork above a jump — the thing that decides whether this jump is the one that runs.
 *
 * Only two ancestors fork: a choice option (the player picks) and a condition branch (the state
 * decides). `sequence` / `parallel` / `race` / `repeat` are *ordering*, not choosing: every jump
 * inside them runs, so a jump under a `sequence` is as certain as one at the top of the scene. The
 * previous rule stopped at any `control` ancestor and so drew half the maps dashed for no reason.
 *
 * Nearest wins: an option nested inside an `if` is reached by picking that option, and the option is
 * what a reader of the map needs to see.
 */
function resolveJumpBranch(scene: StoryScene, block: StoryBlock, document: StoryDocument): SceneFlowBranchLabel | null {
    const seen = new Set<StoryBlockId>();
    let parentId = block.parentId;
    // A corrupted document must not hang the editor, hence the visited set.
    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = scene.blocks[parentId];
        if (!parent) {
            return null;
        }
        if (parent.kind === "nodeAction" && parent.payload.action === "choiceOption") {
            return { kind: "choice", label: parent.payload.text.value.trim() };
        }
        if (parent.kind === "control" && parent.payload.control === "conditionBranch") {
            if (parent.payload.branch === "else") {
                return { kind: "conditionElse", label: "" };
            }
            return {
                kind: parent.payload.branch === "elseIf" ? "conditionElseIf" : "condition",
                label: formatStoryConditionSummary(parent.payload.condition, scene, document),
            };
        }
        parentId = parent.parentId;
    }
    return null;
}

/** Same fork, worded the same way — the dedupe key for an edge's branch list. */
function branchKey(branch: SceneFlowBranchLabel): string {
    return `${branch.kind}:${branch.label}`;
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

export function buildSceneFlowGraph(document: StoryDocument): SceneFlowGraph {
    // Authoring order: chapters first (that is the order the author sees in the outline), then any
    // scene no chapter claims. Layout ties break on this, so the map stays stable across rebuilds.
    const sceneIds = listSceneIdsInDocumentOrder(document);
    const entrySceneId = document.entrySceneId && document.scenes[document.entrySceneId]
        ? document.entrySceneId
        : undefined;

    const edgeByKey = new Map<string, SceneFlowEdgeModel>();
    const danglingBySceneId = new Map<StorySceneId, number>();
    const selfJumpsBySceneId = new Map<StorySceneId, number>();

    for (const sceneId of sceneIds) {
        const scene = document.scenes[sceneId];
        // Depth-first, so the forks this collapses into one edge are listed in the order the author
        // wrote them — which is what `SceneFlowEdgeModel.branches` promises the reader of the map.
        for (const block of listSceneBlocksInDocumentOrder(scene)) {
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
            const branch = resolveJumpBranch(scene, block, document);
            const jump: SceneFlowJumpRef = {
                blockId: block.id,
                conditional: branch !== null,
                ...(branch ? { branch } : {}),
            };
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
                    branches: [],
                });
            }
        }
    }

    const edges = Array.from(edgeByKey.values()).map(edge => {
        const seenBranches = new Set<string>();
        const branches: SceneFlowBranchLabel[] = [];
        for (const jump of edge.jumps) {
            if (!jump.branch) {
                continue;
            }
            const key = branchKey(jump.branch);
            if (!seenBranches.has(key)) {
                seenBranches.add(key);
                branches.push(jump.branch);
            }
        }
        return {
            ...edge,
            conditional: edge.jumps.every(jump => jump.conditional),
            branches,
        };
    });

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
