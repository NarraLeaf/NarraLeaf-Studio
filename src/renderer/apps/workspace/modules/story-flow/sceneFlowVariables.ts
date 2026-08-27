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
 *
 * **Both approximations widen, and that direction is load-bearing.** A range too wide costs the map
 * precision; a range too *narrow* claims a value the player can reach is out of reach, which is the
 * one error a reader cannot recover from. Two writers this module cannot read used to escape the
 * rule by being invisible rather than unknown, and both narrowed the answer:
 *
 * - **A blueprint bound to a row can write a story variable** (`Set Saved Var` / `Set Scene Var` /
 *   `Set Persistent`), and only `setVariable` rows were counted. {@link collectBlueprintVariableWrites}
 *   reads which keys a graph may write, and a row that runs one now contributes an `unknown` write
 *   for each of them — attributed to the row's arm, so the poison spreads exactly as far as the row
 *   can run. A graph no row in this document names is `ambient`: a UI event handler fires whenever
 *   the player clicks, so its writes are unknown everywhere rather than at one row.
 * - **A returnable jump comes back.** The callee's writes land in the caller's continuation, and
 *   only the forward edge was walked, so everything the subroutine did was dropped. A calling scene
 *   now carries an `unknown` write, on the way out, for every key written anywhere the call can
 *   reach. Widening rather than applying the callee's real effects is the honest half-measure: the
 *   effects depend on where inside the callee the run returns from, which is a row-level question
 *   this module has never answered.
 */

import type { BlueprintDocument, BlueprintGraphNode } from "@shared/types/blueprint/document";
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
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
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

/**
 * The three blueprint nodes that write a story variable, and the field each names its target in.
 *
 * `blueprint.local.set` is deliberately absent: its `variableId` addresses a variable local to the
 * graph, which no story row can read and no range here is about. The other three are the whole set —
 * `node project/app/blueprint.js nodes set variable` lists them, and a fourth would have to be added
 * to the registry before it could be added here.
 */
const BLUEPRINT_WRITE_NODES: readonly { type: string; field: string; scope: StoryVariableScope }[] = [
    { type: "blueprint.saved.set", field: "savedVariableId", scope: "saved" },
    { type: "blueprint.scene.set", field: "sceneVariableId", scope: "scene" },
    { type: "blueprint.persistent.set", field: "persistentVariableId", scope: "persistent" },
];

/**
 * Which story variables a blueprint may write, addressed the way a story row reaches that blueprint.
 *
 * Two buckets because a blueprint's reach depends on who runs it. One bound to a row runs when that
 * row runs, so its writes belong to that row's scene and arm. One nobody's row names — a surface
 * event, a widget handler — runs when the player touches the interface, which is any time at all.
 */
export type SceneFlowBlueprintWrites = {
    /** Keys the graph of this blueprint id may write, for a blueprint a story row runs. */
    byBlueprintId: ReadonlyMap<string, ReadonlySet<string>>;
    /** Keys written from a graph no row in the document runs. Unknown everywhere, not at one row. */
    ambient: ReadonlySet<string>;
};

const NO_BLUEPRINT_WRITES: SceneFlowBlueprintWrites = {
    byBlueprintId: new Map(),
    ambient: new Set(),
};

/** Every graph node of a blueprint, across its events, functions and macros. */
function* eachNodeOfBlueprint(program: unknown): Generator<BlueprintGraphNode> {
    const graphs = (program as { kind?: string; graphs?: Record<string, Record<string, { graph?: { nodes?: Record<string, BlueprintGraphNode> } }>> });
    if (graphs?.kind !== "graph" || !graphs.graphs) {
        return;
    }
    for (const slot of ["events", "functions", "macros"]) {
        for (const carrier of Object.values(graphs.graphs[slot] ?? {})) {
            for (const node of Object.values(carrier?.graph?.nodes ?? {})) {
                if (node) {
                    yield node;
                }
            }
        }
    }
}

