import type { StoryBlock, StoryBlockId, StoryScene } from "@shared/types/story";
import { listSceneBlocksInDocumentOrder } from "@shared/types/story/order";
import type { UIStageSlotId } from "@shared/types/ui-editor/document";
import { isPreviewStopRow } from "./storyPreviewStep";
import { resolvePreviewTargetBlockId } from "./storyScenePreviewTarget";

/**
 * Which story rows show which Game UI in the live preview.
 *
 * The preview holds the stage at one row, so a Game UI is on its stage only at the rows that put it
 * there: a line of dialogue or narration shows the dialogue box, the same line inside `/nvl` shows
 * the NVL page instead, and a menu shows the choices. The On-Stage Game UI is drawn whenever the
 * stage is, so every row shows it. Notifications come from blueprints and no row shows them.
 *
 * Read by the UI editor, which opens the preview on a row that shows the surface being edited.
 */

/** Whether any row of a story can show this slot's Game UI in the live preview. */
export function storyPreviewCanShowSlot(slotId: UIStageSlotId): boolean {
    return slotId !== "notification";
}

/**
 * Whether the preview, held at the row the editor cursor is on, shows this slot's Game UI.
 *
 * The cursor is resolved the way the preview resolves it: an option row previews its menu, and a note
 * previews the row before it.
 */
export function storyPreviewRowShowsSlot(scene: StoryScene, cursorBlockId: StoryBlockId | null, slotId: UIStageSlotId): boolean {
    if (slotId === "onStage") {
        return true;
    }
    const targetId = resolvePreviewTargetBlockId(scene, cursorBlockId);
    const block = targetId ? scene.blocks[targetId] : undefined;
    return block !== undefined && blockShowsSlot(scene, block, slotId);
}

/**
 * The row to hold the preview at so that it shows this slot's Game UI, searching from the cursor.
 *
 * The cursor's own row when it already shows it; otherwise the first row after it that does, in the
 * order the author reads the scene, and then the first one before it. Rows the author is not showing
 * (filtered out, folded away) and rows the game never plays (disabled, or inside a disabled
 * container) are passed over. Null when the scene has no such row.
 */
export function findStoryPreviewRowForSlot(
    scene: StoryScene,
    cursorBlockId: StoryBlockId | null,
    slotId: UIStageSlotId,
    isShown: (blockId: StoryBlockId) => boolean = () => true,
): StoryBlockId | null {
    if (!storyPreviewCanShowSlot(slotId)) {
        return null;
    }
    const rows = listSceneBlocksInDocumentOrder(scene);
    const playable = new Set(listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => block.disabled === true }).map(block => block.id));
    const targetId = resolvePreviewTargetBlockId(scene, cursorBlockId);
    if (cursorBlockId && playable.has(cursorBlockId) && isShown(cursorBlockId)
        && (slotId === "onStage" || (targetId !== null && playable.has(targetId)))
        && storyPreviewRowShowsSlot(scene, cursorBlockId, slotId)) {
        return cursorBlockId;
    }
    const cursorIndex = cursorBlockId ? rows.findIndex(block => block.id === cursorBlockId) : -1;
    const ordered = cursorIndex >= 0 ? [...rows.slice(cursorIndex + 1), ...rows.slice(0, cursorIndex)] : rows;
    const found = ordered.find(block => playable.has(block.id) && isPreviewStopRow(scene, block) && blockShowsSlot(scene, block, slotId) && isShown(block.id));
    const stageRow = slotId === "onStage" ? ordered.find(block => playable.has(block.id) && isShown(block.id)) : undefined;
    return found?.id ?? stageRow?.id ?? null;
}

function blockShowsSlot(scene: StoryScene, block: StoryBlock, slotId: UIStageSlotId): boolean {
    if (block.kind !== "nodeAction") {
        return false;
    }
    switch (slotId) {
        case "onStage":
            return isPreviewStopRow(scene, block);
        case "notification":
            return false;
        case "choice":
            return block.payload.action === "choice" && isPreviewStopRow(scene, block);
        case "dialog":
        case "nvl": {
            const action = block.payload.action;
            if ((action !== "dialogue" && action !== "narration") || !isPreviewStopRow(scene, block)) {
                return false;
            }
            return isInsideNvl(scene, block) === (slotId === "nvl");
        }
    }
}

/** Whether a row sits inside an `/nvl` block, whose lines the NVL page shows instead of the dialogue box. */
function isInsideNvl(scene: StoryScene, block: StoryBlock): boolean {
    const seen = new Set<StoryBlockId>([block.id]);
    let cursor = block.parentId ? scene.blocks[block.parentId] : undefined;
    while (cursor && !seen.has(cursor.id)) {
        if (cursor.kind === "action" && cursor.payload.action === "nvl") {
            return true;
        }
        seen.add(cursor.id);
        cursor = cursor.parentId ? scene.blocks[cursor.parentId] : undefined;
    }
    return false;
}
