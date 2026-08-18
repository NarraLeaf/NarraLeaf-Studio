/**
 * Pure derivation: scene graph -> endings and routes (路线图).
 *
 * Free of React and of the story document's block layer — everything here is read off
 * {@link SceneFlowGraph}, which has already decided which arm owns which jump. Keeping the two
 * apart is what stops the route map from re-deriving branch ownership a second, drifting way; if
 * the map and the rail disagree about which option leaves a scene, the rail is lying about a path
 * the author can see drawn.
 *
 * Two limits are structural rather than oversights, and the rail should not pretend otherwise:
 *
 * - **An `if` with no `else` has no arm standing for "the condition was false".** The graph models
 *   arms the author wrote, and nobody wrote that one, so no route takes it. Synthesising it would
 *   mean inventing an edge id that highlights nothing on the canvas.
 * - **Two root-level choices in one scene are read as independent forks.** A fall-through arm of the
 *   first continues to the scene's unguarded exits without being made to answer the second, so such
 *   a route under-states its decisions. Modelling it properly means walking scene-internal control
 *   flow, which is a different machine from the one the graph hands over.
 */

import type {
  StoryBlock,
  StoryBlockId,
  StoryDocument,
  StoryScene,
  StorySceneId
} from "@shared/types/story";
import { listSceneBlocksInDocumentOrder } from "@shared/types/story";
import type { SceneFlowBranchEdgeModel, SceneFlowGraph } from "./sceneFlowModel";

/**
 * How many routes are enumerated before the walk gives up.
 *
 * A branching story is combinatorial: eight two-way forks in a row is 256 paths, and the number a
 * real script reaches is not bounded by anything an author would recognise as a limit. The cap
 * exists so the rail renders; {@link SceneFlowRouteMap.truncated} exists so it never presents the
 * cap as the total.
 */
export const MAX_ROUTES = 200;

/** A scene the story can stop in. Derived from the graph — no schema field, no migration. */
export type SceneFlowEnding = {
  sceneId: StorySceneId;
  name: string;
  /**
   * Reachable from the entry scene. An unreachable terminal is a defect worth surfacing, not an
   * ending the player can get.
   *
   * With no `entrySceneId` declared this is `true` for every scene — the same non-claim
   * `SceneFlowNodeModel.reachable` makes, carried through rather than re-invented here. "No entry"
   * is not evidence that a scene is stranded, and flagging every ending red because the author has
   * not picked a starting scene yet would be a diagnostic about the wrong thing.
   */
  reachable: boolean;
};

export type SceneFlowRouteStep = {
  /** The scene being left. */
  sceneId: StorySceneId;
  /** The arm taken to leave this scene, or null when the exit is guarded by no fork. */
  branchId: string | null;
  /** The branch edge / scene edge traversed, for highlighting. */
  edgeId: string;
};

export type SceneFlowRoute = {
  /** Stable across rebuilds: the entry scene plus every (arm, edge) the path took, in order. */
  id: string;
  /**
   * Where the path stopped.
   *
   * Usually one of {@link SceneFlowRouteMap.endings}, but not always: a path that ran off the end
   * of a fall-through arm, or one cut at a cycle, stops in a scene that still has other exits and
   * so is not a terminal scene. Group by this id and take the name from the scene, never from a
   * lookup into `endings` that is assumed to hit.
   */
  endingSceneId: StorySceneId;
  steps: SceneFlowRouteStep[];
  /** Scene ids on this route including entry and ending, in order. Each appears at most once. */
  sceneIds: StorySceneId[];
  /**
   * Branch node ids taken, in order — the walkthrough.
   *
   * Longer than the arms in `steps` by one when the path ended *on* an arm: a fall-through option
   * with nowhere to continue, or the arm that looped back. That arm was taken and has no edge to
   * hang a step off, and leaving it out would report a live option as a dead one.
   */
  branchIds: string[];
  /** The path hit a scene it had already visited and was cut there, rather than looping forever. */
  truncatedByCycle: boolean;
};

export type SceneFlowRouteMap = {
  endings: SceneFlowEnding[];
  routes: SceneFlowRoute[];
  /**
   * More routes exist than were enumerated — the walk stopped at {@link MAX_ROUTES}. The rail must
   * SAY so ("200+ routes"); a map that silently shows 200 of 4000 reads as "these are all of them".
   */
  truncated: boolean;
  /**
   * Endings no enumerated route reaches.
   *
   * When `truncated` is set this is a claim about *what was enumerated*, not about the story: an
   * ending only the 4000th route reaches lands here. Render it accordingly. Empty when the story
   * declares no entry scene — with no "from", nothing can be called unreached.
   */
  unreachableEndings: StorySceneId[];
  /**
   * Branch arms that lie on no enumerated route — dead options.
   *
   * Same caveat as `unreachableEndings`: under truncation this over-reports, and an arm whose only
   * jump is dangling is listed here because a broken exit is not a path the walk can follow. Empty
   * when the story declares no entry scene.
   */
  deadBranchIds: string[];
};

