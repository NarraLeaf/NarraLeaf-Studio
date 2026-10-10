/**
 * Pure derivation: scene graph -> endings and routes (路线图).
 *
 * Free of React, and free of any second opinion about branch ownership — which arm owns which jump
 * is read off {@link SceneFlowGraph}, which has already decided it. Keeping the two apart is what
 * stops the route map from re-deriving that a second, drifting way; if the map and the rail disagree
 * about which option leaves a scene, the rail is lying about a path the author can see drawn.
 *
 * **An ending is an `/ending` row.** The author says where the story stops, so every ending here is
 * one of those rows (`listStoryEndings`) and is keyed by the row's block id — which is what lets one
 * scene hold several of them, one behind each arm of a fork, and lets a route name the one it
 * reached rather than only the scene it came out in.
 *
 * A story that marks no endings at all keeps the derivation this map was built on: a scene the story
 * cannot leave is read as an ending and keyed by its scene id. All-or-nothing on purpose. Mixing the
 * two would put a scene that merely forgot its `/ending` in the same list as the ones that have it,
 * which is the exact distinction a project adopting endings is drawing — and it leaves the rail of a
 * project that has never written one exactly as it was.
 *
 * Three limits are structural rather than oversights, and the rail should not pretend otherwise:
 *
 * - **An `if` with no `else` has no arm standing for "the condition was false".** The graph models
 *   arms the author wrote, and nobody wrote that one, so no route takes it. Synthesising it would
 *   mean inventing an edge id that highlights nothing on the canvas.
 * - **Two root-level choices in one scene are read as independent forks.** A fall-through arm of the
 *   first continues to the scene's unguarded exits without being made to answer the second, so such
 *   a route under-states its decisions. Only when the scene has no unguarded exit at all does the
 *   arm follow the rows after it into the next menu (`readArmFollowOn`): that is the case where not
 *   walking would turn a route that carries on into one that stops.
 * - **Rows are not put in order against each other inside a scene.** A jump written after an
 *   `/ending` never runs, and an ending written after an unconditional jump never runs either, but
 *   both are listed — the same way two unconditional jumps in one scene are both listed today.
 *   `story/rows-after-ending` is the report that names the dead row; deciding it here would need
 *   that same scene-internal walk.
 */

import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";
import { isStoryEndingBlock, listSceneBlocksInDocumentOrder, listStoryEndings } from "@shared/types/story";
import type { SceneFlowBranchEdgeModel, SceneFlowBranchNodeModel, SceneFlowGraph } from "./sceneFlowModel";

/**
 * How many routes are enumerated before the walk gives up.
 *
 * A branching story is combinatorial: eight two-way forks in a row is 256 paths, and the number a
 * real script reaches is not bounded by anything an author would recognise as a limit. The cap
 * exists so the rail renders; {@link SceneFlowRouteMap.truncated} exists so it never presents the
 * cap as the total.
 */
export const MAX_ROUTES = 200;

/** Where an ending in this map came from. See the header for why the two never mix. */
export type SceneFlowEndingSource =
    /** An `/ending` row the author wrote. */
    | "authored"
    /** A scene the story cannot leave, in a story that marks no endings at all. */
    | "derived";

