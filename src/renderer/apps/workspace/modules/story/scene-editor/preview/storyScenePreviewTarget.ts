import type { StoryBlock, StoryScene } from "@shared/types/story";

/**
 * Resolve the row the user selected to the block the preview should target:
 * - `choiceOption` / `conditionBranch` rows target their parent container (the menu / condition),
 * - `code` / `note` rows fall back to the nearest previous non-code/note block in execution order,
 * - anything unresolved previews the scene start (`null`).
 */
export function resolvePreviewTargetBlockId(scene: StoryScene, activeBlockId: string | null): string | null {
    if (!activeBlockId || !scene.blocks[activeBlockId]) {
        return null;
    }
    let block = scene.blocks[activeBlockId];

    if (isNonPreviewableKind(block)) {
        const order = executionOrderBlockIds(scene);
        const index = order.indexOf(block.id);
        let fallback: StoryBlock | null = null;
        for (let i = index - 1; i >= 0; i -= 1) {
            const candidate = scene.blocks[order[i]];
            if (candidate && !isNonPreviewableKind(candidate)) {
                fallback = candidate;
                break;
            }
        }
        if (!fallback) {
            return null;
        }
        block = fallback;
    }

    if (block.kind === "nodeAction" && block.payload.action === "choiceOption") {
        return block.parentId && scene.blocks[block.parentId] ? block.parentId : null;
    }
    if (block.kind === "control" && block.payload.control === "conditionBranch") {
        return block.parentId && scene.blocks[block.parentId] ? block.parentId : null;
    }
    return block.id;
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
