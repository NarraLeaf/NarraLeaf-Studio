/**
 * Pure projection: what each fork arm does to a numeric story variable, and what range that variable
 * can hold by the time the player reaches a scene — the 好感度分歧线 layer of the scene map.
 *
 * React-free, like `sceneFlowModel`, and for a sharper reason: the arithmetic below IS the claim the
 * map makes to the author, and a claim about numbers has to be testable on its own.
 *
 * One rule governs everything here: **never report a number this module cannot derive.** A write it
 * cannot read, a loop it cannot bound, a scene the entry cannot reach — every one of them answers
 * `unknown`, and the renderer draws `?`. A route planner that quietly rounds an unknown to zero is
 * worse than one that admits it, because the author plans against the number.
 *
 * Two approximations are deliberate, and stated rather than hidden:
 *
 * - **In-scene position is not modelled.** A write authored *after* the jump that leaves the scene
 *   never runs, and this module still counts it. The scene map has never modelled in-scene control
 *   flow — `goto` is invisible to it by design (§12.6) — so tracking a write against a jump's row
 *   position would need the row-level walk the runtime debug model does, on a map whose whole value
 *   is that it is not that.
 * - **Ranges over-approximate.** Where two conditional writes could not both happen, the interval is
 *   widened as if they could. A range that is too wide never claims a reachable value is impossible;
 *   the reverse error hides an ending.
 */

import type {
    StoryActionPayload,
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryScene,
    StorySceneId,
    StoryVariableRef,
    StoryVariableScope,
} from "@shared/types/story";
import {
    findDeclarationBlock,
    listSceneBlocksInDocumentOrder,
    listScenesInDocumentOrder,
    savedVariableDefs,
    sceneVariableDefs,
    storyPersistentDefs,
    storyVariableRefKey,
} from "@shared/types/story";
import type { SceneFlowBranchNodeModel, SceneFlowGraph } from "./sceneFlowModel";

/**
 * What one `setVariable` row does to its target.
 *
 * `unknown` is a first-class answer, not a failure: an expression reading another variable, a `call`,
 * a `ternary`, an `invalid` subtree, a non-numeric literal. All of them are values this module has no
 * way to pin down, and each one is a place the map must say `?`.
 */
export type SceneFlowDelta =
    | { op: "add"; amount: number }
    | { op: "set"; value: number }
    | { op: "unknown" };

export type SceneFlowVariableEffect = {
    /** {@link storyVariableRefKey} of the row's target. */
    variableKey: string;
    delta: SceneFlowDelta;
    /** false when the write sits under a fork *deeper* than the arm this effect is attributed to. */
    certain: boolean;
};

/**
 * The values a variable can hold at a point, or the admission that this module cannot say.
 *
 * `unknown` covers three different causes on purpose — an unreadable write upstream, an unbounded
 * loop, an unreachable scene — because the author's next move is the same for all three: the map is
 * not answering this one, go look. `findReachable` in `sceneFlowModel` draws the same line by
 * returning `null` for "not a claim we can make".
 */
export type SceneFlowRange =
    | { kind: "known"; min: number; max: number }
    | { kind: "unknown" };

/** A numeric declaration, as the focus picker lists it. */
export type SceneFlowNumericVariable = {
    /** {@link storyVariableRefKey} — the key every API here takes and every effect carries. */
    key: string;
    scope: StoryVariableScope;
    variableId: string;
    name: string;
    /** The declared default, or null when the row declares none or declares a non-number. */
    defaultValue: number | null;
};

const UNKNOWN_RANGE: SceneFlowRange = { kind: "unknown" };

type SetVariablePayload = Extract<StoryActionPayload, { action: "setVariable" }>;

/** Only a finite number is a number here: `NaN`/`Infinity` cannot be added to or ranged over. */
function numericLiteral(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * The delta one `setVariable` row applies, recognised **structurally**.
 *
 * The increment test is deliberately the same shape `describeAssignment` uses to word a row `/inc`:
 * a `+`/`-` binary whose LEFT operand reads the assignment target, with a numeric literal on the
 * right. Structural rather than a stored flag, because `/set 好感 好感 + 2` typed longhand IS an
 * increment and reads as one everywhere else in Studio — and because a second, differently-worded
 * reading of the same sugar is exactly the drift `storyRuntimeDebugModel`'s header records (two
 * re-derivations of one row disagreeing where it mattered). If that recognition ever moves, both
 * readings move together or the chip and the row text start telling the author different stories.
 *
 * Everything the two cases do not cover is `unknown`. That includes a read of a *different* variable
 * (`好感 = gold + 1`), every `call`, every `ternary`, and any `invalid` subtree — the map does not
 * evaluate the expression language, and half-evaluating it is how it would start guessing.
 */
