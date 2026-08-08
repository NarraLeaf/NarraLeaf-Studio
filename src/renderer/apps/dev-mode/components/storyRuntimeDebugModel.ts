/**
 * Pure projections for the Dev Mode story-runtime panel (variables / execution context / timeline).
 *
 * React- and engine-free so the row projection, the action↔block reverse lookup, the declared variable
 * listing and the execution context stay unit-testable.
 *
 * The block summary is NOT re-derived here any more. It used to be — the M5 card authorised a
 * deliberately minimal re-projection because the editor's `describeBlock` was coupled to the workspace
 * `Character` service — and the two readings drifted exactly where it mattered (`Enter Nattou` against
 * `character enter · character`). That authorisation is withdrawn: the sentence now comes from
 * `@/lib/story/storyRowProjection`, the one projection both surfaces read (U4 WI-1).
 */

import type { StoryRowLookups } from "@/lib/story/storyRowProjection";
import {
    getStoryContainerHeaderInfo,
    projectStoryRow,
    storyContainerChain,
} from "@/lib/story/storyRowProjection";
import type {
    SceneFlowDelta,
    SceneFlowRange,
} from "@/apps/workspace/modules/story-flow/sceneFlowVariables";
import type {
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryLiteralValue,
    StoryScene,
    StorySceneId,
    StoryVariableValueType,
} from "@shared/types/story";
import { sceneVariableDefs, savedVariableDefs, storyPersistentDefs } from "@shared/types/story";
import type { VariableRegistryEntry } from "@shared/types/variables/registry";
import { buildMergedPersistentView } from "@shared/variables/mergedPersistentView";

/** The action↔block fields the reverse lookups need (a structural subset of NlrActionIdBinding). */
export type ActionIdBindingLike = { staticId: string; blockId: string };

/** Editor-facing variable scopes: scene = Local, saved = Var, persistent = Persis. */
export type StoryRuntimeVariableScope = "scene" | "saved" | "persistent";

export type StoryTimelineRow = {
    blockId: StoryBlockId;
    /** 1-based, mirroring the editor's visible row numbering (a flat DFS of the block tree). */
    lineNumber: number;
    depth: number;
    kind: StoryBlock["kind"];
    disabled: boolean;
    /** The row's sentence, word for word what the editor shows on that line. */
    summary: string;
    /** The dialogue speaker's name, or `null` on a row that has none. */
    speaker: string | null;
    /**
     * The speaker's accent colour, or `null` when the character has none — or when the lookup that
     * supplied it judged it unreadable. Kept beside the name rather than folded into it for the same
     * reason `speaker` is: the panel decides how to draw an attribution, the projection only says
     * whose line it is.
     */
    speakerColor: string | null;
    /**
     * The category hue the editor bars this row with, or `null` for the prose rows that carry none.
     * Same single source as the editor's bar, so a row is one colour in both places.
     */
    barColor: string | null;
};

export type DeclaredStoryVariable = {
    scope: StoryRuntimeVariableScope;
    /** Stable per-scope id: scene/saved use the declaration block id; persistent uses the storageKey. */
    id: string;
    name: string;
    valueType: StoryVariableValueType;
    defaultValue?: StoryLiteralValue;
    /** Runtime storage key inside the scope's namespace / host store. */
    storageKey: string;
};

/**
 * Flatten a scene's block tree into ordered rows (DFS over `rootBlockIds` → `childrenIds`), matching
 * the editor's visible-row numbering. The visited guard keeps a corrupted `childrenIds` cycle from
 * hanging the panel.
 */
export function projectSceneTimeline(scene: StoryScene, lookups: StoryRowLookups): StoryTimelineRow[] {
    const rows: StoryTimelineRow[] = [];
    const seen = new Set<StoryBlockId>();
    const walk = (blockId: StoryBlockId, depth: number): void => {
        if (seen.has(blockId)) {
            return;
        }
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        seen.add(blockId);
        // Read-only surface: an empty text row prints nothing, not the editor's double-click prompt.
        const projected = projectStoryRow(block, lookups, { editingPlaceholders: false });
        rows.push({
            blockId,
            lineNumber: rows.length + 1,
            depth,
            kind: block.kind,
            disabled: block.disabled === true,
            summary: projected.sentence,
            speaker: projected.speaker?.name || null,
            speakerColor: projected.speaker?.color ?? null,
            barColor: projected.barColor,
        });
        for (const childId of block.childrenIds) {
            walk(childId, depth + 1);
        }
    };
    for (const rootId of scene.rootBlockIds) {
        walk(rootId, 0);
    }
    return rows;
}

