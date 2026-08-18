import type { StoryBlockId, StorySceneId } from "@shared/types/story";
import type {
  SceneFlowBranchLabel,
  SceneFlowEdgeModel,
  SceneFlowGraph,
  SceneFlowJumpRef
} from "./sceneFlowModel";

/**
 * One line the map draws, and exactly which jump blocks are behind it.
 *
 * Separate from {@link SceneFlowEdgeModel} because the graph's edges are not one-to-one with what is
 * on screen. A scene the author expanded hands its arm-owned jumps to the arms' own rows, and the
 * scene-pair line keeps only what is left — so "the A→B edge" and "the A→B line" are different sets
 * of jumps, and only one of them is what a click is aimed at.
 *
 * That distinction is the reason this type exists at all: the rendering and the delete gesture both
 * read it, so they cannot disagree. A delete that re-derived its jumps from `graph.edges` would take
 * the arm-owned ones too — lines the author can still see drawn beside the one they deleted.
 */
export type SceneFlowDrawnLine = {
  id: string;
  sourceSceneId: StorySceneId;
  targetSceneId: StorySceneId;
  /** The arm's node id, when the line leaves an arm's row rather than the scene's rim. */
  sourceBranchId?: string;
  jumps: SceneFlowJumpRef[];
  /** Drawn dashed: the jump only fires on some runs. */
  conditional: boolean;
  /** Drawn faded: every jump on this line is switched off, so the compiler emits none of them. */
  disabled: boolean;
  /** The forks that reach this target — what a collapsed line hides. Empty on an arm's own line. */
  branches: SceneFlowBranchLabel[];
};

/**
 * The scene edge minus the jumps an expanded scene's branch rows have taken over, or null when
 * nothing is left of it.
 *
 * Suppressing every scene edge of an expanded scene is nearly right and quietly wrong: a jump
 * written outside all of its forks belongs to no arm, has no branch row to leave from, and would
 * simply vanish from the map. So the edge is rebuilt from what the rows did *not* claim, label
 * included — the alternative is a line labelled with an option that is no longer on it.
 */
export function residualSceneEdge(
  edge: SceneFlowEdgeModel,
  claimed: ReadonlySet<StoryBlockId>
): SceneFlowEdgeModel | null {
  const jumps = edge.jumps.filter((jump) => !claimed.has(jump.blockId));
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
  return {
    ...edge,
    jumps,
    conditional: jumps.every((jump) => jump.conditional),
    disabled: jumps.every((jump) => jump.disabled),
    branches
  };
}

/**
 * Every line the map draws for this graph at this expansion, scene lines first.
 *
 * `expandedScenes` must be the set the canvas actually renders with (arms drawn), not the set the
 * author flagged: a scene with no arms grows no rows however it is flagged, and crediting its jumps
 * to rows that are not there would drop them from the map entirely.
 */
export function buildSceneFlowLines(
  graph: SceneFlowGraph,
  expandedScenes: ReadonlySet<StorySceneId>
): SceneFlowDrawnLine[] {
  // Jumps an expanded scene's arms have taken over, so the scene line does not draw them twice.
  const claimedJumps = new Set<StoryBlockId>();
  for (const edge of graph.branchEdges) {
    if (expandedScenes.has(edge.sourceSceneId)) {
      for (const jump of edge.jumps) {
        claimedJumps.add(jump.blockId);
      }
    }
  }

  const lines: SceneFlowDrawnLine[] = [];
  for (const edge of graph.edges) {
    const residual = expandedScenes.has(edge.source) ? residualSceneEdge(edge, claimedJumps) : edge;
    if (!residual) {
      continue;
    }
    lines.push({
      id: edge.id,
      sourceSceneId: edge.source,
      targetSceneId: edge.target,
      jumps: residual.jumps,
      conditional: residual.conditional,
      disabled: residual.disabled,
      branches: residual.branches
    });
  }
  for (const edge of graph.branchEdges) {
    if (!expandedScenes.has(edge.sourceSceneId)) {
      continue;
    }
    lines.push({
      id: edge.id,
      sourceSceneId: edge.sourceSceneId,
      targetSceneId: edge.target,
      sourceBranchId: edge.sourceBranchId,
      jumps: edge.jumps,
      // A line leaving an arm only fires when that arm is taken.
      conditional: true,
      disabled: edge.jumps.every((jump) => jump.disabled),
      branches: []
    });
  }
  return lines;
}