export function readSetVariableDelta(payload: SetVariablePayload): SceneFlowDelta {
    const ast = payload.expression?.ast;
    if (!ast) {
        // No expression: `value` is the whole right-hand side (`/set gold 100`), which is also what a
        // pure-literal expression folds back into when it is committed.
        const literal = numericLiteral(payload.value);
        return literal === null ? { op: "unknown" } : { op: "set", value: literal };
    }
    if (ast.kind === "literal") {
        const literal = numericLiteral(ast.value);
        return literal === null ? { op: "unknown" } : { op: "set", value: literal };
    }
    if (ast.kind === "binary" && (ast.op === "+" || ast.op === "-")
        && ast.left.kind === "var"
        && storyVariableRefKey(ast.left.target) === storyVariableRefKey(payload.target)) {
        const step = ast.right.kind === "literal" ? numericLiteral(ast.right.value) : null;
        if (step !== null) {
            // `0 - step` rather than `-step`: negating a zero step yields `-0`, which compares equal
            // to 0 everywhere except in a test matcher, and a fixture that fails on the sign of zero
            // teaches nothing.
            return { op: "add", amount: ast.op === "+" ? step : 0 - step };
        }
    }
    return { op: "unknown" };
}

/** One `setVariable` row, placed in the scene's fork structure. */
type SceneFlowWrite = {
    blockId: StoryBlockId;
    variableKey: string;
    delta: SceneFlowDelta;
    /** The fork arms above this write, nearest first. Empty means the scene's own spine. */
    armChain: StoryBlockId[];
};

/**
 * Whether a block forks — the same two-block test `sceneFlowModel.describeArm` applies, restated as a
 * predicate because attribution needs the ancestry, not the wording.
 *
 * `sequence` / `parallel` / `race` / `repeat` are ordering, not choosing: every write inside them
 * runs, so a write under a `sequence` is as certain as one at the top of the scene.
 */
function isForkArm(block: StoryBlock): boolean {
    return (block.kind === "nodeAction" && block.payload.action === "choiceOption")
        || (block.kind === "control" && block.payload.control === "conditionBranch");
}

function isRepeat(block: StoryBlock): boolean {
    return block.kind === "control" && block.payload.control === "repeat";
}

type SceneFlowAncestry = {
    armChain: StoryBlockId[];
    insideRepeat: boolean;
};

/**
 * The fork arms above a block, nearest first, and whether a loop encloses it.
 *
 * The walk is `parentId`-upward, matching `resolveOwningArm`, so "which arm owns this" is decided the
 * same way for a write as it is for a jump. The visited set is not tidiness: a corrupted `parentId`
 * cycle is a document Studio still has to open in order to repair.
 */
function readAncestry(scene: StoryScene, block: StoryBlock): SceneFlowAncestry {
    const armChain: StoryBlockId[] = [];
    let insideRepeat = false;
    const seen = new Set<StoryBlockId>();
    let parentId = block.parentId;
    while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = scene.blocks[parentId];
        if (!parent) {
            break;
        }
        if (isForkArm(parent)) {
            armChain.push(parent.id);
        } else if (isRepeat(parent)) {
            insideRepeat = true;
        }
        parentId = parent.parentId;
    }
    return { armChain, insideRepeat };
}

function collectSceneWrites(scene: StoryScene): SceneFlowWrite[] {
    const writes: SceneFlowWrite[] = [];
    // A disabled row is compiled out with its whole subtree (schema v7), so a write inside one never
    // runs. Counting it would move a counter the shipped game never moves — the one lie a author
    // greying a row out is explicitly trying to avoid.
    const blocks = listSceneBlocksInDocumentOrder(scene, { skipSubtree: candidate => candidate.disabled === true });
    for (const block of blocks) {
        if (block.kind !== "action" || block.payload.action !== "setVariable") {
            continue;
        }
        const ancestry = readAncestry(scene, block);
        const delta = readSetVariableDelta(block.payload);
        writes.push({
            blockId: block.id,
            variableKey: storyVariableRefKey(block.payload.target),
            // A `repeat` runs its body an author-declared number of times — `times` is optional, and
            // nothing here knows whether the loop was broken out of — so an accumulate inside one
            // compounds an amount this module cannot count. A `set` survives: assigning the same
            // literal N times leaves the same value, so the only thing at stake is whether the loop
            // ran at all, and an author writing a loop means it to run.
            delta: ancestry.insideRepeat && delta.op === "add" ? { op: "unknown" } : delta,
            armChain: ancestry.armChain,
        });
    }
    return writes;
}