/**
 * The story-variable keys each blueprint may write.
 *
 * **A key is emitted under every identity it answers to.** A project-scoped declaration has an `id`
 * and a `storageKey`, equal unless an author changed one, and a node param may hold either; a ref
 * addresses `saved` by id and `persistent` by storage key. Emitting the alias as well as the stored
 * value costs a set entry and removes the one way this scan can miss a writer — and missing a writer
 * is the failure that narrows a range, which is the failure that matters.
 *
 * `registry` is optional so a test can call this with a document alone; omitting it only drops the
 * alias expansion, never the stored value.
 */
export function collectBlueprintVariableWrites(
    document: BlueprintDocument | null,
    registry: readonly VariableRegistryEntry[] = [],
): SceneFlowBlueprintWrites {
    if (!document) {
        return NO_BLUEPRINT_WRITES;
    }
    const byBlueprintId = new Map<string, Set<string>>();
    const ambient = new Set<string>();

    const keysFor = (scope: StoryVariableScope, stored: string): string[] => {
        const keys = [storyVariableRefKey({ scope, variableId: stored } as StoryVariableRef)];
        for (const entry of registry) {
            if (entry.scope !== scope || (entry.id !== stored && entry.storageKey !== stored)) {
                continue;
            }
            keys.push(storyVariableRefKey({
                scope,
                variableId: scope === "persistent" ? entry.storageKey : entry.id,
            } as StoryVariableRef));
        }
        return keys;
    };

    for (const blueprint of Object.values(document.blueprints ?? {})) {
        if (!blueprint) {
            continue;
        }
        const written = new Set<string>();
        for (const node of eachNodeOfBlueprint(blueprint.program)) {
            for (const writer of BLUEPRINT_WRITE_NODES) {
                if (node.type !== writer.type) {
                    continue;
                }
                const stored = node.params?.[writer.field];
                if (typeof stored === "string" && stored.trim()) {
                    for (const key of keysFor(writer.scope, stored.trim())) {
                        written.add(key);
                    }
                }
            }
        }
        if (written.size === 0) {
            continue;
        }
        // A story-action blueprint is reached through the row that owns it, so it is attributable.
        // Everything else runs on the interface's own schedule.
        if (blueprint.owner?.kind === "storyAction") {
            byBlueprintId.set(blueprint.id, written);
        } else {
            for (const key of written) {
                ambient.add(key);
            }
        }
    }
    return { byBlueprintId, ambient };
}

/** One write site, placed in the scene's fork structure. A `setVariable` row, or a row running a graph. */
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

