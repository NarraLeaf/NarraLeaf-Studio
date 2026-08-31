/**
 * What a player can actually reach once conditions are taken into account.
 *
 * Every other check over the scene map treats each arm of every fork as walkable — `reachableEndings`
 * says so in as many words, and that is what makes it a check on the script's shape rather than a
 * solver. This is the solver, kept deliberately small: it walks the same graph, carries an interval
 * per numeric variable, and refuses to take an arm whose guard cannot hold with what the counters can
 * be worth on arrival. What falls out is coverage — the scenes, the options and the endings that no
 * feasible path touches.
 *
 * # The shape of the search
 *
 * A fixpoint, not an enumeration. Listing routes is combinatorial (`MAX_ROUTES = 200` exists because
 * of it), while "can anything reach here" is a property of a scene, so the state of each scene is the
 * **join** of every state that arrives at it and each scene is re-visited only while that join keeps
 * changing. Eight two-way choices are 256 routes and still eight scenes.
 *
 * The join is what makes it terminate and also what it costs: two variables that can each hold a
 * value but never together are not distinguished, so `好感 >= 50 && 信頼 <= 0` is judged one side at a
 * time. That is the same limit {@link guardTruth} states, and widening it needs a relational domain
 * rather than a bigger budget.
 *
 * # Soundness, and which direction the errors go
 *
 * Every approximation here widens: an arm whose guard cannot be evaluated is taken, an unreadable
 * write makes its variable `unknown`, a loop that keeps moving a counter widens it to `unknown`, and
 * a scene reached two ways holds the union. **The only claim this makes is a negative one** — that
 * nothing reaches a place — and a widened state can only ever make more things reachable. So a
 * finding here survives every imprecision in the analysis, while the things it stays quiet about
 * include plenty it simply could not decide.
 *
 * That is also why a project full of opaque writers degrades rather than lies. A plugin marker or a
 * `scriptModule` blueprint poisons the variables it might touch to `unknown`; guards on them then
 * never prune; the feasible answer collapses onto the structural one; and the difference this reports
 * is empty. Nothing needs to switch the check off.
 *
 * # What is deliberately not modelled
 *
 * In-scene row order, exactly as {@link sceneFlowVariables} does not model it. A guard is judged
 * against the arrival state widened by every write the scene contains, as though each may or may not
 * have run — which holds both the reading where the write above it ran and the one where it did not.
 * Narrowing that to the true row order is the row-level walk this deliberately is not, and would buy
 * precision at the cost of the one property that makes the findings worth printing.
 */

import type {
    StoryBlock,
    StoryConditionRef,
    StoryDocument,
    StoryBlockId,
    StorySceneId,
} from "@shared/types/story";
import { listScenesInDocumentOrder } from "@shared/types/story";
import { guardTruth } from "@/lib/story/guardTruth";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { buildSceneFlowGraph, type SceneFlowBranchNodeModel, type SceneFlowGraph } from "./sceneFlowModel";
import { collectSceneFlowContinuations, type SceneFlowContinuation } from "./sceneFlowRoutes";
import {
    applyVariableEffects,
    collectArmArrivalEffects,
    collectSceneEffects,
    listNumericStoryVariables,
    sceneWritesAsUncertain,
    sceneWritesBefore,
    unionVariableRanges,
    variableRangesEqual,
    type SceneFlowBlueprintWrites,
    type SceneFlowNumericVariable,
    type SceneFlowRange,
    type SceneFlowVariableEffect,
} from "./sceneFlowVariables";

const UNKNOWN: SceneFlowRange = { kind: "unknown" };

/** One abstract state: what each numeric variable can be worth at a point. Absent means unknown. */
type VariableState = Map<string, SceneFlowRange>;