function collectWritesByScene(document: StoryDocument): Map<StorySceneId, SceneFlowWrite[]> {
    const byScene = new Map<StorySceneId, SceneFlowWrite[]>();
    for (const scene of listScenesInDocumentOrder(document)) {
        byScene.set(scene.id, collectSceneWrites(scene));
    }
    return byScene;
}

type SceneFlowDocumentIndex = {
    writesByScene: Map<StorySceneId, SceneFlowWrite[]>;
    numericVariables: SceneFlowNumericVariable[];
};

/**
 * The whole-document scan every entry point below starts from, memoized on the document object.
 *
 * {@link foldRouteVariableValue} is called once per route row — up to `MAX_ROUTES` of them in one
 * render — and walking every block of every scene that many times is not something a rail can
 * afford. Keying on document *identity* is sound for exactly the reason `SceneFlowTab` already
 * memoizes the graph, the variable list and the effect maps on `[document]`: a story edit replaces
 * the document object rather than mutating it. If that ever stopped being true, the graph on screen
 * would be stale before this cache was.
 *
 * Nothing here is handed out directly — callers get freshly built effects — so the cached writes
 * cannot be mutated from outside.
 */
const documentIndexCache = new WeakMap<StoryDocument, SceneFlowDocumentIndex>();

function documentIndex(document: StoryDocument): SceneFlowDocumentIndex {
    const cached = documentIndexCache.get(document);
    if (cached) {
        return cached;
    }
    const index: SceneFlowDocumentIndex = {
        writesByScene: collectWritesByScene(document),
        numericVariables: listNumericStoryVariables(document),
    };
    documentIndexCache.set(document, index);
    return index;
}

function effectOf(write: SceneFlowWrite, certain: boolean): SceneFlowVariableEffect {
    return { variableKey: write.variableKey, delta: write.delta, certain };
}

/**
 * Every `setVariable` in each arm's subtree, keyed by branch node id, in document order.
 *
 * Attribution follows the nearest fork, exactly as the jump attribution does: a write under an `if`
 * nested inside an option belongs to the `if` arm. It still appears on the option's list — the option
 * is how the player got there — but as `certain: false`, because whether it happens is another
 * decision's answer. Crediting the option with it outright would put a `+2` chip on a path that may
 * move nothing.
 *
 * An arm with no writes is absent from the map rather than present with an empty array: most arms
 * touch nothing, and a caller reads `?? []`.
 *
 * `document` must be the document `graph` was built from; the branch ids are block ids of its scenes.
 */
export function collectBranchEffects(
    graph: SceneFlowGraph,
    document: StoryDocument,
): Map<string, SceneFlowVariableEffect[]> {
    const { writesByScene } = documentIndex(document);
    const effectsByBranch = new Map<string, SceneFlowVariableEffect[]>();
    for (const branch of graph.branches) {
        const effects: SceneFlowVariableEffect[] = [];
        for (const write of writesByScene.get(branch.sceneId) ?? []) {
            const depth = write.armChain.indexOf(branch.blockId);
            if (depth < 0) {
                continue;
            }
            // Index 0 is the nearest arm, so `depth === 0` is a write on this arm's own spine.
            effects.push(effectOf(write, depth === 0));
        }
        if (effects.length > 0) {
            effectsByBranch.set(branch.id, effects);
        }
    }
    return effectsByBranch;
}

/**
 * The writes a scene applies on its own spine — outside every fork, so they happen on every run that
 * enters the scene.
 *
 * A write under an *unregistered* arm (a `choiceOption` with no `choice` container above it, which
 * the compiler diagnoses) is deliberately not counted here: `sceneFlowModel` treats such a block as a
 * fork for jump attribution, and the two readings must place a row on the same side of "certain".
 *
 * Scenes with no spine writes are absent from the map; read `?? []`.
 */
