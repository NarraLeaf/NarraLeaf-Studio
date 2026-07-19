import type { StoryBlock, StoryBlockId, StoryScene, StorySceneId } from "@shared/types/story";

/**
 * Execution-order continuation walk: given the row playback starts at, list every block that runs
 * after it, in the order the compiler must emit them.
 *
 * This is what lifts the preview from "one row" to "from this row onwards". The snapshot walker
 * (computeStoryStageSnapshot) answers *what the stage looks like when we arrive*; this answers
 * *what happens next*, and the two meet at the start row.
 *
 * The walk is an ascent, not a flat scan of the scene: from the start row it emits the following
 * siblings at each level, then climbs to the parent and repeats. Alternative-branch containers are
 * the reason a flat scan will not do — climbing out of a menu option must skip the *other* options
 * (they are roads not taken, not the next thing to play) and resume after the menu itself. The same
 * holds for condition branches.
 */

/** One block to compile into the playback tail. */
export type StoryPlaybackStep = {
    blockId: StoryBlockId;
    /**
     * Compile only this block's children, not the block itself. Set when playback is *entered* at a
     * menu option or condition branch — the row is a branch label with no action of its own, so
     * "play from here" means "play this branch's body".
     */
    bodyOnly: boolean;
    /** The block executes inside an NVL container and must be compiled within an `nvl` wrapper. */
    insideNvl: boolean;
};

/** Why the tail ends. Surfaced to the author so a preview that stops early never looks like a bug. */
export type StoryPlaybackStop =
    | { reason: "sceneEnd" }
    /** A scene jump: the preview compiles one scene only, so playback holds at the pre-jump state. */
    | { reason: "jump"; blockId: StoryBlockId; targetSceneId: StorySceneId }
    /** Structural cycle or a scene past the step ceiling — a defensive stop, not a normal one. */
    | { reason: "limit" };

export type StoryPlaybackPlan = {
    steps: StoryPlaybackStep[];
    stop: StoryPlaybackStop;
};

/** Defensive ceiling: a malformed tree must not spin the compiler, and no real scene comes close. */
const MAX_STEPS = 2_000;

/**
 * Build the playback plan for a scene starting at `startBlockId` (null = the whole scene from its
 * first row).
 */
export function collectStoryPlaybackPlan(scene: StoryScene, startBlockId: StoryBlockId | null): StoryPlaybackPlan {
    const builder = new PlanBuilder(scene);
    const start = startBlockId ? scene.blocks[startBlockId] : undefined;

    if (!start) {
        // No start row (or a dangling id): play the scene from the top.
        builder.pushList(scene.rootBlockIds);
        return builder.finish();
    }

    if (!builder.pushBlock(start, isBranchEntry(start))) {
        return builder.finish();
    }

    // Ascend: emit what follows at each level, then climb one level and repeat.
    let cursor: StoryBlock | undefined = start;
    let guard = 0;
    while (cursor && guard++ < MAX_STEPS) {
        const parent: StoryBlock | undefined = cursor.parentId ? scene.blocks[cursor.parentId] : undefined;
        const siblings = parent ? parent.childrenIds : scene.rootBlockIds;
        const index = siblings.indexOf(cursor.id);
        // Options / condition branches: the siblings that follow are the alternatives, and playback
        // took this one. Skip straight past them to whatever follows the container.
        if (index >= 0 && !isBranchEntry(cursor) && !builder.pushList(siblings.slice(index + 1))) {
            return builder.finish();
        }
        if (!parent) {
            return builder.finish();
        }
        cursor = parent;
    }
    if (guard >= MAX_STEPS) {
        builder.stopAtLimit();
    }
    return builder.finish();
}

/** A row that labels a branch rather than doing anything itself. */
function isBranchEntry(block: StoryBlock): boolean {
    return (block.kind === "nodeAction" && block.payload.action === "choiceOption")
        || (block.kind === "control" && block.payload.control === "conditionBranch");
}

/** Rows with no runtime behaviour at all; emitting them would only add compiler noise. */
function isInertKind(block: StoryBlock): boolean {
    return block.kind === "note" || block.kind === "code";
}

class PlanBuilder {
    private readonly steps: StoryPlaybackStep[] = [];
    private stop: StoryPlaybackStop = { reason: "sceneEnd" };
    private stopped = false;

    constructor(private readonly scene: StoryScene) {}

    /** Emit each id in order. Returns false once the walk has stopped (jump / ceiling). */
    pushList(blockIds: readonly StoryBlockId[]): boolean {
        for (const blockId of blockIds) {
            const block = this.scene.blocks[blockId];
            if (!block) {
                continue;
            }
            if (!this.pushBlock(block, false)) {
                return false;
            }
        }
        return true;
    }

    /** Emit one block. Returns false if this block ended the walk. */
    pushBlock(block: StoryBlock, bodyOnly: boolean): boolean {
        if (this.stopped) {
            return false;
        }
        if (isInertKind(block)) {
            return true;
        }
        if (block.kind === "jump") {
            // The preview compiles a single scene, so the jump itself cannot be played. Stop here
            // and name the destination; the pane turns this into "playback ends — jumps to X".
            this.stop = { reason: "jump", blockId: block.id, targetSceneId: block.payload.targetSceneId };
            this.stopped = true;
            return false;
        }
        if (this.steps.length >= MAX_STEPS) {
            this.stopAtLimit();
            return false;
        }
        this.steps.push({ blockId: block.id, bodyOnly, insideNvl: this.isInsideNvl(block) });
        return true;
    }

    stopAtLimit(): void {
        this.stop = { reason: "limit" };
        this.stopped = true;
    }

    finish(): StoryPlaybackPlan {
        return { steps: this.steps, stop: this.stop };
    }

    /** True when any ancestor is an NVL container (the block renders in NVL mode). */
    private isInsideNvl(block: StoryBlock): boolean {
        const seen = new Set<StoryBlockId>([block.id]);
        let cursor = block.parentId ? this.scene.blocks[block.parentId] : undefined;
        while (cursor && !seen.has(cursor.id)) {
            if (cursor.kind === "action" && cursor.payload.action === "nvl") {
                return true;
            }
            seen.add(cursor.id);
            cursor = cursor.parentId ? this.scene.blocks[cursor.parentId] : undefined;
        }
        return false;
    }
}

/**
 * Group consecutive steps by NVL mode, so the compiler can wrap each in-NVL run in a single `nvl`
 * container instead of one per statement (which would restart NVL mode on every line).
 */
export function groupPlaybackStepsByNvl(steps: readonly StoryPlaybackStep[]): { insideNvl: boolean; steps: StoryPlaybackStep[] }[] {
    const groups: { insideNvl: boolean; steps: StoryPlaybackStep[] }[] = [];
    for (const step of steps) {
        const last = groups[groups.length - 1];
        if (last && last.insideNvl === step.insideNvl) {
            last.steps.push(step);
        } else {
            groups.push({ insideNvl: step.insideNvl, steps: [step] });
        }
    }
    return groups;
}