export type SceneFlowCoverage = {
    /** Scenes some feasible path enters. */
    reachableSceneIds: Set<StorySceneId>;
    /** The same question ignoring every condition — what the structural checks already answer. */
    structuralSceneIds: Set<StorySceneId>;
    /** Branch node ids (`graph.branches[].id`) a feasible path takes. */
    takenBranchIds: Set<string>;
    /** The same, ignoring conditions. */
    structuralBranchIds: Set<string>;
    /**
     * The unreachable scenes worth naming: those with at least one predecessor a path DOES reach.
     *
     * One bad guard closes a door, and everything behind that door is unreachable too - a fixture
     * with one impossible condition on its entry scene's only exit turned eleven of twelve scenes
     * unreachable, which is one mistake and eleven findings. A report that names only the frontier
     * names the door; what is behind it follows from that and needs no sentence of its own.
     */
    frontierUnreachableSceneIds: Set<StorySceneId>;
    /** `/ending` row ids a feasible path reaches. */
    reachedEndingIds: Set<StoryBlockId>;
    /** The same, ignoring conditions. */
    structuralEndingIds: Set<StoryBlockId>;
    /**
     * Whether the walk ran to a fixpoint rather than hitting its own guard rail.
     *
     * False means every answer above is the structural one: a walk that stopped early does not know
     * which scenes had settled, so the only honest thing to do is claim nothing.
     */
    settled: boolean;
};

export type SceneFlowCoverageOptions = {
    registry?: readonly VariableRegistryEntry[];
    blueprintWrites?: SceneFlowBlueprintWrites;
    /** Prebuilt graph, when the caller already has one for this exact document. */
    graph?: SceneFlowGraph;
    /**
     * Variable keys something outside this story writes, which this walk therefore cannot bound.
     *
     * `saved` and `persistent` outlive any one document: a counter another story moves has an
     * arrival value here that no walk of THIS scene graph can see, and seeding it from its declared
     * default would be describing a playthrough nobody has. Seeded `unknown`, which is absorbing, so
     * no guard on one ever prunes.
     */
    externallyWrittenKeys?: ReadonlySet<string>;
    /**
     * Whether the project holds a writer this analysis cannot read — a `scriptModule` blueprint, say.
     *
     * The caller decides, because what counts lives outside one story document. Setting it makes
     * every counter `unknown`, so no guard prunes and the feasible answer lands on the structural
     * one: the check reports nothing rather than something it cannot stand behind.
     */
    opaqueWriters?: boolean;
};

/**
 * Which guard, if any, decides whether one arm is taken.
 *
 * An `if` arm's own condition, or an option's `hiddenWhen` — an option the game hides is one the
 * player cannot pick, so a `hiddenWhen` that always holds closes the arm exactly as a false `if`
 * does. `disabledWhen` is deliberately NOT read: a disabled option is *shown*, greyed, and an author
 * greying one out has said the player should see it and not take it. Reporting it as unreachable
 * content would be reporting the feature working.
 */
function armGuard(scene: { blocks: Record<StoryBlockId, StoryBlock> }, blockId: StoryBlockId): {
    condition: StoryConditionRef;
    /** True when the arm is taken while the condition is FALSE - which is what `hiddenWhen` means. */
    inverted: boolean;
} | null {
    const block = scene.blocks[blockId];
    if (!block) {
        return null;
    }
    if (block.kind === "control" && block.payload.control === "conditionBranch" && block.payload.condition) {
        return { condition: block.payload.condition, inverted: false };
    }
    if (block.kind === "nodeAction" && "hiddenWhen" in block.payload && block.payload.hiddenWhen) {
        return { condition: block.payload.hiddenWhen, inverted: true };
    }
    return null;
}

/** The state a story starts in: every numeric variable at its declared default, or unknown. */
function seedState(
    variables: readonly SceneFlowNumericVariable[],
    externallyWritten: ReadonlySet<string>,
): VariableState {
    const state: VariableState = new Map();
    for (const variable of variables) {
        // A missing default is not zero. The compiler seeds a saved variable to `null` and skips a
        // scene-local with none, so a number the author never stated is a number nobody knows.
        state.set(variable.key, variable.defaultValue === null || externallyWritten.has(variable.key)
            ? UNKNOWN
            : { kind: "known", min: variable.defaultValue, max: variable.defaultValue });
    }
    return state;
}