/** Reverse-map an engine action id (`event:action.current`) to its Studio block. */
export function blockIdForActionId(
    bindings: readonly ActionIdBindingLike[],
    actionId: string | null,
): StoryBlockId | null {
    if (!actionId) {
        return null;
    }
    for (const binding of bindings) {
        if (binding.staticId === actionId) {
            return binding.blockId;
        }
    }
    return null;
}

/**
 * Which scene owns a block — the whole of "which scene is running".
 *
 * A launch compiles EVERY scene of the story, so the play head is free to leave the one the run
 * started in (a `/goto`, a jump, a timeline restore into another scene). The answer therefore comes
 * from looking the block up, never from remembering the entry scene; `fallbackSceneId` covers the
 * two states with no block to look up — before the first action has run, and an engine action that
 * belongs to no Studio row.
 *
 * One function because this loop had been copy-pasted five times across three components, and a
 * panel that resolved it differently from its neighbour would show two scenes for one play head.
 */
export function resolveSceneIdForBlock(
    document: StoryDocument,
    blockId: StoryBlockId | null,
    fallbackSceneId: StorySceneId,
): StorySceneId {
    if (blockId) {
        for (const [id, scene] of Object.entries(document.scenes)) {
            if (blockId in scene.blocks) {
                return id;
            }
        }
    }
    return fallbackSceneId;
}

// --- Execution context ----------------------------------------------------------------------------

/**
 * The engine's stack snapshot, duck-typed down to the two things this panel reads.
 *
 * Structural on purpose: `StackFrameSnapshot` is marked experimental upstream and its exact shape is
 * explicitly not a contract, so binding to the fields we use keeps a shape change a compile error in
 * one place instead of a silently empty panel — and lets the projection be unit-tested with plain
 * objects, no engine.
 */
export type StackFrameLike = {
    actionId: string | null;
    /**
     * Present on a concurrent group (`Control.all` / `any`): one whole snapshot per branch.
     *
     * It was `StackFrameLike[][]` — only each branch's frames — because that is what the engine
     * handed over before 0.19.1, and it is why a `/repeat`'s round was unreachable: a repeat runs
     * its body in a nested stack, whose `loop` lived on the snapshot object that got reduced to
     * `.frames` here.
     */
    branches?: StackLike[];
};

export type StackLike = {
    frames: readonly StackFrameLike[];
    loop?: { counter: number; limit?: number };
};

export type StackViewLike = {
    root: StackLike;
    async: readonly StackLike[];
};

/** One rung of the container chain, in the editor's words. */
export type ExecutionContextRung = {
    blockId: StoryBlockId;
    /** `Menu` / `Option` / `Repeat` / `Parallel` / `If` … — never an engine enum. */
    pill: string;
    /** How many rounds this repeat is authored to run (from the document). */
    times?: number;
    /** The round it is ON — 1-based, `2/3`. Present when the engine reports a loop for it. */
    round?: { current: number; limit?: number };
};

export type ExecutionContextBranch = {
    /** 1-based, as the panel numbers them. */
    index: number;
    /** What that branch is doing, as a sentence; `null` when it holds nothing readable. */
    sentence: string | null;
    /** The branch the play head is inside. */
    current: boolean;
};

export type ExecutionContextView = {
    /** The scene that is running, by name. */
    sceneName: string;
    /** Outermost container first; empty at the root of a scene. */
    chain: ExecutionContextRung[];
    /** The branches of the innermost concurrent container the play head is inside. */
    branches: ExecutionContextBranch[];
    /** A loop the engine reports that no container in the chain claims. */
    orphanRound: { current: number; limit?: number } | null;
};

/**
 * The loop the engine is reporting, if any — root first, then the async stacks, then *inside* the
 * branches of either.
 *
 * The descent is the whole point. A `/repeat` runs its body in a nested StackModel that reaches this
 * panel only as a parent frame's `branches` entry, so the root stack is `$root` and never the loop:
 * until engine 0.19.1 `branches` carried bare frame lists and the nested `loop` was dropped on the
 * way out, which is why a repeat rung could show the round count it was *authored* for and never the
 * one it was *on*. Now that a branch arrives whole, the counter is one recursive lookup away.
 */