/** Somewhere the story stops. */
export type SceneFlowEnding = {
    /**
     * The ending's identity: the `/ending` row's block id, or the scene id when derived.
     *
     * The row's id is the same identity `listStoryEndings` hands every other consumer, so a rail
     * selection, an unlock record and a walkthrough test all name the same thing.
     */
    id: string;
    /** Which of the two {@link id} is, so nothing has to guess what it addresses. */
    source: SceneFlowEndingSource;
    /** The scene the ending is in. Several endings can share one. */
    sceneId: StorySceneId;
    /** The ending's name, or the scene's when derived. Empty when the row is unnamed. */
    name: string;
    /**
     * Reachable from the entry scene. An unreachable terminal is a defect worth surfacing, not an
     * ending the player can get.
     *
     * An authored ending inherits its scene's answer: an ending is a row in a scene, so a scene
     * nothing reaches holds nothing a player can reach either.
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
     * The scene the path stopped in.
     *
     * Not necessarily an ending's scene: a path that ran off the end of a fall-through arm, or one
     * cut at a cycle, stops in a scene that still has other exits. Take the name from the scene,
     * never from a lookup into `endings` that is assumed to hit.
     */
    endingSceneId: StorySceneId;
    /**
     * The ending this path reached — a {@link SceneFlowEnding.id} — or null when it stopped without
     * reaching one.
     *
     * Null is the half worth reading: a fall-through arm that ran out, a path cut at a cycle, or a
     * scene with no way out in a story that marks its endings elsewhere. All of those stop, and none
     * of them is an ending, which is the distinction `/ending` exists to draw.
     */
    endingId: string | null;
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
     * Endings no enumerated route reaches, as {@link SceneFlowEnding.id}s.
     *
     * When `truncated` is set this is a claim about *what was enumerated*, not about the story: an
     * ending only the 4000th route reaches lands here. Render it accordingly. Empty when the story
     * declares no entry scene — with no "from", nothing can be called unreached.
     */
    unreachableEndings: string[];
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
 * One way out of a scene, or one way it stops.
 *
 * `stop` is the fall-through arm with nothing to fall through *into*: the option runs, the scene has
 * no unconditional exit left, and the run has nowhere to go. It is not the same as having no arm —
 * "this option just continues, and continuing is the end" is a path the author needs listed.
 *
 * `ending` is an `/ending` row. Kept apart from `stop` because the two are opposite verdicts on the
 * same shape: one is where the author said the story ends, the other is where it merely ran out. A
 * consumer that folded them together could not tell a finished route from an unfinished one, which
 * is the whole question the ending row was added to answer.
 */
export type SceneFlowContinuation =
    | { kind: "edge"; branchId: string | null; edgeId: string; target: StorySceneId }
    /**
     * A returnable jump: the run goes to `target` and comes back to carry on here.
     *
     * Kept apart from `edge` because it answers a different question. `target` is entered, so it is
     * reachable and the endings in it can be reached - but the scene this leaves is not left, so a
     * path that has only these has not gone anywhere. A consumer that folded the two together would
     * report a scene whose last row is a call as having somewhere to go.
     */
    | { kind: "call"; branchId: string | null; edgeId: string; target: StorySceneId }
    | { kind: "stop"; branchId: string }
    | { kind: "ending"; branchId: string | null; endingId: StoryBlockId }
    /**
     * A `/quit` row: the run ends here and the player gets a page.
     *
     * Terminal like an ending, and kept apart from it for the reason the row itself exists - this
     * is not a place the story finished, it is a place one playthrough did. Folding it into
     * `ending` would put a hub the player passes through twenty times into the endings list and
     * the coverage report; folding it into `stop` would report every hub as a path that ran out,
     * which is the opposite of what the author wrote.
     */
    | { kind: "quit"; branchId: string | null; blockId: StoryBlockId };

/** A scene exit no fork guards, as the scene-pair edge draws it. */
type SceneFlowPlainExit = { edgeId: string; target: StorySceneId };

/** The same, for a returnable jump: entered, and returned from. */
type SceneFlowPlainCall = SceneFlowPlainExit;

/** Append to a list held in a map, creating the list on first use. */
function pushInto<K, V>(into: Map<K, V[]>, key: K, value: V): void {
    const list = into.get(key);
    if (list) {
        list.push(value);
    } else {
        into.set(key, [value]);
    }
}

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
 * Rows that only a fall-through arm can reach: the ones written after a root-level `choice`.
 *
 * A choice fork is **exhaustive** — the engine's menu makes the player pick exactly one arm, and
 * nothing gets past it without going through one. So a row the author wrote after the menu is
 * reached only by picking an option that does not leave; offering it as a continuation of its own
 * invents a route on which the player made no choice at all, which is the one thing the scene
 * guarantees cannot happen. A row written *before* the menu is not gated: it runs before the
 * menu is ever shown.
 *
 * Jumps and `/ending` rows alike, and for the same reason: both are ways the scene hands the run on,
 * and gating one while offering the other would let a route reach an ending having answered nothing.
 *
 * **Only `choice`, never a condition group.** An `if` with no `else` is skipped whole when the
 * condition is false and control walks straight into what follows, so a condition fork guarantees
 * nothing about what comes after it. Extending this to `forkKind: "condition"` would delete that
 * path — the most ordinary shape in a branching script — and the deletion would be silent.
 *
 * **Only root-level forks.** A choice nested inside an `if` arm gates the rest of *that arm*, not
 * the rest of the scene: the scene continues past the `if` whether or not the arm ever ran.
 */
function findGatedBlockIds(scene: StoryScene): Set<StoryBlockId> {
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
        const hasOption = block.childrenIds.some(childId => {
            const child = scene.blocks[childId];
            return Boolean(child && child.kind === "nodeAction" && child.payload.action === "choiceOption");
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
        if (block.kind !== "jump" && !isStoryEndingBlock(block)) {
            continue;
        }
        const at = position.get(block.id) ?? 0;
        // A row inside the menu's own subtree is not gated by it: it is what an option does, and
        // the arm that owns it already accounts for it.
        if (gates.some(gate => gate.at < at && !isDescendantOf(scene, block, gate.id))) {
            gated.add(block.id);
        }
    }
    return gated;
}

/**
 * The arm that guards a row, or null when nothing does.
 *
 * Nearest wins — the same rule `resolveOwningArm` applies to a jump, so an `/ending` under an option
 * nested in an `if` belongs to the option. Which blocks *are* arms comes from the graph rather than
 * being recognised a second time here, which is what keeps this and the drawn map from disagreeing
 * about what a fork is.
 */
function resolveGuardingArmId(
    scene: StoryScene,
    block: StoryBlock,
    armIdByBlockId: ReadonlyMap<StoryBlockId, string>,
): string | null {
    const seen = new Set<StoryBlockId>();
    let parentId = block.parentId;
    // A corrupted parent cycle must not hang the editor, hence the visited set.
    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const armId = armIdByBlockId.get(parentId);
        if (armId) {
            return armId;
        }
        parentId = scene.blocks[parentId]?.parentId ?? null;
    }
    return null;
}

/** Somewhere a fall-through arm's rows lead, as {@link readArmFollowOn} finds it. */
type SceneFlowFollowOnStep =
    | { kind: "edge"; edgeId: string; target: StorySceneId }
    | { kind: "ending"; endingId: StoryBlockId }
    | { kind: "quit"; blockId: StoryBlockId };

/**
 * What a run that read the rows after one point reaches: the steps it can take, and whether a path
 * with no option picked on the way falls off the end of the scene.
 */
type SceneFlowFollowOn = { steps: SceneFlowFollowOnStep[]; runsOut: boolean };

/**
 * Where a fall-through arm actually goes, read row by row: the rows left in the arm, then the rows
 * after its fork, then up through every enclosing arm or container until something leaves or the
 * scene ends.
 *
 * Asked only for a scene with no unguarded exit, ending or quit - the case where the graph's
 * "continue to the scene's unguarded exits" answer is empty and would otherwise call the arm a stop.
 * That answer is wrong whenever another menu follows the arm: a `choice` is exhaustive, so a run
 * that reaches one takes one of its options, and those options' jumps and endings are where this
 * arm leads.
 *
 * **A run-out is credited to the arm it happens in.** Reaching a menu whose option falls through and
 * then runs out is that option's defect, reported on that option's row; the arm that merely led to
 * the menu is not reported again for it. Only a path that falls off the scene with no option taken
 * on the way - past a condition with no `else`, or past nothing at all - counts against this arm.
 *
 * Which blocks are arms and which fork each belongs to comes from the graph, not a second reading
 * of the rows, so this cannot disagree with the map about what a fork is.
 */
function readArmFollowOn(
    scene: StoryScene,
    arm: SceneFlowBranchNodeModel,
    sceneArms: readonly SceneFlowBranchNodeModel[],
    ownSteps: (branch: SceneFlowBranchNodeModel) => SceneFlowFollowOnStep[] | null,
    edgeIdFor: (target: StorySceneId) => string | undefined,
): SceneFlowFollowOn {
    const armByBlockId = new Map(sceneArms.map(branch => [branch.blockId, branch]));
    const armsByForkId = new Map<string, SceneFlowBranchNodeModel[]>();
    for (const branch of sceneArms) {
        pushInto(armsByForkId, branch.forkId, branch);
    }
    // Rows only move forward or outward, so a well-formed scene cannot loop; a corrupted parent or
    // child cycle must still not hang the editor. `active` is the recursion stack - a key met again
    // while still on it is a cycle and reads as nothing - and the memo keeps a fork several arms
    // fall out of from being read once per arm.
    const active = new Set<string>();
    const memo = new Map<string, SceneFlowFollowOn>();
    const NOTHING: SceneFlowFollowOn = { steps: [], runsOut: false };
    const guarded = (key: string, read: () => SceneFlowFollowOn): SceneFlowFollowOn => {
        const cached = memo.get(key);
        if (cached) {
            return cached;
        }
        if (active.has(key)) {
            return NOTHING;
        }
        active.add(key);
        const result = read();
        active.delete(key);
        memo.set(key, result);
        return result;
    };

    const listOf = (parentId: StoryBlockId | null): readonly StoryBlockId[] =>
        parentId ? scene.blocks[parentId]?.childrenIds ?? [] : scene.rootBlockIds;

    /** Reads `ids` from `from` on. `runsOut` means the list ended with no option taken. */
    const readList = (ids: readonly StoryBlockId[], from: number): SceneFlowFollowOn => {
        const steps: SceneFlowFollowOnStep[] = [];
        for (let index = from; index < ids.length; index += 1) {
            const block = scene.blocks[ids[index]];
            if (!block || block.disabled) {
                continue;
            }
            const asArm = armByBlockId.get(block.id);
            if (asArm && asArm.forkId !== block.id) {
                // An `elseIf` / `else` - read with the `if` that opened its group.
                continue;
            }
            const forkArms = armsByForkId.get(block.id);
            if (forkArms) {
                for (const branch of forkArms) {
                    // The option's own run-out is its own finding; only where it leads is carried.
                    steps.push(...readArm(branch).steps);
                }
                const exhaustive = forkArms[0].forkKind === "choice"
                    || forkArms.some(branch => branch.kind === "conditionElse");
                if (exhaustive) {
                    // Nothing gets past a menu without picking an option, and every option's way
                    // onward - including falling through to the rows below - is in its own reading.
                    return { steps, runsOut: false };
                }
                // An `if` with no `else` is skipped whole when the condition is false.
                continue;
            }
            if (block.kind === "jump") {
                const target = block.payload.targetSceneId;
                if (block.payload.returnable === true && target && target !== scene.id) {
                    // A call comes back and the rows below it run.
                    continue;
                }
                const edgeId = target && target !== scene.id ? edgeIdFor(target) : undefined;
                if (target && edgeId) {
                    steps.push({ kind: "edge", edgeId, target });
                }
                // A dangling jump is a compile error and a self-jump is a loop: neither is a place
                // the run falls off, and neither is somewhere this walk can follow.
                return { steps, runsOut: false };
            }
            if (isStoryEndingBlock(block)) {
                steps.push({ kind: "ending", endingId: block.id });
                return { steps, runsOut: false };
            }
            if (block.kind === "control" && block.payload.control === "quit") {
                steps.push({ kind: "quit", blockId: block.id });
                return { steps, runsOut: false };
            }
            if (block.childrenIds.length > 0) {
                const inner = guarded(`inside:${block.id}`, () => readList(block.childrenIds, 0));
                steps.push(...inner.steps);
                if (!inner.runsOut) {
                    return { steps, runsOut: false };
                }
            }
        }
        return { steps, runsOut: true };
    };

    /** Reads on from just after `blockId`, climbing out of every list that ends on the way. */
    const readAfter = (blockId: StoryBlockId): SceneFlowFollowOn => guarded(`after:${blockId}`, () => {
        const parentId = scene.blocks[blockId]?.parentId ?? null;
        const list = listOf(parentId);
        const rest = readList(list, list.indexOf(blockId) + 1);
        if (!rest.runsOut || !parentId) {
            return rest;
        }
        const parentArm = armByBlockId.get(parentId);
        const outer = parentArm ? readPastFork(parentArm) : readAfter(parentId);
        return { steps: [...rest.steps, ...outer.steps], runsOut: outer.runsOut };
    });

    /** An arm whose rows ran out continues after its whole fork: past the menu, or past the last `else`. */
    const readPastFork = (branch: SceneFlowBranchNodeModel): SceneFlowFollowOn => {
        if (branch.forkKind === "choice") {
            return readAfter(branch.forkId);
        }
        const groupIds = (armsByForkId.get(branch.forkId) ?? [branch]).map(item => item.blockId);
        const list = listOf(scene.blocks[branch.blockId]?.parentId ?? null);
        const last = groupIds.reduce((latest, id) => Math.max(latest, list.indexOf(id)), -1);
        return readAfter(last >= 0 ? list[last] : branch.blockId);
    };

    const readArm = (branch: SceneFlowBranchNodeModel): SceneFlowFollowOn => guarded(`arm:${branch.id}`, () => {
        const own = ownSteps(branch);
        if (own) {
            return { steps: own, runsOut: false };
        }
        const inside = readList(scene.blocks[branch.blockId]?.childrenIds ?? [], 0);
        if (!inside.runsOut) {
            return inside;
        }
        const after = readPastFork(branch);
        return { steps: [...inside.steps, ...after.steps], runsOut: after.runsOut };
    });

    return readArm(arm);
}

/**
 * Every way out of every scene — and every way each one stops — in a fixed order, so the
 * enumeration, and therefore which routes survive the cap, is the same on every rebuild.
 *
 * Arms come first, in the graph's fork-then-arm order, then unguarded exits, then unguarded endings.
 *
 * Exported because this is the one place that decides where a run can go next: a check that walked
 * the graph its own way could report a path the map does not draw, or miss one it does.
 */
export function collectSceneFlowContinuations(
    graph: SceneFlowGraph,
    document: StoryDocument,
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
    // Calls are collected once per scene rather than split the two ways exits are: a call is not a
    // way out, so whether a menu stands in front of it changes nothing about where a path can end.
    const callsBySceneId = new Map<StorySceneId, SceneFlowPlainCall[]>();
    const gatedBlockIdsBySceneId = new Map<StorySceneId, Set<StoryBlockId>>();
    const gatedBlockIds = (sceneId: StorySceneId): Set<StoryBlockId> => {
        const cached = gatedBlockIdsBySceneId.get(sceneId);
        if (cached) {
            return cached;
        }
        const scene = document.scenes[sceneId];
        const gated = scene ? findGatedBlockIds(scene) : new Set<StoryBlockId>();
        gatedBlockIdsBySceneId.set(sceneId, gated);
        return gated;
    };
    for (const edge of graph.edges) {
        const exit = { edgeId: edge.id, target: edge.target };
        // One pair of scenes, two kinds of row: an edge carrying both a plain jump and a returnable
        // one is both a way out and a call, and each half has to be said separately.
        //
        // Every jump on the edge, owned or not, unlike the exits below. Ownership decides which arm
        // a way OUT belongs to, and a call is not one: the run goes to the target and comes back to
        // the scene whichever arm the row sits under. Reading only the unowned rows here would leave
        // a call written inside a menu option contributing nothing at all - the arm falls through, so
        // it never reports the edge either - and every ending in the scene it names would then be
        // one no walk can reach.
        if (edge.jumps.some(jump => jump.returnable)) {
            pushInto(callsBySceneId, edge.source, exit);
        }
        const unowned = edge.jumps.filter(jump => !ownedJumpIds.has(jump.blockId));
        const leaving = unowned.filter(jump => !jump.returnable);
        if (leaving.length === 0) {
            continue;
        }
        pushInto(plainExitsBySceneId, edge.source, exit);
        const gated = gatedBlockIds(edge.source);
        if (leaving.some(jump => !gated.has(jump.blockId))) {
            pushInto(standaloneExitsBySceneId, edge.source, exit);
        }
    }

    // Arms by the block each one is, per scene, so an `/ending` row can be attributed to the arm
    // that guards it. Per scene rather than per document because a fixture may reuse a block id
    // across scenes, and an ending merged into a stranger's arm would read as a routing defect.
    const armIdsBySceneId = new Map<StorySceneId, Map<StoryBlockId, string>>();
    for (const branch of graph.branches) {
        const arms = armIdsBySceneId.get(branch.sceneId);
        if (arms) {
            arms.set(branch.blockId, branch.id);
        } else {
            armIdsBySceneId.set(branch.sceneId, new Map([[branch.blockId, branch.id]]));
        }
    }

    // Endings, split the same two ways the exits are, and for the same reason. An ending under an
    // arm belongs to that arm instead and is in neither list: it is that arm's way of stopping.
    const endingsByBranchId = new Map<string, StoryBlockId[]>();
    const plainEndingsBySceneId = new Map<StorySceneId, StoryBlockId[]>();
    const standaloneEndingsBySceneId = new Map<StorySceneId, StoryBlockId[]>();
    // Quits, split the same three ways and by the same rules. They are terminals like endings, so
    // every place a list of endings decides whether an arm falls through or a scene has somewhere
    // to go, the quits have to be in that decision too.
    const quitsByBranchId = new Map<string, StoryBlockId[]>();
    const plainQuitsBySceneId = new Map<StorySceneId, StoryBlockId[]>();
    const standaloneQuitsBySceneId = new Map<StorySceneId, StoryBlockId[]>();
    for (const node of graph.nodes) {
        const scene = document.scenes[node.sceneId];
        if (!scene) {
            continue;
        }
        const arms = armIdsBySceneId.get(node.sceneId);
        // One walk for both terminals rather than a scanner apiece.
        // This runs per graph node on every rebuild of the map, and the two scanners would each
        // traverse the scene's whole block tree to pick out a handful of rows.
        for (const block of listSceneBlocksInDocumentOrder(scene, { skipSubtree: row => Boolean(row.disabled) })) {
            const terminal = isStoryEndingBlock(block)
                ? "ending" as const
                : block.kind === "control" && block.payload.control === "quit"
                    ? "quit" as const
                    : null;
            if (!terminal) {
                continue;
            }
            const armId = arms ? resolveGuardingArmId(scene, block, arms) : null;
            const [byBranch, byScene, standalone] = terminal === "ending"
                ? [endingsByBranchId, plainEndingsBySceneId, standaloneEndingsBySceneId]
                : [quitsByBranchId, plainQuitsBySceneId, standaloneQuitsBySceneId];
            if (armId) {
                pushInto(byBranch, armId, block.id);
                continue;
            }
            pushInto(byScene, node.sceneId, block.id);
            if (!gatedBlockIds(node.sceneId).has(block.id)) {
                pushInto(standalone, node.sceneId, block.id);
            }
        }
    }

    const branchEdgesByBranchId = new Map<string, SceneFlowBranchEdgeModel[]>();
    for (const edge of graph.branchEdges) {
        pushInto(branchEdgesByBranchId, edge.sourceBranchId, edge);
    }

    // What `readArmFollowOn` needs, for the arms the graph alone would call a stop.
    const armsBySceneId = new Map<StorySceneId, SceneFlowBranchNodeModel[]>();
    for (const branch of graph.branches) {
        pushInto(armsBySceneId, branch.sceneId, branch);
    }
    const edgeIdByPair = new Map(graph.edges.map(edge => [`${edge.source}->${edge.target}`, edge.id]));
    const ownFollowOnSteps = (branch: SceneFlowBranchNodeModel): SceneFlowFollowOnStep[] | null => {
        const endings = endingsByBranchId.get(branch.id) ?? [];
        const quits = quitsByBranchId.get(branch.id) ?? [];
        if (endings.length > 0 || quits.length > 0) {
            return [
                ...endings.map(endingId => ({ kind: "ending" as const, endingId })),
                ...quits.map(blockId => ({ kind: "quit" as const, blockId })),
            ];
        }
        if (branch.fallsThrough) {
            return null;
        }
        // Empty for an arm whose only jump is dangling: it does not fall through, and it goes nowhere.
        return (branchEdgesByBranchId.get(branch.id) ?? [])
            .filter(edge => !edge.jumps.every(jump => jump.returnable))
            .map(edge => ({ kind: "edge" as const, edgeId: edge.id, target: edge.target }));
    };
    const readFollowOn = (branch: SceneFlowBranchNodeModel): SceneFlowFollowOn => {
        const scene = document.scenes[branch.sceneId];
        if (!scene) {
            return { steps: [], runsOut: true };
        }
        return readArmFollowOn(
            scene,
            branch,
            armsBySceneId.get(branch.sceneId) ?? [],
            ownFollowOnSteps,
            target => edgeIdByPair.get(`${branch.sceneId}->${target}`),
        );
    };

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
        const owned = endingsByBranchId.get(branch.id) ?? [];
        const ownedQuits = quitsByBranchId.get(branch.id) ?? [];
        for (const endingId of owned) {
            list.push({ kind: "ending", branchId: branch.id, endingId });
        }
        for (const blockId of ownedQuits) {
            list.push({ kind: "quit", branchId: branch.id, blockId });
        }
        if (branch.fallsThrough) {
            // An arm holding an ending or a quit does not fall through: the run stops at the row
            // rather than returning to the scene and continuing past the fork.
            if (owned.length > 0 || ownedQuits.length > 0) {
                continue;
            }
            // The arm owns no exit, so control returns to the scene and continues past the fork —
            // which, as far as the graph knows, means the scene's unguarded exits and terminals.
            const onward = plainExitsBySceneId.get(branch.sceneId) ?? [];
            const onwardEndings = plainEndingsBySceneId.get(branch.sceneId) ?? [];
            const onwardQuits = plainQuitsBySceneId.get(branch.sceneId) ?? [];
            if (onward.length === 0 && onwardEndings.length === 0 && onwardQuits.length === 0) {
                // Nothing unguarded is left, but a menu written after the arm (or inside it) still
                // carries the run on: read the rows to find it before calling the arm a stop.
                const followOn = readFollowOn(branch);
                const seenSteps = new Set<string>();
                for (const step of followOn.steps) {
                    const key = step.kind === "edge" ? `edge:${step.edgeId}`
                        : step.kind === "ending" ? `ending:${step.endingId}` : `quit:${step.blockId}`;
                    if (seenSteps.has(key)) {
                        continue;
                    }
                    seenSteps.add(key);
                    list.push({ ...step, branchId: branch.id });
                }
                if (followOn.runsOut || seenSteps.size === 0) {
                    list.push({ kind: "stop", branchId: branch.id });
                }
                continue;
            }
            for (const exit of onward) {
                list.push({ kind: "edge", branchId: branch.id, edgeId: exit.edgeId, target: exit.target });
            }
            for (const endingId of onwardEndings) {
                list.push({ kind: "ending", branchId: branch.id, endingId });
            }
            for (const blockId of onwardQuits) {
                list.push({ kind: "quit", branchId: branch.id, blockId });
            }
            continue;
        }
        // An arm with targets, or one whose only jump is dangling: the latter contributes nothing,
        // because a broken jump is a compile error, not an ending, and a route that stops on it
        // would present the defect as a place the story can finish.
        for (const edge of branchEdgesByBranchId.get(branch.id) ?? []) {
            const kind = edge.jumps.every(jump => jump.returnable) ? "call" as const : "edge" as const;
            list.push({ kind, branchId: branch.id, edgeId: edge.id, target: edge.target });
        }
    }

    for (const [sceneId, exits] of standaloneExitsBySceneId) {
        const list = listFor(sceneId);
        for (const exit of exits) {
            list.push({ kind: "edge", branchId: null, edgeId: exit.edgeId, target: exit.target });
        }
    }

    for (const [sceneId, endingIds] of standaloneEndingsBySceneId) {
        const list = listFor(sceneId);
        for (const endingId of endingIds) {
            list.push({ kind: "ending", branchId: null, endingId });
        }
    }

    for (const [sceneId, blockIds] of standaloneQuitsBySceneId) {
        const list = listFor(sceneId);
        for (const blockId of blockIds) {
            list.push({ kind: "quit", branchId: null, blockId });
        }
    }

    // Last, so a scene's real ways out come first and a reader can stop at the first one that leaves.
    for (const [sceneId, calls] of callsBySceneId) {
        const list = listFor(sceneId);
        for (const call of calls) {
            list.push({ kind: "call", branchId: null, edgeId: call.edgeId, target: call.target });
        }
    }

    return continuations;
}

