import type { StoryBlock, StoryScene } from "@shared/types/story";

/**
 * Resolve the row the user selected to the block the preview should target:
 * - `choiceOption` / `conditionBranch` rows target their parent container (the menu / condition),
 * - `code` / `note` rows fall back to the nearest previous non-code/note block in execution order,
 * - anything unresolved previews the scene start (`null`).
 */
export function resolvePreviewTargetBlockId(scene: StoryScene, activeBlockId: string | null): string | null {
    const block = resolveRunnableBlock(scene, activeBlockId);
    if (!block) {
        return null;
    }
    if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
        return block.parentId && scene.blocks[block.parentId] ? block.parentId : null;
    }
    if (block.kind === "control" && block.payload.control === "conditionBranch") {
        return block.parentId && scene.blocks[block.parentId] ? block.parentId : null;
    }
    return block.id;
}

/**
 * Resolve the row "play from here" starts continuous playback at.
 *
 * Deliberately *not* {@link resolvePreviewTargetBlockId}: that collapses an option row to its menu,
 * which is right for showing state (the menu is what's on screen) and exactly wrong for playback —
 * starting on an option means "take this branch", so the option must survive as the start row.
 */
export function resolvePlaybackStartBlockId(scene: StoryScene, blockId: string | null): string | null {
    return resolveRunnableBlock(scene, blockId)?.id ?? null;
}

/** The nearest block with runtime behaviour: the row itself, or the previous one for code/note rows. */
function resolveRunnableBlock(scene: StoryScene, blockId: string | null): StoryBlock | null {
    if (!blockId || !scene.blocks[blockId]) {
        return null;
    }
    const block = scene.blocks[blockId];
    if (!isNonPreviewableKind(block)) {
        return block;
    }
    const order = executionOrderBlockIds(scene);
    const index = order.indexOf(block.id);
    for (let i = index - 1; i >= 0; i -= 1) {
        const candidate = scene.blocks[order[i]];
        if (candidate && !isNonPreviewableKind(candidate)) {
            return candidate;
        }
    }
    return null;
}

function isNonPreviewableKind(block: StoryBlock): boolean {
    return block.kind === "code" || block.kind === "note";
}

/** Depth-first block ids in execution order (the order the compiler emits statements). */
function executionOrderBlockIds(scene: StoryScene): string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const visit = (blockId: string) => {
        if (seen.has(blockId)) {
            return;
        }
        seen.add(blockId);
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        order.push(blockId);
        for (const childId of block.childrenIds) {
            visit(childId);
        }
    };
    for (const rootId of scene.rootBlockIds) {
        visit(rootId);
    }
    return order;
}