export function collectSceneEffects(document: StoryDocument): Map<StorySceneId, SceneFlowVariableEffect[]> {
    const effectsByScene = new Map<StorySceneId, SceneFlowVariableEffect[]>();
    for (const [sceneId, writes] of documentIndex(document).writesByScene) {
        const effects = writes.filter(write => write.armChain.length === 0).map(write => effectOf(write, true));
        if (effects.length > 0) {
            effectsByScene.set(sceneId, effects);
        }
    }
    return effectsByScene;
}

/**
 * The net movement one arm applies to one variable — what the edge chip reads.
 *
 * `null` (the arm never touches this variable) and `{op:"unknown"}` (it touches it by an amount that
 * cannot be stated) are different answers and must stay different: the first is what dims a path out
 * of the divergence line, the second is what draws a `?` on it.
 *
 * Any uncertain effect collapses the whole answer to `unknown`. An option containing
 * `if 好感 >= 5 { 好感 += 2 }` moves the counter by 0 or by 2, and a chip cannot say "one of these";
 * the inner arm carries its own `+2` chip on its own row, so nothing is lost by admitting it here.
 */
export function branchDeltaFor(
    effects: SceneFlowVariableEffect[],
    variableKey: string,
): SceneFlowDelta | null {
    const mine = effects.filter(effect => effect.variableKey === variableKey);
    if (mine.length === 0) {
        return null;
    }
    let net: { op: "add"; amount: number } | { op: "set"; value: number } = { op: "add", amount: 0 };
    for (const effect of mine) {
        if (effect.delta.op === "unknown" || !effect.certain) {
            return { op: "unknown" };
        }
        if (effect.delta.op === "set") {
            // A later `set` overwrites whatever the arm accumulated before it, which is why this folds
            // in document order rather than summing the adds and reporting the last set.
            net = { op: "set", value: effect.delta.value };
        } else if (net.op === "set") {
            net = { op: "set", value: net.value + effect.delta.amount };
        } else {
            net = { op: "add", amount: net.amount + effect.delta.amount };
        }
    }
    return net;
}

/**
 * The numeric variables an author can focus the map on, `saved`/`persistent` first.
 *
 * Scope order is the picker's order for a reason: a `saved`/`persistent` counter is the thing a route
 * accumulates across scenes, and it is what "好感度分歧线" means. A `scene`-scoped variable is
 * re-seeded every time its scene is entered and does not exist outside it, so it belongs in the list
 * (an author may still want its writes labelled) but not at the top of it.
 *
 * A `persistent` row is addressed by its storage key — v9 made a persistent variable's `variableId`
 * equal to it, and `storyCommandContext` builds its refs the same way, so a key minted here matches
 * the key a `/set` row stores. Blueprint-declared persistent variables are not listed: they live in
 * the blueprint document, which this module never sees.
 */
export function listNumericStoryVariables(document: StoryDocument): SceneFlowNumericVariable[] {
    const variables: SceneFlowNumericVariable[] = [];
    const take = (
        scope: StoryVariableScope,
        variableId: string,
        def: { name: string; valueType: string; defaultValue?: unknown },
    ): void => {
        if (def.valueType !== "number") {
            return;
        }
        variables.push({
            // The three arms of `StoryVariableRef` differ only in the literal type of `scope`, so the
            // cast asserts nothing about the shape - it only tells TypeScript which arm this is.
            key: storyVariableRefKey({ scope, variableId } as StoryVariableRef),
            scope,
            variableId,
            name: def.name,
            defaultValue: numericLiteral(def.defaultValue),
        });
    };

    for (const def of Object.values(savedVariableDefs(document))) {
        take("saved", def.id, def);
    }
    for (const def of Object.values(storyPersistentDefs(document))) {
        take("persistent", def.storageKey, def);
    }
    for (const scene of listScenesInDocumentOrder(document)) {
        for (const def of Object.values(sceneVariableDefs(scene))) {
            take("scene", def.id, def);
        }
    }
    return variables;
}

function rangesEqual(left: SceneFlowRange | undefined, right: SceneFlowRange): boolean {
    if (!left) {
        return false;
    }
    if (left.kind === "unknown" || right.kind === "unknown") {
        return left.kind === right.kind;
    }
    return left.min === right.min && left.max === right.max;
}

/** Two ways into one scene widen the interval — the player could have arrived by either. */
function unionRange(left: SceneFlowRange, right: SceneFlowRange): SceneFlowRange {
    if (left.kind === "unknown" || right.kind === "unknown") {
        return UNKNOWN_RANGE;
    }
    return { kind: "known", min: Math.min(left.min, right.min), max: Math.max(left.max, right.max) };
}

