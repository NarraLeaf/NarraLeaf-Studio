import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import { listSceneLabels } from "@shared/types/story/labels";
import { collectStoryPlaybackPlan } from "@/lib/ui-editor/runtime/game/storyPlaybackWalk";
import { isSilentStoryLine } from "@/lib/ui-editor/runtime/game/storyCompiler";

/**
 * Where a click on the live preview moves the story editor's cursor: the next row at which the game
 * waits for the player.
 *
 * The preview holds the stage at one row. Clicking it is the reader's "next", so it moves to the row
 * the game would stop on next - a line of narration or dialogue, or a menu - passing over the rows in
 * between, whose effect is already part of the stage the preview poses. The order is play's own:
 * {@link collectStoryPlaybackPlan} walks out of a branch to whatever follows the whole block, the way
 * play does, and this module only looks inside each step of it for the first row that stops.
 *
 * A row at which play leaves the scene - a jump, an `/ending`, a `/quit` - is the last stop. The
 * cursor moves onto it, the preview holds before it, and a click there goes no further.
 */

export type StoryPreviewStepOptions = {
    /**
     * The arm of a condition play takes from here, or null when it takes none. Decided by the host,
     * which holds the variable state the decision needs.
     */
    chooseBranch: (condition: StoryBlock) => StoryBlockId | null;
    /**
     * Whether the author is showing a row. A stop they have filtered out or folded away is passed
     * over, as the editor does when it follows a running game. Absent, every row is shown.
     */
    isShown?: (blockId: StoryBlockId) => boolean;
};

/** How far a search inside one step got. */
type StepSearch =
    | { kind: "stop"; blockId: StoryBlockId }
    /** A row that leaves the scene. Nothing after it plays. */
    | { kind: "leave"; blockId: StoryBlockId }
    /** A `/break`: play leaves the loop named here and carries on after it. */
    | { kind: "break"; loopId: StoryBlockId }
    /** A `/goto`: play carries on at the label row. */
    | { kind: "goto"; labelBlockId: StoryBlockId }
    | { kind: "none" };

/** More gotos than this between two stops is a loop with no stop in it. */
const MAX_GOTOS = 64;

/**
 * The row the preview steps to from `fromBlockId` (null: the top of the scene), or null when play
 * goes no further from there - the scene ends, or the row is itself where play leaves it.
 */
export function resolveNextPreviewStop(
    scene: StoryScene,
    fromBlockId: StoryBlockId | null,
    options: StoryPreviewStepOptions,
): StoryBlockId | null {
    const found = new StepWalker(scene, options).fromRow(fromBlockId, false);
    return found === fromBlockId ? null : found;
}

/**
 * The row picking `optionBlockId` stops on first: a row inside that option's branch, or - when the
 * branch has none - whatever play stops on after the menu.
 */
export function resolveChosenOptionStop(
    scene: StoryScene,
    optionBlockId: StoryBlockId,
    options: StoryPreviewStepOptions,
): StoryBlockId | null {
    return new StepWalker(scene, options).fromRow(optionBlockId, true);
}

/** True for a row play waits on the player at: a line with something to say, or a menu that offers an option. */
export function isPreviewStopRow(scene: StoryScene, block: StoryBlock): boolean {
    if (block.kind !== "nodeAction") {
        return false;
    }
    const payload = block.payload;
    if (payload.action === "narration" || payload.action === "dialogue") {
        return !isSilentStoryLine(payload.text);
    }
    if (payload.action === "choice") {
        // A menu whose options are all disabled is compiled out, so play does not stop on it.
        return block.childrenIds.some(childId => {
            const option = scene.blocks[childId];
            return option?.kind === "nodeAction" && option.payload.action === "choiceOption" && !option.disabled;
        });
    }
    return false;
}

class StepWalker {
    private gotos = 0;

    constructor(private readonly scene: StoryScene, private readonly options: StoryPreviewStepOptions) {}