/**
 * Endings and every decision path that reaches one.
 *
 * `document` supplies the two things the graph does not carry: the `/ending` rows, and the entry
 * scene. The entry is guarded exactly as `buildSceneFlowGraph` guards it, so a story pointing at a
 * deleted scene is treated as having no entry rather than as having a broken one.
 */
export function buildSceneFlowRouteMap(graph: SceneFlowGraph, document: StoryDocument): SceneFlowRouteMap {
    const authored = listStoryEndings(document);
    const reachableBySceneId = new Map(graph.nodes.map(node => [node.sceneId, node.reachable]));
    // A scene with no outgoing edge is a scene the story cannot leave. Self and dangling jumps
    // produce no edge in the graph, so "only dangling/self ones" is already covered here rather than
    // needing a second reading of the jump counts.
    const scenesWithExit = new Set<StorySceneId>(graph.edges.map(edge => edge.source));
    const endings: SceneFlowEnding[] = authored.length > 0
        ? authored.map(ending => ({
            id: ending.endingId,
            source: "authored" as const,
            sceneId: ending.sceneId,
            name: ending.name,
            reachable: reachableBySceneId.get(ending.sceneId) ?? true,
        }))
        : graph.nodes
            .filter(node => !scenesWithExit.has(node.sceneId))
            .map(node => ({
                id: node.sceneId,
                source: "derived" as const,
                sceneId: node.sceneId,
                name: node.name,
                reachable: node.reachable,
            }));
    // A path that stops in one of these scenes reached the derived ending that IS the scene. Empty
    // once the story marks an ending of its own, where stopping somewhere with no `/ending` row is
    // exactly the thing worth telling apart from finishing.
    const derivedEndingSceneIds = new Set(
        endings.filter(ending => ending.source === "derived").map(ending => ending.sceneId),
    );
    const derivedEndingAt = (sceneId: StorySceneId): string | null =>
        derivedEndingSceneIds.has(sceneId) ? sceneId : null;

    const entrySceneId = document.entrySceneId && document.scenes[document.entrySceneId]
        ? document.entrySceneId
        : undefined;
    if (!entrySceneId) {
        // No "from" to enumerate from. The endings are still a fact about the graph, but every
        // route-derived diagnostic would be an artefact of the missing entry rather than of the
        // story, so none of them is claimed.
        return { endings, routes: [], truncated: false, unreachableEndings: [], deadBranchIds: [] };
    }

    const continuations = collectSceneFlowContinuations(graph, document);
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
     * the ending that was reached, or the edge that looped back. Without it, "picked option A and
     * the scene ended" and "picked option B and the scene ended" collapse into one id, and the rail
     * keys two list rows the same.
     */
    const emit = (
        tail: string | null,
        tailBranchId: string | null,
        truncatedByCycle: boolean,
        endingId: string | null,
    ): void => {
        const parts = [entrySceneId, ...steps.map(step => `${step.branchId ?? "-"}@${step.edgeId}`)];
        if (tail) {
            parts.push(tail);
        }
        routes.push({
            // Joined rather than hashed: 200 ids is nowhere near enough to justify a collision
            // risk, and a selection landing on the wrong path is worse than a long string.
            id: `scene-flow:route:${parts.join("/")}`,
            endingSceneId: sceneIds[sceneIds.length - 1],
            endingId,
            steps: steps.map(step => ({ ...step })),
            sceneIds: [...sceneIds],
            branchIds: tailBranchId ? [...branchIds, tailBranchId] : [...branchIds],
            truncatedByCycle,
        });
    };

    const walk = (sceneId: StorySceneId): void => {
        // A call is not a step of a route. A route is the sequence of decisions that gets a player
        // somewhere, and going into a called scene is not one of them - the run comes back either
        // way. A scene whose only continuations are calls therefore ends the route here, which is
        // where the run really does stop once the calls have returned.
        const exits = (continuations.get(sceneId) ?? []).filter(exit => exit.kind !== "call");
        if (exits.length === 0) {
            emit(null, null, false, derivedEndingAt(sceneId));
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
            if (exit.kind === "ending") {
                emit(`~end:${exit.endingId}`, exit.branchId, false, exit.endingId);
                continue;
            }
            if (exit.kind === "quit") {
                // A route that finishes on a quit is finished: it reached no ending, and it did not
                // run out either. `null` for the ending is the same value a `stop` gets in a story
                // with nothing derived at that scene, and the rail reads both as "no ending".
                emit(`~quit:${exit.blockId}`, exit.branchId, false, null);
                continue;
            }
            if (exit.kind === "stop") {
                // The arm ran out. In the derived fallback the scene it ran out in may itself be an
                // ending, in which case that is what the path reached and the arm is how it got here.
                emit(`~stop:${exit.branchId}`, exit.branchId, false, derivedEndingAt(sceneId));
                continue;
            }
            if (visited.has(exit.target)) {
                // Cut here rather than following the loop: the route is the part of the path that is
                // a path, and the flag says it did not stop because the story ended. The closing hop
                // is deliberately not a step — `sceneIds` promises no repeats.
                emit(`~cut:${exit.branchId ?? "-"}@${exit.edgeId}`, exit.branchId, true, null);
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

    // Reached, not merely visited: an ending is reached by a route that STOPS at it. A route passing
    // through the scene on its way somewhere else has not reached the ending in it, which is the
    // difference several endings in one scene made visible.
    const reachedEndingIds = new Set<string>();
    const usedBranchIds = new Set<string>();
    for (const route of routes) {
        if (route.endingId) {
            reachedEndingIds.add(route.endingId);
        }
        for (const branchId of route.branchIds) {
            usedBranchIds.add(branchId);
        }
    }

    // Endings inside a called scene are not claimed unreachable. The route walk does not step into
    // a call, so no route can reach one - which is a limit of the enumeration, not a fact about the
    // story. `reachable-endings` walks calls properly and is the check that answers this question.
    //
    // And not only the called scene: everything it goes on to reach is behind the same blind spot.
    // A plain jump taken out of a called scene gives the call up and carries the run on, so those
    // scenes are entered for real - the walk simply stopped before it could see them. Closed over
    // the graph's own edges, so a chain of any length is covered by the one rule.
    const calledSceneIds = new Set<StorySceneId>();
    const beyondCalls: StorySceneId[] = [];
    const holdEndingsOf = (sceneId: StorySceneId): void => {
        if (!calledSceneIds.has(sceneId)) {
            calledSceneIds.add(sceneId);
            beyondCalls.push(sceneId);
        }
    };
    for (const edge of graph.edges) {
        if (edge.jumps.some(jump => jump.returnable)) {
            holdEndingsOf(edge.target);
        }
    }
    for (let cursor = 0; cursor < beyondCalls.length; cursor += 1) {
        for (const edge of graph.edges) {
            if (edge.source === beyondCalls[cursor]) {
                holdEndingsOf(edge.target);
            }
        }
    }

    return {
        endings,
        routes,
        truncated,
        unreachableEndings: endings
            .filter(ending => !reachedEndingIds.has(ending.id) && !calledSceneIds.has(ending.sceneId))
            .map(ending => ending.id),
        deadBranchIds: graph.branches.filter(branch => !usedBranchIds.has(branch.id)).map(branch => branch.id),
    };
}