/**
 * One way out of a scene.
 *
 * `stop` is the fall-through arm with nothing to fall through *into*: the option runs, the scene has
 * no unconditional exit left, and the story ends there. It is not the same as having no arm — "this
 * option just continues, and continuing is the end" is a path the author needs listed.
 */
type SceneFlowContinuation =
  | { kind: "edge"; branchId: string | null; edgeId: string; target: StorySceneId }
  | { kind: "stop"; branchId: string };

/** A scene exit no fork guards, as the scene-pair edge draws it. */
type SceneFlowPlainExit = { edgeId: string; target: StorySceneId };

/** Whether `block` sits anywhere under `ancestorId`, guarded against a corrupted parent cycle. */
function isDescendantOf(scene: StoryScene, block: StoryBlock, ancestorId: StoryBlockId): boolean {
  const seen = new Set<StoryBlockId>();
  let parentId = block.parentId;
  while (parentId && !seen.has(parentId)) {
    if (parentId === ancestorId) {
      return true;
    }
    seen.add(parentId);
    parentId = scene.blocks[parentId]?.parentId ?? null;
  }
  return false;
}

/**
 * Jumps that only a fall-through arm can reach: the ones written after a root-level `choice`.
 *
 * A choice fork is **exhaustive** — the engine's menu makes the player pick exactly one arm, and
 * nothing gets past it without going through one. So a jump the author wrote after the menu is
 * reached only by picking an option that does not jump; offering it as a continuation of its own
 * invents a route on which the player made no choice at all, which is the one thing the scene
 * guarantees cannot happen. A jump written *before* the menu is not gated: it leaves before the
 * menu is ever shown.
 *
 * **Only `choice`, never a condition group.** An `if` with no `else` is skipped whole when the
 * condition is false and control walks straight into what follows, so a condition fork guarantees
 * nothing about what comes after it. Extending this to `forkKind: "condition"` would delete that
 * path — the most ordinary shape in a branching script — and the deletion would be silent.
 *
 * **Only root-level forks.** A choice nested inside an `if` arm gates the rest of *that arm*, not
 * the rest of the scene: the scene continues past the `if` whether or not the arm ever ran.
 */
function findGatedJumpIds(scene: StoryScene): Set<StoryBlockId> {
  const blocks = listSceneBlocksInDocumentOrder(scene);
  const position = new Map<StoryBlockId, number>(blocks.map((block, index) => [block.id, index]));

  const gates: { id: StoryBlockId; at: number }[] = [];
  for (const blockId of scene.rootBlockIds) {
    const block = scene.blocks[blockId];
    if (!block || block.kind !== "nodeAction" || block.payload.action !== "choice") {
      continue;
    }
    // A `choice` with no options is not a fork — the same gate `buildSceneFlowGraph` applies
    // before it will emit arms for one, so the two readings cannot disagree about what a fork is.
    const hasOption = block.childrenIds.some((childId) => {
      const child = scene.blocks[childId];
      return Boolean(
        child && child.kind === "nodeAction" && child.payload.action === "choiceOption"
      );
    });
    if (hasOption) {
      gates.push({ id: blockId, at: position.get(blockId) ?? 0 });
    }
  }
  if (gates.length === 0) {
    return new Set();
  }

  const gated = new Set<StoryBlockId>();
  for (const block of blocks) {
    if (block.kind !== "jump") {
      continue;
    }
    const at = position.get(block.id) ?? 0;
    // A jump inside the menu's own subtree is not gated by it: it is what an option does, and
    // the arm that owns it already accounts for it.
    if (gates.some((gate) => gate.at < at && !isDescendantOf(scene, block, gate.id))) {
      gated.add(block.id);
    }
  }
  return gated;
}

/**
 * Every way out of every scene, in a fixed order so the enumeration — and therefore which routes
 * survive the cap — is the same on every rebuild.
 *
 * Arms come first, in the graph's fork-then-arm order, and unguarded exits after them.
 */