function findReportedLoop(stack: StackViewLike | null): StackLike["loop"] | null {
    if (!stack) {
        return null;
    }
    for (const entry of [stack.root, ...stack.async]) {
        const found = findLoopInStack(entry);
        if (found) {
            return found;
        }
    }
    return null;
}

/** A stack's own loop, else the first loop any of its branches (or their branches) reports. */
function findLoopInStack(stack: StackLike): StackLike["loop"] | null {
    if (stack.loop) {
        return stack.loop;
    }
    for (const frame of stack.frames) {
        for (const branch of frame.branches ?? []) {
            const nested = findLoopInStack(branch);
            if (nested) {
                return nested;
            }
        }
    }
    return null;
}

/** The concurrent container (`parallel` / `race`) nearest the play head, or null. */
function innermostConcurrentBlock(scene: StoryScene, chain: readonly ExecutionContextRung[]): StoryBlock | null {
    for (let index = chain.length - 1; index >= 0; index -= 1) {
        const block = scene.blocks[chain[index].blockId];
        if (block?.kind === "control" && (block.payload.control === "parallel" || block.payload.control === "race")) {
            return block;
        }
    }
    return null;
}

/**
 * The first row a branch actually says something with: containers are walked through, because
 * "In order" is the shape of a branch, not what it is doing.
 */
function firstSpokenRow(scene: StoryScene, blockId: StoryBlockId, seen = new Set<StoryBlockId>()): StoryBlockId | null {
    if (seen.has(blockId)) {
        return null;
    }
    seen.add(blockId);
    const block = scene.blocks[blockId];
    if (!block) {
        return null;
    }
    if (!getStoryContainerHeaderInfo(block)) {
        return blockId;
    }
    for (const childId of block.childrenIds) {
        const found = firstSpokenRow(scene, childId, seen);
        if (found) {
            return found;
        }
    }
    return blockId;
}

/** Whether `blockId` is inside `ancestorId` (or is it). */
function isWithin(scene: StoryScene, blockId: StoryBlockId | null, ancestorId: StoryBlockId): boolean {
    const seen = new Set<StoryBlockId>();
    let id = blockId;
    while (id && !seen.has(id)) {
        if (id === ancestorId) {
            return true;
        }
        seen.add(id);
        id = scene.blocks[id]?.parentId ?? null;
    }
    return false;
}

/**
 * Where execution is, in the author's terms: which scene, which containers it is nested in, which
 * round a repeat runs, and who is running inside a parallel.
 *
 * Answered from the *document* wherever the document knows — "where am I" is a fact about the story
 * the author wrote, so it holds for every row and never has to be reconciled with an engine enum. The
 * engine is consulted for the two things only it can know, and it currently answers neither: a
 * repeat's live round is dropped by `snapshot()` (see {@link findReportedLoop}), and a concurrent
 * branch's frame list is empty whenever the branch is waiting on the player — which is every moment
 * anyone is looking at this panel. So the branches are listed from the container's own children, with
 * the one holding the play head marked, and the engine's answer preferred when it has one.
 */
export function projectExecutionContext(input: {
    scene: StoryScene | undefined;
    sceneName: string;
    currentBlockId: StoryBlockId | null;
    stack: StackViewLike | null;
    bindings: readonly ActionIdBindingLike[];
    /** The sentence of a Studio row — supplied by the caller, which holds the lookups. */
    rowSentence: (blockId: StoryBlockId) => string | null;
}): ExecutionContextView {
    const { scene, sceneName, currentBlockId, stack, bindings, rowSentence } = input;
    const chain: ExecutionContextRung[] = scene && currentBlockId
        ? storyContainerChain(scene, currentBlockId).map(rung => ({
            blockId: rung.blockId,
            pill: rung.info.pill,
            ...(rung.info.repeatTimes !== undefined ? { times: rung.info.repeatTimes } : {}),
        }))
        : [];

    const loop = findReportedLoop(stack);
    let orphanRound: ExecutionContextView["orphanRound"] = null;
    if (loop) {
        // `counter` counts COMPLETED iterations, so the round the author is watching is counter + 1 —
        // clamped, because the counter reaches the limit in the instant before the loop drains.
        const current = loop.limit != null ? Math.min(loop.counter + 1, loop.limit) : loop.counter + 1;
        const round = { current, ...(loop.limit != null ? { limit: loop.limit } : {}) };
        const repeatIndex = findLastIndex(chain, rung => rung.times !== undefined);
        if (repeatIndex >= 0) {
            chain[repeatIndex] = { ...chain[repeatIndex], round };
        } else {
            orphanRound = round;
        }
    }

    const concurrent = scene ? innermostConcurrentBlock(scene, chain) : null;
    const reported = stack ? findBranchingFrame(stack.root.frames)?.branches ?? null : null;
    const branches: ExecutionContextBranch[] = concurrent && scene
        ? concurrent.childrenIds.map((childId, index) => {
            const fromEngine = blockIdForActionId(bindings, reported?.[index]?.frames?.[0]?.actionId ?? null);
            const target = fromEngine ?? firstSpokenRow(scene, childId);
            return {
                index: index + 1,
                sentence: target ? rowSentence(target) : null,
                current: isWithin(scene, currentBlockId, childId),
            };
        })
        : [];

    return { sceneName, chain, branches, orphanRound };
}