/**
 * A scene-scoped variable exists only inside its own scene and is re-seeded every time the scene is
 * entered, so carrying one across a jump would answer with a number from a different scene's run.
 */
function reseedSceneLocals(
    state: VariableState,
    variables: readonly SceneFlowNumericVariable[],
    sceneId: StorySceneId,
    declaringSceneOf: ReadonlyMap<string, StorySceneId>,
): VariableState {
    const next = new Map(state);
    for (const variable of variables) {
        if (variable.scope !== "scene") {
            continue;
        }
        const owner = declaringSceneOf.get(variable.key);
        next.set(variable.key, owner === sceneId && variable.defaultValue !== null
            ? { kind: "known", min: variable.defaultValue, max: variable.defaultValue }
            : UNKNOWN);
    }
    return next;
}

function applyToState(
    state: VariableState,
    effects: readonly SceneFlowVariableEffect[],
    variables: readonly SceneFlowNumericVariable[],
): VariableState {
    if (effects.length === 0) {
        return state;
    }
    const next = new Map(state);
    for (const variable of variables) {
        next.set(variable.key, applyVariableEffects(state.get(variable.key) ?? UNKNOWN, effects, variable.key));
    }
    return next;
}

/** Per key, the union - two ways to one scene mean the player could have arrived by either. */
function joinStates(left: VariableState, right: VariableState, variables: readonly SceneFlowNumericVariable[]): VariableState {
    const joined: VariableState = new Map();
    for (const variable of variables) {
        joined.set(variable.key, unionVariableRanges(
            left.get(variable.key) ?? UNKNOWN,
            right.get(variable.key) ?? UNKNOWN,
        ));
    }
    return joined;
}

function statesEqual(left: VariableState, right: VariableState, variables: readonly SceneFlowNumericVariable[]): boolean {
    return variables.every(variable => variableRangesEqual(
        left.get(variable.key) ?? UNKNOWN,
        right.get(variable.key) ?? UNKNOWN,
    ));
}

/** Everything unknown - what a scene widens to once it has been revisited past its budget. */
function widenAll(variables: readonly SceneFlowNumericVariable[]): VariableState {
    return new Map(variables.map(variable => [variable.key, UNKNOWN]));
}

/**
 * Whether one arm can be taken with the counters holding what `bound` says they can.
 *
 * Only an `expression` condition is judged: a `variable`-kind one is a boolean or `exists` test this
 * numeric domain says nothing about, and a `blueprint` one is a graph. Both are taken.
 */
function armIsPassable(
    scene: { blocks: Record<StoryBlockId, StoryBlock> },
    arm: SceneFlowBranchNodeModel,
    bound: VariableState,
): boolean {
    const guard = armGuard(scene, arm.blockId);
    if (!guard || guard.condition.kind !== "expression") {
        return true;
    }
    const truth = guardTruth(guard.condition.expression.ast, key => bound.get(key) ?? UNKNOWN);
    // `hiddenWhen` closes the arm when it HOLDS; an `if` arm closes when its condition does not.
    return guard.inverted ? truth !== "true" : truth !== "false";
}

/**
 * Whether the whole document holds a writer nothing can read, in which case no counter is trustworthy.
 *
 * Poisoning every variable rather than skipping is the point: the walk still runs, guards on poisoned
 * counters never prune, and the feasible answer lands exactly on the structural one - which reports
 * nothing new and claims nothing false.
 */
function hasOpaqueRows(document: StoryDocument): boolean {
    for (const scene of listScenesInDocumentOrder(document)) {
        if (!scene) {
            continue;
        }
        for (const block of Object.values(scene.blocks)) {
            if (block?.kind === "action" && block.payload.action === "plugin") {
                return true;
            }
        }
    }
    return false;
}

/**
 * Walk one story from its entry scenes and report what a feasible path can reach.
 *
 * Both answers are produced in one pass, the structural one by simply not consulting the guards, so
 * the two can never be computed from different graphs and a caller can subtract them safely.
 */