/**
 * Push a range through a list of effects.
 *
 * `unknown` is absorbing: one unreadable write anywhere upstream makes every scene after it unknown,
 * and the walk does not resume counting from the next readable one. Resuming would report a precise
 * interval built on a value nobody knows.
 *
 * An uncertain effect happens on some runs and not others, so it widens to the union of both worlds
 * rather than being applied or dropped. Applying it would claim a deeper decision was already made;
 * dropping it would hide a value the player can reach.
 */
function applyEffects(
    range: SceneFlowRange,
    effects: readonly SceneFlowVariableEffect[],
    variableKey: string,
): SceneFlowRange {
    let current = range;
    for (const effect of effects) {
        if (effect.variableKey !== variableKey) {
            continue;
        }
        if (current.kind === "unknown" || effect.delta.op === "unknown") {
            return UNKNOWN_RANGE;
        }
        if (effect.delta.op === "add") {
            const amount = effect.delta.amount;
            current = effect.certain
                ? { kind: "known", min: current.min + amount, max: current.max + amount }
                : { kind: "known", min: current.min + Math.min(0, amount), max: current.max + Math.max(0, amount) };
        } else {
            const value = effect.delta.value;
            current = effect.certain
                ? { kind: "known", min: value, max: value }
                : { kind: "known", min: Math.min(current.min, value), max: Math.max(current.max, value) };
        }
    }
    return current;
}

/** One way of getting from one scene to another, and what it does to the variable on the way. */
type SceneFlowTraversal = {
    source: StorySceneId;
    target: StorySceneId;
    effects: SceneFlowVariableEffect[];
};

/**
 * Whether `shorter` is a tail of `longer` — the arm-chain test for "on the path to".
 *
 * Chains run nearest-first, so a shared tail means shared ancestry: `[B, A]` and `[A]` are the inner
 * arm and its owning option, `[C, A]` and `[B, A]` are two arms nobody takes together.
 */
function isChainSuffix(shorter: readonly StoryBlockId[], longer: readonly StoryBlockId[]): boolean {
    if (shorter.length > longer.length) {
        return false;
    }
    const offset = longer.length - shorter.length;
    return shorter.every((id, index) => longer[offset + index] === id);
}

/**
 * The effects that apply on the way out through one arm — its own subtree, **plus the spines of the
 * arms it is nested inside**.
 *
 * The addition matters. A jump belongs to its nearest fork, so `option 跟她走 { 好感 += 2; if x { jump } }`
 * hangs the edge off the inner `if` arm; taking only that arm's subtree would drop the option's own
 * `+2` from every range downstream, silently. An ancestor's spine write is certain here for the same
 * reason it is certain anywhere: reaching this arm means having passed through that arm.
 *
 * `collectBranchEffects` deliberately stays subtree-only — it answers "what does this arm do", which
 * is what the arm's own chip reports. This answers "what is the counter worth on arrival", which is a
 * different question about the same edge.
 */
function armTraversalEffects(
    document: StoryDocument,
    writesByScene: Map<StorySceneId, SceneFlowWrite[]>,
    branch: SceneFlowBranchNodeModel,
): SceneFlowVariableEffect[] {
    const scene = document.scenes[branch.sceneId];
    const armBlock = scene?.blocks[branch.blockId];
    // Nearest first, and the arm itself is nearest of all: `[inner if, outer option]`.
    const armChainWithSelf = armBlock
        ? [branch.blockId, ...readAncestry(scene, armBlock).armChain]
        : [branch.blockId];
    return traversalEffects(writesByScene.get(branch.sceneId) ?? [], armChainWithSelf);
}

function traversalEffects(
    writes: readonly SceneFlowWrite[],
    armChainWithSelf: readonly StoryBlockId[],
): SceneFlowVariableEffect[] {
    const effects: SceneFlowVariableEffect[] = [];
    for (const write of writes) {
        if (write.armChain.length === 0) {
            // Scene-spine writes are applied once per scene, before any arm, so they must not be
            // counted a second time here.
            continue;
        }
        if (isChainSuffix(write.armChain, armChainWithSelf)) {
            effects.push(effectOf(write, true));
        } else if (isChainSuffix(armChainWithSelf, write.armChain)) {
            effects.push(effectOf(write, false));
        }
    }
    return effects;
}