/** The first frame carrying a concurrent group, searching top-first (innermost first). */
function findBranchingFrame(frames: readonly StackFrameLike[]): StackFrameLike | null {
    for (const frame of frames) {
        if (frame.branches && frame.branches.length > 0) {
            return frame;
        }
    }
    for (const frame of frames) {
        for (const branch of frame.branches ?? []) {
            const nested = findBranchingFrame(branch.frames);
            if (nested) {
                return nested;
            }
        }
    }
    return null;
}

/** `Array.prototype.findLastIndex` without depending on the lib target. */
function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
    for (let index = items.length - 1; index >= 0; index -= 1) {
        if (predicate(items[index])) {
            return index;
        }
    }
    return -1;
}

/**
 * The declared variables of the running story, split by scope: scene variables of the entry scene,
 * plus the project-level saved and persistent ones. Live values are merged in by the panel from the
 * runtime store.
 *
 * The two registries are arguments rather than document reads because a saved or persistent variable
 * no longer has to have a row in any story: the project registry is a declaration site of its own,
 * and after the declaration migration it is the ONLY one. Left out, every registry-declared variable
 * is missing from the debug list - the panel shows a shorter list than the running game actually has,
 * which reads as "the engine lost my variable".
 */
export function listDeclaredStoryVariables(
    document: StoryDocument,
    sceneId: StorySceneId,
    savedRegistry: readonly VariableRegistryEntry[] = [],
    persistentRegistry: readonly VariableRegistryEntry[] = [],
): DeclaredStoryVariable[] {
    const variables: DeclaredStoryVariable[] = [];
    const scene = document.scenes[sceneId];
    if (scene) {
        for (const def of Object.values(sceneVariableDefs(scene))) {
            variables.push({
                scope: "scene",
                id: def.id,
                name: def.name,
                valueType: def.valueType,
                defaultValue: def.defaultValue,
                storageKey: def.storageKey,
            });
        }
    }
    for (const entry of savedRegistry) {
        variables.push({
            scope: "saved",
            id: entry.id,
            name: entry.name,
            valueType: entry.valueType,
            defaultValue: entry.defaultValue,
            storageKey: entry.storageKey,
        });
    }
    for (const def of Object.values(savedVariableDefs(document))) {
        variables.push({
            scope: "saved",
            id: def.id,
            name: def.name,
            valueType: def.valueType,
            defaultValue: def.defaultValue,
            storageKey: def.storageKey,
        });
    }
    // The merged view, not the document's own `/persis` rows: the two surfaces are one scope, and
    // reading either alone shows the author half of what the game is holding.
    for (const entry of buildMergedPersistentView(
        persistentRegistry,
        Object.values(storyPersistentDefs(document)),
    ).entries) {
        variables.push({
            // v9: a persistent ref addresses by storage key, so that is this row's id too.
            scope: "persistent",
            id: entry.storageKey,
            name: entry.name,
            valueType: entry.valueType,
            defaultValue: entry.defaultValue,
            storageKey: entry.storageKey,
        });
    }
    return variables;
}

// --- The run's own trail ----------------------------------------------------------------------

/**
 * Where every block lives, and which blocks can carry the play head out of their scene.
 *
 * Built once per document because both questions are asked inside the play-head subscription, which
 * fires at engine frequency: a scan of every scene per action is the one place this panel could cost
 * the running game something.
 */