function collectContinuations(
  graph: SceneFlowGraph,
  document: StoryDocument
): Map<StorySceneId, SceneFlowContinuation[]> {
  // A jump belongs to at most one arm. What is left over is an exit no fork guards: a plain
  // top-level jump, or one under an arm the fork walk could not register (an option with no
  // `choice` container above it, which the compiler diagnoses). Reading ownership off the branch
  // edges rather than off `jump.conditional` is what keeps the second kind on the map — it is
  // labelled conditional but owns no row, and dropping it would delete a path because the
  // document is malformed rather than because the path does not exist.
  const ownedJumpIds = new Set<StoryBlockId>();
  for (const edge of graph.branchEdges) {
    for (const jump of edge.jumps) {
      ownedJumpIds.add(jump.blockId);
    }
  }

  // Two readings of the same exits, because a menu changes who can reach them but not whether they
  // exist: `plain` is everything a fall-through arm continues into, `standalone` is the subset a
  // path can take without answering a menu first. Keeping the first unfiltered is what preserves
  // "this option just continues" as a route.
  const plainExitsBySceneId = new Map<StorySceneId, SceneFlowPlainExit[]>();
  const standaloneExitsBySceneId = new Map<StorySceneId, SceneFlowPlainExit[]>();
  const gatedJumpIdsBySceneId = new Map<StorySceneId, Set<StoryBlockId>>();
  const gatedJumpIds = (sceneId: StorySceneId): Set<StoryBlockId> => {
    const cached = gatedJumpIdsBySceneId.get(sceneId);
    if (cached) {
      return cached;
    }
    const scene = document.scenes[sceneId];
    const gated = scene ? findGatedJumpIds(scene) : new Set<StoryBlockId>();
    gatedJumpIdsBySceneId.set(sceneId, gated);
    return gated;
  };
  const pushExit = (
    into: Map<StorySceneId, SceneFlowPlainExit[]>,
    sceneId: StorySceneId,
    exit: SceneFlowPlainExit
  ): void => {
    const exits = into.get(sceneId);
    if (exits) {
      exits.push(exit);
    } else {
      into.set(sceneId, [exit]);
    }
  };
  for (const edge of graph.edges) {
    const unowned = edge.jumps.filter((jump) => !ownedJumpIds.has(jump.blockId));
    if (unowned.length === 0) {
      continue;
    }
    const exit = { edgeId: edge.id, target: edge.target };
    pushExit(plainExitsBySceneId, edge.source, exit);
    const gated = gatedJumpIds(edge.source);
    if (unowned.some((jump) => !gated.has(jump.blockId))) {
      pushExit(standaloneExitsBySceneId, edge.source, exit);
    }
  }

  const branchEdgesByBranchId = new Map<string, SceneFlowBranchEdgeModel[]>();
  for (const edge of graph.branchEdges) {
    const owned = branchEdgesByBranchId.get(edge.sourceBranchId);
    if (owned) {
      owned.push(edge);
    } else {
      branchEdgesByBranchId.set(edge.sourceBranchId, [edge]);
    }
  }

  const continuations = new Map<StorySceneId, SceneFlowContinuation[]>();
  const listFor = (sceneId: StorySceneId): SceneFlowContinuation[] => {
    const existing = continuations.get(sceneId);
    if (existing) {
      return existing;
    }
    const created: SceneFlowContinuation[] = [];
    continuations.set(sceneId, created);
    return created;
  };

  for (const branch of graph.branches) {
    const list = listFor(branch.sceneId);
    if (branch.fallsThrough) {
      // The arm owns no exit, so control returns to the scene and continues past the fork —
      // which, as far as the graph knows, means the scene's unguarded exits.
      const onward = plainExitsBySceneId.get(branch.sceneId) ?? [];
      if (onward.length === 0) {
        list.push({ kind: "stop", branchId: branch.id });
        continue;
      }
      for (const exit of onward) {
        list.push({ kind: "edge", branchId: branch.id, edgeId: exit.edgeId, target: exit.target });
      }
      continue;
    }
    // An arm with targets, or one whose only jump is dangling: the latter contributes nothing,
    // because a broken jump is a compile error, not an ending, and a route that stops on it
    // would present the defect as a place the story can finish.
    for (const edge of branchEdgesByBranchId.get(branch.id) ?? []) {
      list.push({ kind: "edge", branchId: branch.id, edgeId: edge.id, target: edge.target });
    }
  }

  for (const [sceneId, exits] of standaloneExitsBySceneId) {
    const list = listFor(sceneId);
    for (const exit of exits) {
      list.push({ kind: "edge", branchId: null, edgeId: exit.edgeId, target: exit.target });
    }
  }

  return continuations;
}

/**
 * Endings and every decision path that reaches one.
 *
 * `document` supplies the entry scene — the only thing the walk needs that the graph does not carry
 * unambiguously — and is guarded exactly as `buildSceneFlowGraph` guards it, so a story pointing at
 * a deleted scene is treated as having no entry rather than as having a broken one.
 */
