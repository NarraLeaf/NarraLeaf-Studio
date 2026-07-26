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
    /** The round this repeat is on, when the engine reports a loop for it: 1-based, `2/3`. */
    round?: { current: number; limit?: number };
};

export type ExecutionContextBranch = {
    /** 1-based, as the panel numbers them. */
    index: number;
    /** The branch's current row, as a sentence; `null` when it maps to no Studio row. */
    sentence: string | null;
};

export type ExecutionContextView = {
    /** The scene that is running, by name. */
    sceneName: string;
    /** Outermost container first; empty at the root of a scene. */
    chain: ExecutionContextRung[];
    /** Who is running inside the innermost concurrent group, if any. */
    branches: ExecutionContextBranch[];
    /** A loop the engine reports that no container in the chain claims (a stale or foreign frame). */
    orphanRound: { current: number; limit?: number } | null;
};

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

/**
 * Where execution is, in the author's terms: which scene, which containers it is nested in, which
 * round a repeat is on, and who is running inside a parallel.
 *
 * The chain is walked from the *story* (`parentId`), not from the engine's frames: "where am I" is a
 * fact about the document, so it holds for every row and never has to be reconciled with an enum. The
 * engine is asked only for the two things the document cannot know — the loop counter and the live
 * branches.
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
        ? storyContainerChain(scene, currentBlockId).map(rung => ({ blockId: rung.blockId, pill: rung.info.pill }))
        : [];

    // One loop at a time: the engine reports the running loop on whichever stack owns it, and nesting
    // two counted loops around one row is rare enough that guessing between them would be worse than
    // showing the one that is live.
    const loop = stack
        ? stack.root.loop ?? stack.async.find(entry => entry.loop)?.loop ?? null
        : null;
    let orphanRound: ExecutionContextView["orphanRound"] = null;
    if (loop) {
        // `counter` counts COMPLETED iterations, so the round the author is watching is counter + 1 —
        // clamped, because the counter reaches the limit in the instant before the loop drains.
        const current = loop.limit != null ? Math.min(loop.counter + 1, loop.limit) : loop.counter + 1;
        const round = { current, ...(loop.limit != null ? { limit: loop.limit } : {}) };
        const repeatIndex = scene
            ? findLastIndex(chain, rung => {
                const block = scene.blocks[rung.blockId];
                return Boolean(block && getStoryContainerHeaderInfo(block)?.repeatTimes !== undefined);
            })
            : -1;
        if (repeatIndex >= 0) {
            chain[repeatIndex] = { ...chain[repeatIndex], round };
        } else {
            orphanRound = round;
        }
    }

    const branchingFrame = stack
        ? findBranchingFrame(stack.root.frames) ?? stack.async.map(entry => findBranchingFrame(entry.frames)).find(Boolean) ?? null
        : null;
    const branches: ExecutionContextBranch[] = (branchingFrame?.branches ?? []).map((frames, index) => {
        const blockId = blockIdForActionId(bindings, frames[0]?.actionId ?? null);
        return { index: index + 1, sentence: blockId ? rowSentence(blockId) : null };
    });

    return { sceneName, chain, branches, orphanRound };
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