export type StorySceneBlockIndex = {
    sceneIdByBlockId: Map<StoryBlockId, StorySceneId>;
    /**
     * `jump` blocks — the only witness this panel gets of WHICH arm a run took.
     *
     * A choice compiles to a single action bound to the `choice` container and a condition to one
     * bound to the group, so neither the option the player picked nor the branch that held has an
     * action id of its own. The jump inside the arm does, and the scene map already attributes that
     * jump to its arm (`SceneFlowBranchEdgeModel.jumps`), so observing the jump is observing the arm
     * — with the model's attribution rather than a second one.
     */
    jumpBlockIds: Set<StoryBlockId>;
};

export function buildStorySceneBlockIndex(document: StoryDocument): StorySceneBlockIndex {
    const sceneIdByBlockId = new Map<StoryBlockId, StorySceneId>();
    const jumpBlockIds = new Set<StoryBlockId>();
    for (const [sceneId, scene] of Object.entries(document.scenes)) {
        for (const block of Object.values(scene.blocks)) {
            sceneIdByBlockId.set(block.id, sceneId);
            if (block.kind === "jump") {
                jumpBlockIds.add(block.id);
            }
        }
    }
    return { sceneIdByBlockId, jumpBlockIds };
}

/** One scene the run entered, and how it got in. */
export type StoryTrailStep = {
    sceneId: StorySceneId;
    /**
     * The jump block the play head passed through on the way in. `null` for the scene the run
     * started in, and for a scene entered while nobody was watching — which is a real state, not a
     * defect, and the projection answers it by falling back to the scene pair.
     */
    viaJumpBlockId: StoryBlockId | null;
};

/**
 * The scenes this run has been through, in order.
 *
 * Accumulated rather than read, because there is nothing to read. The engine keeps a backlog and the
 * bridge exposes it as `getPlayedBlockTokens`, but that is a *map* keyed by block with no ordering
 * contract, it only holds lines that earned a restore snapshot (no jump ever does), and a timeline
 * restore trims it. None of the three can be worked around from outside the bridge, so the trail is
 * folded out of the play-head stream instead — see {@link advanceStoryRunTrail}.
 */
export type StoryRunTrail = {
    steps: StoryTrailStep[];
    /**
     * A jump the head has passed that has not landed yet. Deliberately not a step: a jump that fires
     * and a scene that is entered are two events, and crediting the arm before the second one
     * arrives would draw a path the run has not taken.
     */
    pendingJumpBlockId: StoryBlockId | null;
};

/** A fresh trail for a run that starts in `sceneId` (`null` before the story context is known). */
export function seedStoryRunTrail(sceneId: StorySceneId | null): StoryRunTrail {
    return {
        steps: sceneId ? [{ sceneId, viaJumpBlockId: null }] : [],
        pendingJumpBlockId: null,
    };
}

/** One play-head observation, already resolved from an action id to a Studio block. */
export type StoryTrailObservation = {
    sceneId: StorySceneId | null;
    blockId: StoryBlockId | null;
    isJump: boolean;
};

/**
 * Fold one observation into the trail, returning the SAME object when nothing moved.
 *
 * Identity is the contract the caller leans on: the subscription runs for every action and most
 * actions change nothing, so an unchanged trail must not schedule a render.
 *
 * Only a change of scene makes a step. Rows inside a scene are the timeline tab's business, and a
 * trail that recorded them would be a transcript, not a path.
 */
export function advanceStoryRunTrail(trail: StoryRunTrail, observation: StoryTrailObservation): StoryRunTrail {
    const { sceneId, blockId, isJump } = observation;
    if (!blockId || !sceneId) {
        // An action that belongs to no Studio block — the engine's own tail actions, a compiled-in
        // transition. It says nothing about where the story is, so it leaves the trail alone.
        return trail;
    }
    let steps = trail.steps;
    let pending = trail.pendingJumpBlockId;
    const last = steps[steps.length - 1];
    if (!last || last.sceneId !== sceneId) {
        steps = [...steps, { sceneId, viaJumpBlockId: pending }];
        pending = null;
    }
    if (isJump) {
        pending = blockId;
    }
    return steps === trail.steps && pending === trail.pendingJumpBlockId
        ? trail
        : { steps, pendingJumpBlockId: pending };
}