export function computeSceneFlowCoverage(
    document: StoryDocument,
    entrySceneIds: ReadonlySet<StorySceneId>,
    options: SceneFlowCoverageOptions = {},
): SceneFlowCoverage {
    const graph = options.graph ?? buildSceneFlowGraph(document);
    const continuations = collectSceneFlowContinuations(graph, document);
    const armsById = new Map(graph.branches.map(branch => [branch.id, branch]));
    const variables = options.opaqueWriters || hasOpaqueRows(document)
        ? []
        : listNumericStoryVariables(document, options.registry ?? []);
    const armEffects = collectArmArrivalEffects(graph, document, options.blueprintWrites);
    const sceneEffects = collectSceneEffects(document, options.blueprintWrites);

    const declaringSceneOf = new Map<string, StorySceneId>();
    for (const scene of listScenesInDocumentOrder(document)) {
        if (!scene) {
            continue;
        }
        for (const variable of variables) {
            if (variable.scope === "scene" && scene.blocks[variable.variableId]) {
                declaringSceneOf.set(variable.key, scene.id);
            }
        }
    }

    const structural = structuralReach(document, continuations, entrySceneIds);

    const reachableSceneIds = new Set<StorySceneId>();
    const takenBranchIds = new Set<string>();
    const reachedEndingIds = new Set<StoryBlockId>();
    const arrival = new Map<StorySceneId, VariableState>();
    const updates = new Map<StorySceneId, number>();
    const queue: StorySceneId[] = [];

    const seed = seedState(variables, options.externallyWrittenKeys ?? new Set());
    const push = (sceneId: StorySceneId, state: VariableState): void => {
        if (!document.scenes[sceneId]) {
            return;
        }
        const existing = arrival.get(sceneId);
        const merged = existing ? joinStates(existing, state, variables) : state;
        if (existing && statesEqual(existing, merged, variables)) {
            return;
        }
        // A scene whose counters keep moving is on a loop that moves them. Widening past the budget
        // is what turns "the value after N laps" into "this module cannot say", which is the answer.
        const count = (updates.get(sceneId) ?? 0) + 1;
        updates.set(sceneId, count);
        const next = count > SCENE_UPDATE_BUDGET ? widenAll(variables) : merged;
        if (existing && statesEqual(existing, next, variables)) {
            return;
        }
        arrival.set(sceneId, next);
        queue.push(sceneId);
    };
    for (const sceneId of entrySceneIds) {
        push(sceneId, seed);
    }

    // The guard rail, not the mechanism: the budget above already bounds the walk, and this only
    // catches a graph shape nobody predicted. Tripping it means no scene's state can be trusted.
    const popLimit = 4096 + (graph.nodes.length + graph.edges.length) * 32;
    let settled = true;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        if (cursor > popLimit) {
            settled = false;
            break;
        }
        const sceneId = queue[cursor];
        const scene = document.scenes[sceneId];
        if (!scene) {
            continue;
        }
        reachableSceneIds.add(sceneId);

        const entered = reseedSceneLocals(arrival.get(sceneId) ?? seed, variables, sceneId, declaringSceneOf);
        // The scene's own unguarded writes run on every visit, so they are applied before anything
        // leaves; the arms' writes are applied per arm, on the way out.
        const afterScene = applyToState(entered, sceneEffects.get(sceneId) ?? [], variables);
        // The blunt bound, used for any arm whose position in the scene cannot be read.
        const wholeSceneBound = applyToState(
            entered,
            sceneWritesAsUncertain(document, sceneId, options.blueprintWrites),
            variables,
        );

        for (const exit of continuations.get(sceneId) ?? []) {
            // An arm the graph does not know is taken rather than pruned: it is a malformed document
            // (an option with no `choice` above it), and deleting a path because of that would be
            // reporting the defect twice, the second time as content nobody can reach.
            const arm = exit.branchId ? armsById.get(exit.branchId) : undefined;
            if (arm) {
                // Rows above this arm have run and rows below it have not, so the writes that can
                // have moved the counter are the ones before it. Where that cannot be read - a
                // `goto`, a guard inside a loop - the whole-scene bound stands in.
                const before = sceneWritesBefore(document, sceneId, arm.blockId, options.blueprintWrites);
                const bound = before ? applyToState(entered, before, variables) : wholeSceneBound;
                if (!armIsPassable(scene, arm, bound)) {
                    continue;
                }
            }
            if (arm) {
                takenBranchIds.add(arm.id);
            }
            const outgoing = arm
                ? applyToState(afterScene, armEffects.get(arm.id) ?? [], variables)
                : afterScene;
            if (exit.kind === "ending") {
                reachedEndingIds.add(exit.endingId);
            } else if (exit.kind !== "stop" && exit.kind !== "quit") {
                // A quit is terminal and reaches no ending: it has no `target` to walk into, and
                // nothing about it belongs in the endings this path covered.
                push(exit.target, outgoing);
            }
        }
    }

    if (!settled) {
        return {
            reachableSceneIds: new Set(structural.sceneIds),
            structuralSceneIds: structural.sceneIds,
            frontierUnreachableSceneIds: new Set(),
            takenBranchIds: new Set(structural.branchIds),
            structuralBranchIds: structural.branchIds,
            reachedEndingIds: new Set(structural.endingIds),
            structuralEndingIds: structural.endingIds,
            settled: false,
        };
    }
    return {
        reachableSceneIds,
        structuralSceneIds: structural.sceneIds,
        frontierUnreachableSceneIds: frontierOf(structural, continuations, reachableSceneIds),
        takenBranchIds,
        structuralBranchIds: structural.branchIds,
        reachedEndingIds,
        structuralEndingIds: structural.endingIds,
        settled: true,
    };
}