/**
 * The scenes that survive repeated removal of sources and sinks: every scene on a cycle, plus the
 * scenes strung between two of them.
 *
 * Over-approximating is fine and deliberate — a scene named here only earns an update *budget*, and a
 * scene that never loops never spends it. Under-approximating would let a loop iterate forever.
 */
function findCyclicScenes(sceneIds: readonly StorySceneId[], links: readonly SceneFlowTraversal[]): Set<StorySceneId> {
    const remaining = new Set(sceneIds);
    const inDegree = new Map<StorySceneId, number>(sceneIds.map(id => [id, 0]));
    const outDegree = new Map<StorySceneId, number>(sceneIds.map(id => [id, 0]));
    const outgoing = new Map<StorySceneId, StorySceneId[]>();
    const incoming = new Map<StorySceneId, StorySceneId[]>();
    const push = (map: Map<StorySceneId, StorySceneId[]>, key: StorySceneId, value: StorySceneId): void => {
        const list = map.get(key);
        if (list) {
            list.push(value);
        } else {
            map.set(key, [value]);
        }
    };
    for (const link of links) {
        if (!remaining.has(link.source) || !remaining.has(link.target)) {
            continue;
        }
        outDegree.set(link.source, (outDegree.get(link.source) ?? 0) + 1);
        inDegree.set(link.target, (inDegree.get(link.target) ?? 0) + 1);
        push(outgoing, link.source, link.target);
        push(incoming, link.target, link.source);
    }

    const queue = sceneIds.filter(id => (inDegree.get(id) ?? 0) === 0 || (outDegree.get(id) ?? 0) === 0);
    for (let cursor = 0; cursor < queue.length; cursor++) {
        const sceneId = queue[cursor];
        if (!remaining.has(sceneId)) {
            continue;
        }
        remaining.delete(sceneId);
        for (const next of outgoing.get(sceneId) ?? []) {
            if (!remaining.has(next)) {
                continue;
            }
            const degree = (inDegree.get(next) ?? 0) - 1;
            inDegree.set(next, degree);
            if (degree === 0) {
                queue.push(next);
            }
        }
        for (const previous of incoming.get(sceneId) ?? []) {
            if (!remaining.has(previous)) {
                continue;
            }
            const degree = (outDegree.get(previous) ?? 0) - 1;
            outDegree.set(previous, degree);
            if (degree === 0) {
                queue.push(previous);
            }
        }
    }
    return remaining;
}

/**
 * The range one variable can hold **on arrival** at each scene — before the scene's own writes, which
 * is what "by the time the player reaches this scene" means. A scene's own movement is
 * {@link collectSceneEffects}; an arm's is {@link branchDeltaFor}.
 *
 * Forward propagation from the entry scene, seeded with the declaration's default, merging every way
 * in. Three things make it honest rather than merely finite:
 *
 * - A missing default is **not** zero. The compiler seeds a saved variable to `null` and skips a
 *   scene-local with no default entirely, so a number the author never stated is a number nobody
 *   knows — `unknown`, not `0`.
 * - A cycle whose body moves the counter grows without bound. Cyclic scenes carry an update budget
 *   (enough for every distinct way in, plus one lap); a scene that keeps changing past it widens to
 *   `unknown`. That is the difference between reporting a bound and reporting the value after N laps
 *   while calling it the answer.
 * - A scene the entry cannot reach, and every scene when the document declares no entry, is
 *   `unknown` — the same distinction `findReachable` draws by returning `null`.
 *
 * Every scene of the graph appears in the result, so a caller never has to distinguish "no entry" from
 * "not computed".
 */