    /**
     * Search play order from `startId`. With `includeStart` false the start row is where the cursor
     * already is, so only what runs after it counts - its own children included, which run after it.
     */
    fromRow(startId: StoryBlockId | null, includeStart: boolean): StoryBlockId | null {
        const plan = collectStoryPlaybackPlan(this.scene, startId);
        let brokenLoopId: StoryBlockId | null = null;
        for (const [index, step] of plan.steps.entries()) {
            const block = this.scene.blocks[step.blockId];
            if (!block) {
                continue;
            }
            // After a `/break`, the rest of the loop's body is not played.
            if (brokenLoopId && this.isInside(block, brokenLoopId)) {
                continue;
            }
            brokenLoopId = null;
            // A row inside a disabled container is compiled out with it.
            if (this.hasDisabledAncestor(block)) {
                continue;
            }
            const isStart = index === 0 && step.blockId === startId;
            const found = step.bodyOnly
                ? this.searchList(block.childrenIds)
                : this.searchBlock(block, isStart && !includeStart);
            switch (found.kind) {
                case "stop":
                    return found.blockId;
                case "leave":
                    return this.shown(found.blockId) ? found.blockId : null;
                case "break":
                    brokenLoopId = found.loopId;
                    continue;
                case "goto":
                    return this.gotos++ < MAX_GOTOS ? this.fromRow(found.labelBlockId, true) : null;
                default:
                    continue;
            }
        }
        if (plan.stop.reason === "jump") {
            return this.shown(plan.stop.blockId) ? plan.stop.blockId : null;
        }
        return null;
    }

    /** The first stop in `block` and the rows beneath it, in play order. */
    private searchBlock(block: StoryBlock, skipSelf: boolean): StepSearch {
        if (block.disabled) {
            return { kind: "none" };
        }
        if (block.kind === "jump") {
            return { kind: "leave", blockId: block.id };
        }
        if (block.kind === "control") {
            const payload = block.payload;
            if (payload.control === "ending" || payload.control === "quit") {
                return { kind: "leave", blockId: block.id };
            }
            if (payload.control === "break") {
                const loop = this.enclosingLoop(block);
                return loop ? { kind: "break", loopId: loop.id } : { kind: "none" };
            }
            if (payload.control === "goto") {
                const target = payload.targetLabel.trim();
                const label = listSceneLabels(this.scene).find(entry => entry.name === target);
                return label ? { kind: "goto", labelBlockId: label.blockId } : { kind: "none" };
            }
            if (payload.control === "condition") {
                const branchId = this.options.chooseBranch(block);
                const branch = branchId ? this.scene.blocks[branchId] : undefined;
                return branch && branch.parentId === block.id && !branch.disabled
                    ? this.searchList(branch.childrenIds)
                    : { kind: "none" };
            }
        }
        const isMenu = block.kind === "nodeAction" && block.payload.action === "choice";
        if (!skipSelf && isPreviewStopRow(this.scene, block) && this.shown(block.id)) {
            return { kind: "stop", blockId: block.id };
        }
        if (isMenu) {
            // Past a menu is a pick, which the menu answers itself; its options are not rows play
            // reaches by going on.
            return { kind: "none" };
        }
        return this.searchList(block.childrenIds);
    }

    private searchList(blockIds: readonly StoryBlockId[]): StepSearch {
        for (const blockId of blockIds) {
            const block = this.scene.blocks[blockId];
            if (!block) {
                continue;
            }
            const found = this.searchBlock(block, false);
            if (found.kind !== "none") {
                return found;
            }
        }
        return { kind: "none" };
    }

    private shown(blockId: StoryBlockId): boolean {
        return !this.options.isShown || this.options.isShown(blockId);
    }

    /** The nearest `repeat` above a row - the loop a `/break` there leaves. */
    private enclosingLoop(block: StoryBlock): StoryBlock | null {
        const seen = new Set<StoryBlockId>();
        let cursor = block.parentId ? this.scene.blocks[block.parentId] : undefined;
        while (cursor && !seen.has(cursor.id)) {
            seen.add(cursor.id);
            if (cursor.kind === "control" && cursor.payload.control === "repeat") {
                return cursor;
            }
            cursor = cursor.parentId ? this.scene.blocks[cursor.parentId] : undefined;
        }
        return null;
    }

    private isInside(block: StoryBlock, ancestorId: StoryBlockId): boolean {
        const seen = new Set<StoryBlockId>();
        let cursor: StoryBlock | undefined = block;
        while (cursor && !seen.has(cursor.id)) {
            if (cursor.id === ancestorId) {
                return true;
            }
            seen.add(cursor.id);
            cursor = cursor.parentId ? this.scene.blocks[cursor.parentId] : undefined;
        }
        return false;
    }

    private hasDisabledAncestor(block: StoryBlock): boolean {
        const seen = new Set<StoryBlockId>([block.id]);
        let cursor = block.parentId ? this.scene.blocks[block.parentId] : undefined;
        while (cursor && !seen.has(cursor.id)) {
            if (cursor.disabled) {
                return true;
            }
            seen.add(cursor.id);
            cursor = cursor.parentId ? this.scene.blocks[cursor.parentId] : undefined;
        }
        return false;
    }
}