/**
 * The unreachable scenes a path gets *next to* - the doors, not the rooms behind them.
 *
 * A scene is on the frontier when something structurally leads into it from a scene a feasible path
 * does reach. Everything else that is unreachable is unreachable because one of these is, and a
 * report that listed all of them would say one mistake eleven times.
 */
function frontierOf(
    structural: { sceneIds: Set<StorySceneId> },
    continuations: Map<StorySceneId, SceneFlowContinuation[]>,
    reachable: ReadonlySet<StorySceneId>,
): Set<StorySceneId> {
    const frontier = new Set<StorySceneId>();
    for (const sceneId of reachable) {
        for (const exit of continuations.get(sceneId) ?? []) {
            if (exit.kind === "ending" || exit.kind === "stop" || exit.kind === "quit") {
                continue;
            }
            if (structural.sceneIds.has(exit.target) && !reachable.has(exit.target)) {
                frontier.add(exit.target);
            }
        }
    }
    return frontier;
}

/** How many times one scene's state may move before it is widened to unknown. */
const SCENE_UPDATE_BUDGET = 32;

/**
 * The same walk with every guard ignored — what `story/unreachable-scene` and `reachableEndings`
 * already answer, recomputed here so the subtraction a caller does is between two readings of one
 * graph rather than between this walk and somebody else's.
 */
function structuralReach(
    document: StoryDocument,
    continuations: Map<StorySceneId, SceneFlowContinuation[]>,
    entrySceneIds: ReadonlySet<StorySceneId>,
): { sceneIds: Set<StorySceneId>; branchIds: Set<string>; endingIds: Set<StoryBlockId> } {
    const sceneIds = new Set<StorySceneId>();
    const branchIds = new Set<string>();
    const endingIds = new Set<StoryBlockId>();
    const queue: StorySceneId[] = [];
    const enter = (sceneId: StorySceneId): void => {
        if (sceneIds.has(sceneId) || !document.scenes[sceneId]) {
            return;
        }
        sceneIds.add(sceneId);
        queue.push(sceneId);
    };
    for (const sceneId of entrySceneIds) {
        enter(sceneId);
    }
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        for (const exit of continuations.get(queue[cursor]) ?? []) {
            if (exit.branchId) {
                branchIds.add(exit.branchId);
            }
            if (exit.kind === "ending") {
                endingIds.add(exit.endingId);
            } else if (exit.kind !== "stop" && exit.kind !== "quit") {
                enter(exit.target);
            }
        }
    }
    return { sceneIds, branchIds, endingIds };
}
