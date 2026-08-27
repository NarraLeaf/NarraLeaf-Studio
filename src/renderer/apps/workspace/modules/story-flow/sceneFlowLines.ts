import type { StoryBlockId, StorySceneId } from "@shared/types/story";
import type {
    SceneFlowBranchLabel,
    SceneFlowEdgeModel,
    SceneFlowGraph,
    SceneFlowJumpRef,
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
    /**
     * Drawn in the call colour, with an arrow at both ends: every jump on this line comes back, so
     * the run goes to the target and returns to carry on where it left. See {@link sceneFlowLinePaint}.
     */
    returns: boolean;
    /** The forks that reach this target — what a collapsed line hides. Empty on an arm's own line. */
    branches: SceneFlowBranchLabel[];
};

/** The ink of an ordinary line — a way out of the scene, and the map's overwhelming majority. */
export const SCENE_FLOW_LINE_STROKE = "rgb(var(--nl-fg-muted))";

/**
 * The ink of a line the run comes back along.
 *
 * A call is marked twice over — this colour *and* an arrowhead at each end — because the arrowheads
 * on their own cannot say which line they belong to. Every line a collapsed scene sends out leaves
 * the same point on its rim, so a scene that both jumps and calls draws two lines whose first
 * segments lie exactly on top of one another, and the return arrowhead is painted on that shared
 * stub. The reader can see that something comes back to the scene and cannot tell which of the two
 * targets it is.
 *
 * The cue that settles it therefore has to be a property of the WHOLE line rather than a mark at one
 * point on it, because the only place two lines out of one scene are distinguishable is where they
 * have already parted. Of the properties a stroke has, three are spoken for here: the dash pattern
 * is a conditional jump, the opacity is a switched-off row (and the emphasis mask), and width plus
 * the accent together are the selected line (`.narraleaf-scene-flow .react-flow__edge.selected` in
 * styles.css). Colour is what is left — and unlike a glyph or a label it still reads when the graph
 * is zoomed out far enough that a 14px arrowhead is four pixels of grey.
 *
 * `binding` rather than another accent because it is the palette's one chromatic token that passes
 * no verdict: `danger`, `warning` and `success` would each say a call is something being wrong or
 * right rather than a kind of row, and `primary` is already what a selected line turns on this very
 * surface. It borrows the token from the blueprint editor's bound-value tint, which the map never
 * draws beside.
 */
export const SCENE_FLOW_CALL_STROKE = "rgb(var(--nl-binding))";

/** A line whose jump only fires on some runs: it sits under a condition or a menu option. */
export const SCENE_FLOW_CONDITIONAL_DASH = "5 4";

/** How one line is painted, apart from the opacity — see {@link sceneFlowLinePaint}. */
export type SceneFlowLinePaint = {
    /** The stroke, and both arrowheads with it, so one line reads as one object. */
    stroke: string;
    /** SVG dash array, or undefined for a solid line. */
    strokeDasharray: string | undefined;
    /** An arrowhead at the source end as well as at the target end. */
    doubleHeaded: boolean;
};

/**
 * Everything about a line's stroke that follows from what the line *is*.
 *
 * Separate from the canvas so the map's three visual codes can be asserted without rendering
 * anything, and so they are decided in one place: they compose — a switched-off conditional call is
 * all three at once — and a reader has to be able to take them apart again.
 *
 * Opacity is deliberately not here. It is the one part of a line's appearance that does not follow
 * from the line: it also carries the emphasis mask, which is about what the surface is pointing at
 * rather than about the jumps.
 */
export function sceneFlowLinePaint(
    line: Pick<SceneFlowDrawnLine, "conditional" | "returns">,
): SceneFlowLinePaint {
    return {
        stroke: line.returns ? SCENE_FLOW_CALL_STROKE : SCENE_FLOW_LINE_STROKE,
        strokeDasharray: line.conditional ? SCENE_FLOW_CONDITIONAL_DASH : undefined,
        doubleHeaded: line.returns,
    };
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
export function residualSceneEdge(
    edge: SceneFlowEdgeModel,
    claimed: ReadonlySet<StoryBlockId>,
): SceneFlowEdgeModel | null {
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
    return {
        ...edge,
        jumps,
        conditional: jumps.every(jump => jump.conditional),
        disabled: jumps.every(jump => jump.disabled),
        returns: jumps.every(jump => jump.returnable),
        branches,
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
    expandedScenes: ReadonlySet<StorySceneId>,
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
            returns: residual.returns,
            branches: residual.branches,
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
            disabled: edge.jumps.every(jump => jump.disabled),
            returns: edge.jumps.every(jump => jump.returnable),
            branches: [],
        });
    }
    return lines;
}