function collectSceneWrites(scene: StoryScene, blueprintWrites: SceneFlowBlueprintWrites): SceneFlowWrite[] {
    const writes: SceneFlowWrite[] = [];
    // A disabled row is compiled out with its whole subtree (schema v7), so a write inside one never
    // runs. Counting it would move a counter the shipped game never moves — the one lie a author
    // greying a row out is explicitly trying to avoid.
    const blocks = listSceneBlocksInDocumentOrder(scene, { skipSubtree: candidate => candidate.disabled === true });
    for (const block of blocks) {
        if (block.kind !== "action") {
            continue;
        }
        if (block.payload.action === "blueprint") {
            // The graph is data this module can see but not evaluate: what it assigns can come off a
            // pin, a network read, a random. Which variables it touches is answerable, and that is
            // the whole of what is claimed here — one `unknown` per key, on this row's arm.
            const keys = blueprintWrites.byBlueprintId.get(block.payload.blueprintId);
            if (!keys || keys.size === 0) {
                continue;
            }
            const ancestry = readAncestry(scene, block);
            for (const variableKey of keys) {
                writes.push({ blockId: block.id, variableKey, delta: { op: "unknown" }, armChain: ancestry.armChain });
            }
            continue;
        }
        if (block.payload.action !== "setVariable") {
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

function collectWritesByScene(
    document: StoryDocument,
    blueprintWrites: SceneFlowBlueprintWrites,
): Map<StorySceneId, SceneFlowWrite[]> {
    const byScene = new Map<StorySceneId, SceneFlowWrite[]>();
    for (const scene of listScenesInDocumentOrder(document)) {
        byScene.set(scene.id, collectSceneWrites(scene, blueprintWrites));
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
const documentIndexCache = new WeakMap<StoryDocument, Map<SceneFlowBlueprintWrites, SceneFlowDocumentIndex>>();

/**
 * The blueprint writes are part of the cache key, not folded into the document's.
 *
 * A graph edit replaces the blueprint document while the story document object stays put, so a
 * single-keyed cache would answer a story's second question with writes read before the author
 * added the node. The inner map is bounded by the outer key's own lifetime: a story edit replaces
 * the document and takes every reading of it with it.
 */
function documentIndex(
    document: StoryDocument,
    blueprintWrites: SceneFlowBlueprintWrites,
): SceneFlowDocumentIndex {
    let byWrites = documentIndexCache.get(document);
    if (!byWrites) {
        byWrites = new Map();
        documentIndexCache.set(document, byWrites);
    }
    const cached = byWrites.get(blueprintWrites);
    if (cached) {
        return cached;
    }
    const index: SceneFlowDocumentIndex = {
        writesByScene: collectWritesByScene(document, blueprintWrites),
        numericVariables: listNumericStoryVariables(document),
    };
    byWrites.set(blueprintWrites, index);
    return index;
}

/**
 * The declaration a variable key names, document rows plus the project registry.
 *
 * The registry is NOT folded into {@link documentIndex}: that cache is keyed on document identity,
 * and the registry can change while the document object does not - a stale entry there would seed a
 * range from a default the author has already edited. The registry list is small (it is the whole
 * project's project-scoped variables) so scanning it per lookup costs nothing worth caching.
 */
function findNumericDeclaration(
    document: StoryDocument,
    variableKey: string,
    registry: readonly VariableRegistryEntry[],
): SceneFlowNumericVariable | undefined {
    return documentIndex(document, NO_BLUEPRINT_WRITES).numericVariables.find(variable => variable.key === variableKey)
        ?? registryNumericVariables(registry).find(variable => variable.key === variableKey);
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
    blueprintWrites: SceneFlowBlueprintWrites = NO_BLUEPRINT_WRITES,
): Map<string, SceneFlowVariableEffect[]> {
    const { writesByScene } = documentIndex(document, blueprintWrites);
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
export function collectSceneEffects(
    document: StoryDocument,
    blueprintWrites: SceneFlowBlueprintWrites = NO_BLUEPRINT_WRITES,
): Map<StorySceneId, SceneFlowVariableEffect[]> {
    const effectsByScene = new Map<StorySceneId, SceneFlowVariableEffect[]>();
    for (const [sceneId, writes] of documentIndex(document, blueprintWrites).writesByScene) {
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
 * the key a `/set` row stores.
 *
 * `registry` carries the project's own declarations, BOTH project scopes. Omitting it narrows the
 * list to the variables some story happens to declare as a row, which after the declaration
 * migration is close to none of them — a picker about counters with the counters missing.
 */
export function listNumericStoryVariables(
    document: StoryDocument,
    registry: readonly VariableRegistryEntry[] = [],
): SceneFlowNumericVariable[] {
    const variables: SceneFlowNumericVariable[] = [];
    const take = (
        scope: StoryVariableScope,
        variableId: string,
        def: { name: string; valueType: string; defaultValue?: unknown },
    ): void => {
        const projected = numericVariableOf(scope, variableId, def);
        if (projected) {
            variables.push(projected);
        }
    };

    // Registry entries first: after the declaration migration the registry is the ONLY place a saved
    // or persistent variable is declared. A `saved` entry is addressed by its id, which the migration
    // seeds from the row's block id, so a `/set` written before the registry existed still produces
    // the same `storyVariableRefKey` this list is matched on.
    variables.push(...registryNumericVariables(registry));
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

/** One declaration projected onto the map's row shape, or `undefined` when it is not a number. */
function numericVariableOf(
    scope: StoryVariableScope,
    variableId: string,
    def: { name: string; valueType: string; defaultValue?: unknown },
): SceneFlowNumericVariable | undefined {
    if (def.valueType !== "number") {
        return undefined;
    }
    return {
        // The three arms of `StoryVariableRef` differ only in the literal type of `scope`, so the
        // cast asserts nothing about the shape - it only tells TypeScript which arm this is.
        key: storyVariableRefKey({ scope, variableId } as StoryVariableRef),
        scope,
        variableId,
        name: def.name,
        defaultValue: numericLiteral(def.defaultValue),
    };
}

/**
 * The registry's numeric entries, in the order the registry hands them over (by name).
 *
 * Each entry is keyed by the identity ITS OWN scope addresses by - a `saved` ref carries the entry
 * id, a `persistent` one the storage key - which is what lets one list cover both project scopes
 * rather than the caller pre-splitting it and the two halves drifting.
 */
function registryNumericVariables(registry: readonly VariableRegistryEntry[]): SceneFlowNumericVariable[] {
    const variables: SceneFlowNumericVariable[] = [];
    for (const entry of registry) {
        const projected = numericVariableOf(
            entry.scope,
            entry.scope === "persistent" ? entry.storageKey : entry.id,
            entry,
        );
        if (projected) {
            variables.push(projected);
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

/**
 * What a scene's calls do to every counter, folded into effects applied on the way *out* of it.
 *
 * A returnable jump leaves for the callee and comes back, so everything the callee wrote is in force
 * for the rest of the run — and the forward edge alone never carries it back. The result is one
 * `unknown` per key written anywhere the call can reach.
 *
 * **Reachability from the callee, not the callee alone.** A subroutine that jumps onward before
 * returning wrote everything on that stretch too, and a set built from one scene would miss it.
 * Following ordinary edges out of the callee over-approximates — some of what it reaches is past the
 * return — and over-approximating is the direction that cannot hide a value.
 *
 * Applying the callee's real deltas instead would be a better answer and is not available here: which
 * of the callee's rows ran depends on where the return sits inside it, which is the in-scene position
 * this module does not model. A row-level walk is what answers that, and this is not one.
 *
 * **The call edge itself is exempt**, so arrival at the subroutine is still the value the caller had
 * when it left - which is the number an author reading the callee's box wants. The exemption is for
 * edges where EVERY jump comes back, matching `SceneFlowEdgeModel.returns`: an edge carrying a plain
 * jump as well can be walked after the call returned, and that reading has to absorb.
 */
type SceneFlowCallAbsorption = {
    bySceneId: Map<StorySceneId, SceneFlowVariableEffect[]>;
    /** `source->target` of every edge that is nothing but calls. */
    pureCallEdges: Set<string>;
};

function callAbsorbedEffects(
    graph: SceneFlowGraph,
    writesByScene: Map<StorySceneId, SceneFlowWrite[]>,
): SceneFlowCallAbsorption {
    const outgoing = new Map<StorySceneId, StorySceneId[]>();
    const callees = new Map<StorySceneId, StorySceneId[]>();
    const pureCallEdges = new Set<string>();
    for (const edge of graph.edges) {
        const onward = outgoing.get(edge.source);
        if (onward) {
            onward.push(edge.target);
        } else {
            outgoing.set(edge.source, [edge.target]);
        }
        if (!edge.jumps.some(jump => jump.returnable)) {
            continue;
        }
        if (edge.jumps.every(jump => jump.returnable)) {
            pureCallEdges.add(`${edge.source}->${edge.target}`);
        }
        // `some`, not `every`: an edge carrying one plain jump and one call is still a call, and the
        // caller still has to absorb what the call did.
        const called = callees.get(edge.source);
        if (called) {
            called.push(edge.target);
        } else {
            callees.set(edge.source, [edge.target]);
        }
    }
    if (callees.size === 0) {
        return { bySceneId: new Map(), pureCallEdges };
    }

    const absorbed = new Map<StorySceneId, SceneFlowVariableEffect[]>();
    for (const [callerSceneId, entryPoints] of callees) {
        const keys = new Set<string>();
        const seen = new Set<StorySceneId>();
        const frontier = [...entryPoints];
        for (let cursor = 0; cursor < frontier.length; cursor++) {
            const sceneId = frontier[cursor];
            if (seen.has(sceneId)) {
                continue;
            }
            seen.add(sceneId);
            for (const write of writesByScene.get(sceneId) ?? []) {
                keys.add(write.variableKey);
            }
            frontier.push(...(outgoing.get(sceneId) ?? []));
        }
        if (keys.size > 0) {
            absorbed.set(callerSceneId, Array.from(keys, variableKey => ({
                variableKey,
                delta: { op: "unknown" } as const,
                certain: true,
            })));
        }
    }
    return { bySceneId: absorbed, pureCallEdges };
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
    registry: readonly VariableRegistryEntry[] = [],
    blueprintWrites: SceneFlowBlueprintWrites = NO_BLUEPRINT_WRITES,
): Map<StorySceneId, SceneFlowRange> {
    const sceneIds = graph.nodes.map(node => node.sceneId);
    const ranges = new Map<StorySceneId, SceneFlowRange>(sceneIds.map(id => [id, UNKNOWN_RANGE]));

    if (blueprintWrites.ambient.has(variableKey)) {
        // Something outside the story writes this one on the player's schedule. Every arrival value
        // would be a number contradicted by the next button press.
        return ranges;
    }

    const declaration = findNumericDeclaration(document, variableKey, registry);
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

    const { writesByScene } = documentIndex(document, blueprintWrites);
    const sceneEffects = collectSceneEffects(document, blueprintWrites);
    const callAbsorbed = callAbsorbedEffects(graph, writesByScene);

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
            effects: [
                ...(callAbsorbed.pureCallEdges.has(`${branchEdge.sourceSceneId}->${branchEdge.target}`)
                    ? []
                    : callAbsorbed.bySceneId.get(branchEdge.sourceSceneId) ?? []),
                ...armTraversalEffects(document, writesByScene, branch),
            ],
        });
    }
    for (const edge of graph.edges) {
        const covered = coveredJumps.get(`${edge.source}->${edge.target}`);
        // Jumps no arm claimed: an unconditional one on the scene's spine, or one under a fork the
        // model could not register. Both move the player with no arm effects to apply, and dropping
        // them would strand every scene behind them as unreachable.
        if (edge.jumps.some(jump => !covered?.has(jump.blockId))) {
            traversals.push({
                source: edge.source,
                target: edge.target,
                effects: callAbsorbed.pureCallEdges.has(`${edge.source}->${edge.target}`)
                    ? []
                    : [...(callAbsorbed.bySceneId.get(edge.source) ?? [])],
            });
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
 * The effects that apply on the way out through each arm, keyed by branch node id.
 *
 * The **arrival** reading, which is not what `collectBranchEffects` answers: that one is subtree-only
 * because an arm's own chip is about what that arm does, while this is the arm's subtree plus the
 * spines of every arm it is nested inside - what the counter is worth having come out this way. The
 * two must stay different and must stay derived from one place, which is why this exposes the walk
 * {@link computeVariableRanges} already runs rather than letting a caller rebuild it.
 */
export function collectArmArrivalEffects(
    graph: SceneFlowGraph,
    document: StoryDocument,
    blueprintWrites: SceneFlowBlueprintWrites = NO_BLUEPRINT_WRITES,
): Map<string, SceneFlowVariableEffect[]> {
    const { writesByScene } = documentIndex(document, blueprintWrites);
    return new Map(graph.branches.map(branch => [
        branch.id,
        armTraversalEffects(document, writesByScene, branch),
    ]));
}

/** Push a range through a list of effects. See the private walk this exposes for the absorbing rules. */
export function applyVariableEffects(
    range: SceneFlowRange,
    effects: readonly SceneFlowVariableEffect[],
    variableKey: string,
): SceneFlowRange {
    return applyEffects(range, effects, variableKey);
}

/** Two ways to one point widen the interval - the join a fixpoint over the graph merges states with. */
export function unionVariableRanges(left: SceneFlowRange, right: SceneFlowRange): SceneFlowRange {
    return unionRange(left, right);
}

/** Whether two ranges are the same claim, `unknown` included - the fixpoint's stop condition. */
export function variableRangesEqual(left: SceneFlowRange, right: SceneFlowRange): boolean {
    return rangesEqual(left, right);
}

/**
 * The scene-spine and arm writes of one scene, all of them, as uncertain effects.
 *
 * What a guard written inside the scene has to be judged against: the rows above it have run and the
 * rows below it have not, and which is which is the in-scene position this module does not model.
 * Every write as "may have happened" is the bound that holds both readings.
 */
export function sceneWritesAsUncertain(
    document: StoryDocument,
    sceneId: StorySceneId,
    blueprintWrites: SceneFlowBlueprintWrites = NO_BLUEPRINT_WRITES,
): SceneFlowVariableEffect[] {
    const writes = documentIndex(document, blueprintWrites).writesByScene.get(sceneId) ?? [];
    return writes.map(write => effectOf(write, false));
}

/**
 * The widest value a variable can hold at *any* row of one scene.
 *
 * {@link computeVariableRanges} answers "on arrival", which is the number an author reading a scene
 * box wants and the wrong number for a guard written halfway down the scene: the rows above it have
 * already run. In-scene position is not modelled here (see the header), so the honest bound is the
 * arrival value widened by every write the scene contains as though each one may or may not have
 * happened — which is exactly what an uncertain effect means, and exactly what `applyEffects`
 * already computes for one.
 *
 * Arms included, not only the spine. A guard inside one option is reached having taken that option,
 * and which arm's writes ran before it is a question about the arm the guard is in — a distinction
 * with a row-level answer and no scene-level one. Folding all of them in widens; dropping them would
 * narrow, and narrowing is what claims a reachable value is out of reach.
 */
export function widenRangeAcrossScene(
    arrival: SceneFlowRange,
    document: StoryDocument,
    sceneId: StorySceneId,
    variableKey: string,
    blueprintWrites: SceneFlowBlueprintWrites = NO_BLUEPRINT_WRITES,
): SceneFlowRange {
    const writes = documentIndex(document, blueprintWrites).writesByScene.get(sceneId) ?? [];
    return applyEffects(arrival, writes.map(write => effectOf(write, false)), variableKey);
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
    registry: readonly VariableRegistryEntry[] = [],
    blueprintWrites: SceneFlowBlueprintWrites = NO_BLUEPRINT_WRITES,
): SceneFlowRange {
    const { writesByScene } = documentIndex(document, blueprintWrites);
    const declaration = findNumericDeclaration(document, variableKey, registry);
    if (!declaration || declaration.defaultValue === null || blueprintWrites.ambient.has(variableKey)) {
        return UNKNOWN_RANGE;
    }
    const callAbsorbed = callAbsorbedEffects(graph, writesByScene);

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

    const sceneEffects = collectSceneEffects(document, blueprintWrites);
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
        // A route lists the scenes it passes in order, so the scene after a caller is where the
        // call's work is already done. The callee, when a route enters one, is reached by the exempt
        // edge and so is not absorbed here either.
        const next = route.sceneIds[route.sceneIds.indexOf(sceneId) + 1];
        const entersCallee = next !== undefined && callAbsorbed.pureCallEdges.has(`${sceneId}->${next}`);
        if (!entersCallee && !apply(callAbsorbed.bySceneId.get(sceneId) ?? [])) {
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