/**
 * What the trail projection reads off the scene map, duck-typed.
 *
 * Structural for the same reason `StackViewLike` is: the projection is then testable with plain
 * objects, and this file stays a pure model rather than a second consumer of the workspace canvas.
 */
export type StoryTrailGraphLike = {
    edges: readonly {
        id: string;
        source: StorySceneId;
        target: StorySceneId;
        jumps: readonly { blockId: StoryBlockId }[];
    }[];
    branchEdges: readonly {
        id: string;
        sourceBranchId: string;
        sourceSceneId: StorySceneId;
        target: StorySceneId;
        jumps: readonly { blockId: StoryBlockId }[];
    }[];
};

/** `SceneFlowCanvas`'s emphasis mask, built from where the run has been. */
export type StoryTrailHighlight = {
    sceneIds: Set<StorySceneId>;
    edgeIds: Set<string>;
};

/**
 * The scenes and lines this run has actually used.
 *
 * The jump the head was seen passing through decides the arm — but only when it is a jump the map
 * agrees leads from this scene to that one. A witness that does not match the pair is discarded
 * rather than trusted, so a jump left pending by a self-loop can never light a line the run did not
 * take.
 *
 * With no usable witness the scene edge still lights: `SceneFlowEdgeModel` is keyed by scene pair, so
 * there is exactly one line between two scenes and no guess is involved in lighting it. The *arm* is
 * another matter — five options into one hallway are five arms and one line — so an arm lights only
 * when the pair leaves no choice about which one it was. Guessing there would tell the author their
 * player picked an option they did not.
 */
export function projectStoryTrailHighlight(
    trail: StoryRunTrail,
    graph: StoryTrailGraphLike,
): StoryTrailHighlight {
    const sceneIds = new Set<StorySceneId>();
    const edgeIds = new Set<string>();
    for (const step of trail.steps) {
        sceneIds.add(step.sceneId);
    }
    for (let index = 1; index < trail.steps.length; index++) {
        const from = trail.steps[index - 1].sceneId;
        const step = trail.steps[index];
        const sceneEdge = graph.edges.find(edge => edge.source === from && edge.target === step.sceneId);
        const candidates = graph.branchEdges.filter(
            edge => edge.sourceSceneId === from && edge.target === step.sceneId,
        );
        const witnessed = step.viaJumpBlockId
            ? candidates.find(edge => edge.jumps.some(jump => jump.blockId === step.viaJumpBlockId))
            : undefined;
        const taken = witnessed ?? (candidates.length === 1 ? candidates[0] : undefined);
        if (taken) {
            edgeIds.add(taken.id);
            // The arm itself, so it stays bright even where its line is not drawn (a collapsed
            // scene draws only the scene edge) — `isBranchEmphasized` accepts an arm's own id.
            edgeIds.add(taken.sourceBranchId);
        }
        if (sceneEdge) {
            edgeIds.add(sceneEdge.id);
        }
    }
    return { sceneIds, edgeIds };
}

// --- Variable focus chips ---------------------------------------------------------------------

/** U+2212 MINUS SIGN: a hyphen next to a digit reads as a dash at the sizes the map is drawn at. */
const MINUS_SIGN = "−";
/** U+2013 EN DASH — a range, not a subtraction. */
const EN_DASH = "–";

/** `?` — what the variable pass prints wherever it cannot derive a number. Never a 0. */
const UNKNOWN_CHIP = "?";

function formatSigned(amount: number): string {
    return amount < 0 ? `${MINUS_SIGN}${Math.abs(amount)}` : `+${amount}`;
}

/** What one arm does to the focused counter: `+2`, `−1`, `=5`, `?`. */
export function formatStoryVariableDeltaChip(delta: SceneFlowDelta): string {
    if (delta.op === "add") {
        return formatSigned(delta.amount);
    }
    if (delta.op === "set") {
        return `=${delta.value}`;
    }
    return UNKNOWN_CHIP;
}

/**
 * What the counter can hold **on arrival** at a scene: `4`, `0–7`, `?`.
 *
 * The variable's name is deliberately not repeated on every box — the focus picker names it once,
 * three characters from the chip, and a 380px panel draws these at a zoom where the name would be
 * the only thing that did not fit.
 */
export function formatStoryVariableRangeChip(range: SceneFlowRange): string {
    if (range.kind === "unknown") {
        return UNKNOWN_CHIP;
    }
    return range.min === range.max ? String(range.min) : `${range.min}${EN_DASH}${range.max}`;
}