export function computeVariableRanges(
    graph: SceneFlowGraph,
    document: StoryDocument,
    variableKey: string,
): Map<StorySceneId, SceneFlowRange> {
    const sceneIds = graph.nodes.map(node => node.sceneId);
    const ranges = new Map<StorySceneId, SceneFlowRange>(sceneIds.map(id => [id, UNKNOWN_RANGE]));

    const declaration = documentIndex(document).numericVariables.find(variable => variable.key === variableKey);
    if (!declaration || declaration.defaultValue === null) {
        // Either the key names nothing numeric in this document (a deleted row, a blueprint-declared
        // persistent) or the row states no starting number. Both leave the walk with nothing to seed.
        return ranges;
    }
    const seed: SceneFlowRange = { kind: "known", min: declaration.defaultValue, max: declaration.defaultValue };

    if (declaration.scope === "scene") {
        // A scene-local is re-seeded on every entry to its scene and does not exist anywhere else, so
        // a cumulative range across the map would be a number for a variable that is not there. The
        // one scene that can answer is the declaring one, and its answer is always the default.
        const owner = findDeclarationBlock(document, declaration.variableId);
        if (owner && ranges.has(owner.sceneId)) {
            ranges.set(owner.sceneId, seed);
        }
        return ranges;
    }

    const entrySceneId = document.entrySceneId && document.scenes[document.entrySceneId]
        ? document.entrySceneId
        : undefined;
    if (!entrySceneId) {
        return ranges;
    }

    const { writesByScene } = documentIndex(document);
    const sceneEffects = collectSceneEffects(document);

    // One traversal per way of getting from a scene to a scene, because that is the granularity the
    // variable moves at: five options into one hallway are five different counters on arrival.
    const traversals: SceneFlowTraversal[] = [];
    const branchByNodeId = new Map(graph.branches.map(branch => [branch.id, branch]));
    const coveredJumps = new Map<string, Set<StoryBlockId>>();
    for (const branchEdge of graph.branchEdges) {
        const branch = branchByNodeId.get(branchEdge.sourceBranchId);
        if (!branch) {
            continue;
        }
        const key = `${branchEdge.sourceSceneId}->${branchEdge.target}`;
        const covered = coveredJumps.get(key) ?? new Set<StoryBlockId>();
        for (const jump of branchEdge.jumps) {
            covered.add(jump.blockId);
        }
        coveredJumps.set(key, covered);

        traversals.push({
            source: branchEdge.sourceSceneId,
            target: branchEdge.target,
            effects: armTraversalEffects(document, writesByScene, branch),
        });
    }
    for (const edge of graph.edges) {
        const covered = coveredJumps.get(`${edge.source}->${edge.target}`);
        // Jumps no arm claimed: an unconditional one on the scene's spine, or one under a fork the
        // model could not register. Both move the player with no arm effects to apply, and dropping
        // them would strand every scene behind them as unreachable.
        if (edge.jumps.some(jump => !covered?.has(jump.blockId))) {
            traversals.push({ source: edge.source, target: edge.target, effects: [] });
        }
    }

    const outgoing = new Map<StorySceneId, SceneFlowTraversal[]>();
    const inboundCount = new Map<StorySceneId, number>();
    for (const traversal of traversals) {
        const list = outgoing.get(traversal.source);
        if (list) {
            list.push(traversal);
        } else {
            outgoing.set(traversal.source, [traversal]);
        }
        inboundCount.set(traversal.target, (inboundCount.get(traversal.target) ?? 0) + 1);
    }

    const cyclic = findCyclicScenes(sceneIds, traversals);
    const updates = new Map<StorySceneId, number>();
    const arrival = new Map<StorySceneId, SceneFlowRange>([[entrySceneId, seed]]);
    const queue: StorySceneId[] = [entrySceneId];
    // Monotone widening plus a per-scene budget already bounds this walk; the cap is the guard for a
    // graph shape nobody predicted. It resolves to `?` everywhere rather than to a partial answer,
    // because if it ever trips we do not know which scenes had settled.
    const popLimit = 4096 + (sceneIds.length + traversals.length) * 16;

    for (let cursor = 0; cursor < queue.length; cursor++) {
        if (cursor > popLimit) {
            return new Map(sceneIds.map(id => [id, UNKNOWN_RANGE]));
        }
        const sceneId = queue[cursor];
        const current = arrival.get(sceneId) ?? UNKNOWN_RANGE;
        const afterScene = applyEffects(current, sceneEffects.get(sceneId) ?? [], variableKey);
        for (const traversal of outgoing.get(sceneId) ?? []) {
            const candidate = applyEffects(afterScene, traversal.effects, variableKey);
            const existing = arrival.get(traversal.target);
            const merged = existing ? unionRange(existing, candidate) : candidate;
            if (rangesEqual(existing, merged)) {
                continue;
            }
            const count = (updates.get(traversal.target) ?? 0) + 1;
            updates.set(traversal.target, count);
            // Enough updates for every distinct way in to land, plus one lap of the loop. A counter
            // that is still moving after that is moving because the loop moves it.
            const budget = cyclic.has(traversal.target) ? (inboundCount.get(traversal.target) ?? 0) + 1 : null;
            const next = budget !== null && count > budget ? UNKNOWN_RANGE : merged;
            if (rangesEqual(existing, next)) {
                continue;
            }
            arrival.set(traversal.target, next);
            queue.push(traversal.target);
        }
    }

    for (const [sceneId, range] of arrival) {
        if (ranges.has(sceneId)) {
            ranges.set(sceneId, range);
        }
    }
    return ranges;
}

