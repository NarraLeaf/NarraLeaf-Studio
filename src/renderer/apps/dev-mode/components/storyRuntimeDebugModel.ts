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
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryLiteralValue,
    StoryScene,
    StorySceneId,
    StoryVariableValueType,
} from "@shared/types/story";
import { sceneVariableDefs, savedVariableDefs, storyPersistentDefs } from "@shared/types/story";

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
        const projected = projectStoryRow(block, lookups);
        rows.push({
            blockId,
            lineNumber: rows.length + 1,
            depth,
            kind: block.kind,
            disabled: block.disabled === true,
            summary: projected.sentence,
            speaker: projected.speaker?.name || null,
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
    /** Present on a concurrent group (`Control.all` / `any`): one frame list per branch. */
    branches?: StackFrameLike[][];
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
    /**
     * The round it is ON — 1-based, `2/3`. Only present when the engine reports a loop for it, which
     * today it does not for a `/repeat` row: see {@link findReportedLoop}.
     */
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
 * The loop the engine is reporting, if any — root first, then the async stacks.
 *
 * A `/repeat` row does NOT surface here, and that is an engine limitation rather than an oversight:
 * `Control.repeat` runs its body in a nested StackModel handed to the parent as
 * `wait.stackModels`, and `StackModel.snapshot()` maps those to `snapshot().frames` — dropping the
 * nested stack's `loop` on the floor. The root stack is `$root`, never the loop, so `root.loop` is
 * empty for every repeat an author can write in a scene. Measured on the running app, not inferred.
 *
 * The reading is kept because it costs nothing and is correct the moment the engine reports nested
 * stacks whole; until then a repeat rung shows the round count it is authored for, from the document.
 */
function findReportedLoop(stack: StackViewLike | null): StackLike["loop"] | null {
    if (!stack) {
        return null;
    }
    return stack.root.loop ?? stack.async.find(entry => entry.loop)?.loop ?? null;
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
            const fromEngine = blockIdForActionId(bindings, reported?.[index]?.[0]?.actionId ?? null);
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
            const nested = findBranchingFrame(branch);
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
 * document-wide saved and persistent. Live values are merged in by the panel from the runtime store.
 */
export function listDeclaredStoryVariables(
    document: StoryDocument,
    sceneId: StorySceneId,
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
    for (const def of Object.values(storyPersistentDefs(document))) {
        variables.push({
            scope: "persistent",
            id: def.storageKey,
            name: def.name,
            valueType: def.valueType,
            defaultValue: def.defaultValue,
            storageKey: def.storageKey,
        });
    }
    return variables;
}