export function buildSceneFlowRouteMap(
  graph: SceneFlowGraph,
  document: StoryDocument
): SceneFlowRouteMap {
  // A scene with no outgoing edge is a scene the story cannot leave. Self and dangling jumps
  // produce no edge in the graph, so "only dangling/self ones" is already covered here rather than
  // needing a second reading of the jump counts.
  const scenesWithExit = new Set<StorySceneId>(graph.edges.map((edge) => edge.source));
  const endings: SceneFlowEnding[] = graph.nodes
    .filter((node) => !scenesWithExit.has(node.sceneId))
    .map((node) => ({ sceneId: node.sceneId, name: node.name, reachable: node.reachable }));

  const entrySceneId =
    document.entrySceneId && document.scenes[document.entrySceneId]
      ? document.entrySceneId
      : undefined;
  if (!entrySceneId) {
    // No "from" to enumerate from. The endings are still a fact about the graph, but every
    // route-derived diagnostic would be an artefact of the missing entry rather than of the
    // story, so none of them is claimed.
    return { endings, routes: [], truncated: false, unreachableEndings: [], deadBranchIds: [] };
  }

  const continuations = collectContinuations(graph, document);
  const routes: SceneFlowRoute[] = [];
  let truncated = false;

  const steps: SceneFlowRouteStep[] = [];
  const sceneIds: StorySceneId[] = [entrySceneId];
  const branchIds: string[] = [];
  const visited = new Set<StorySceneId>([entrySceneId]);

  /**
   * Freeze the path as it stands into a route.
   *
   * `tail` is the token that tells two routes with the same steps apart — the arm that stopped,
   * or the edge that looped back. Without it, "picked option A and the scene ended" and "picked
   * option B and the scene ended" collapse into one id, and the rail keys two list rows the same.
   */
  const emit = (
    tail: string | null,
    tailBranchId: string | null,
    truncatedByCycle: boolean
  ): void => {
    const parts = [entrySceneId, ...steps.map((step) => `${step.branchId ?? "-"}@${step.edgeId}`)];
    if (tail) {
      parts.push(tail);
    }
    routes.push({
      // Joined rather than hashed: 200 ids is nowhere near enough to justify a collision
      // risk, and a selection landing on the wrong path is worse than a long string.
      id: `scene-flow:route:${parts.join("/")}`,
      endingSceneId: sceneIds[sceneIds.length - 1],
      steps: steps.map((step) => ({ ...step })),
      sceneIds: [...sceneIds],
      branchIds: tailBranchId ? [...branchIds, tailBranchId] : [...branchIds],
      truncatedByCycle
    });
  };

  const walk = (sceneId: StorySceneId): void => {
    const exits = continuations.get(sceneId) ?? [];
    if (exits.length === 0) {
      emit(null, null, false);
      return;
    }
    for (const exit of exits) {
      if (routes.length >= MAX_ROUTES) {
        // Reached here with work still queued, so there really are more routes than the cap.
        // Checking at the point of skipping, rather than by comparing counts afterwards,
        // is what keeps a story with exactly MAX_ROUTES routes from claiming to be truncated.
        truncated = true;
        return;
      }
      if (exit.kind === "stop") {
        emit(`~stop:${exit.branchId}`, exit.branchId, false);
        continue;
      }
      if (visited.has(exit.target)) {
        // Cut here rather than following the loop: the route is the part of the path that is
        // a path, and the flag says it did not stop because the story ended. The closing hop
        // is deliberately not a step — `sceneIds` promises no repeats.
        emit(`~cut:${exit.branchId ?? "-"}@${exit.edgeId}`, exit.branchId, true);
        continue;
      }
      steps.push({ sceneId, branchId: exit.branchId, edgeId: exit.edgeId });
      sceneIds.push(exit.target);
      visited.add(exit.target);
      if (exit.branchId) {
        branchIds.push(exit.branchId);
      }
      walk(exit.target);
      if (exit.branchId) {
        branchIds.pop();
      }
      visited.delete(exit.target);
      sceneIds.pop();
      steps.pop();
    }
  };

  walk(entrySceneId);

  const visitedScenes = new Set<StorySceneId>();
  const usedBranchIds = new Set<string>();
  for (const route of routes) {
    for (const sceneId of route.sceneIds) {
      visitedScenes.add(sceneId);
    }
    for (const branchId of route.branchIds) {
      usedBranchIds.add(branchId);
    }
  }

  return {
    endings,
    routes,
    truncated,
    unreachableEndings: endings
      .filter((ending) => !visitedScenes.has(ending.sceneId))
      .map((ending) => ending.sceneId),
    deadBranchIds: graph.branches
      .filter((branch) => !usedBranchIds.has(branch.id))
      .map((branch) => branch.id)
  };
}