/**
 * What the focused variable is worth when one enumerated route ends — the number the route rail
 * sorts by, and the payoff of the whole layer ("which choices give me the 好感 route").
 *
 * **Final, not on-arrival**: the ending scene's own spine writes are applied, because the rail labels
 * this the route's final value and a counter the last scene moves is part of what the player leaves
 * with. It therefore equals {@link computeVariableRanges}'s arrival range for that ending exactly
 * when the ending writes nothing of its own and one route reaches it — and it is folded from the
 * *same* effect source (`armTraversalEffects`: the arm's subtree plus the spines of the arms it is
 * nested inside), which is the point of it living here. The rail folding `collectBranchEffects`
 * instead was subtree-only, so a story with a fork nested inside an option had the route's value and
 * the ending's chip disagree — two readings of one number, which is the drift
 * `storyRuntimeDebugModel`'s header exists to warn about.
 *
 * Honesty rules, all absorbing — one `?` anywhere on the path is the whole answer:
 *
 * - No declared default is no answer. A number the author never stated is not zero.
 * - An unreadable write makes the route unreadable. The fold does not resume at the next legible one.
 * - **An uncertain write counts as unreadable.** Unlike a range, which widens to hold both worlds, a
 *   single final value cannot say "0 or 5", and picking one would be guessing at the deeper fork.
 * - An arm the graph does not know, or one that leaves a scene this route never visits, is a route
 *   this function cannot place in order — `unknown` rather than a value folded from what was left.
 *
 * Takes the two fields it uses rather than `SceneFlowRoute`, so this module never depends on
 * `sceneFlowRoutes.ts` (which already depends on this one's siblings).
 */
export function foldRouteVariableValue(
    graph: SceneFlowGraph,
    document: StoryDocument,
    variableKey: string,
    route: { sceneIds: readonly StorySceneId[]; branchIds: readonly string[] },
): SceneFlowRange {
    const { writesByScene, numericVariables } = documentIndex(document);
    const declaration = numericVariables.find(variable => variable.key === variableKey);
    if (!declaration || declaration.defaultValue === null) {
        return UNKNOWN_RANGE;
    }

    // Keyed by the scene the arm leaves. A route takes at most one arm per scene: `sceneIds` promises
    // no repeats, each step's arm is the one that owns that scene's exit, and the trailing arm a
    // route can end *on* belongs to the ending scene, which no step leaves.
    const branchByNodeId = new Map(graph.branches.map(branch => [branch.id, branch]));
    const armBySceneId = new Map<StorySceneId, SceneFlowBranchNodeModel>();
    for (const branchId of route.branchIds) {
        const branch = branchByNodeId.get(branchId);
        if (!branch) {
            return UNKNOWN_RANGE;
        }
        armBySceneId.set(branch.sceneId, branch);
    }

    const sceneEffects = collectSceneEffects(document);
    let value = declaration.defaultValue;
    let armsApplied = 0;
    const apply = (effects: readonly SceneFlowVariableEffect[]): boolean => {
        for (const effect of effects) {
            if (effect.variableKey !== variableKey) {
                continue;
            }
            if (effect.delta.op === "unknown" || !effect.certain) {
                return false;
            }
            value = effect.delta.op === "set" ? effect.delta.value : value + effect.delta.amount;
        }
        return true;
    };

    for (const sceneId of route.sceneIds) {
        // Scene spine first, then the arm taken out of it — the order `computeVariableRanges` applies
        // them in, and the order the author wrote them in.
        if (!apply(sceneEffects.get(sceneId) ?? [])) {
            return UNKNOWN_RANGE;
        }
        const arm = armBySceneId.get(sceneId);
        if (arm) {
            armsApplied += 1;
            if (!apply(armTraversalEffects(document, writesByScene, arm))) {
                return UNKNOWN_RANGE;
            }
        }
    }
    if (armsApplied !== armBySceneId.size) {
        // An arm on the route left a scene the route never lists. Nothing here can say where in the
        // sequence its writes belong, and folding the rest would report a number missing one.
        return UNKNOWN_RANGE;
    }
    return { kind: "known", min: value, max: value };
}
