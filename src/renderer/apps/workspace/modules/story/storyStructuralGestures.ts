import { translate, translateN } from "@/lib/i18n";
import { storySceneHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import {
    findSceneReferrersInBlueprints,
    planSceneMerge,
    sceneNeighbours,
    type StorySceneReferrer,
} from "@/lib/workspace/services/story/storyStructuralOps";
import type { StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { UIService } from "@/lib/workspace/services/core/UIService";

/**
 * The gestures behind the story's structural operations: rows moving to another scene, two scenes
 * becoming one.
 *
 * Each of them is reachable from two places - the scene editor and the outline - and each is
 * written once here so the two entry points cannot answer differently about which undo stack the
 * step lands on, what the author is told, or when the operation is refused.
 *
 * Splitting is not here: it is reachable from one place (the row it cuts at) and needs the editor's
 * own selection state, so it stays in the scene editor's controller.
 */

/**
 * The drag payload a row selection travels on inside this window.
 *
 * A private format name rather than `text/plain`, because the outline has to tell "rows dropping
 * onto a scene" from "a scene moving among scenes" while the pointer is still moving, and
 * `dragover` can only see format names, never data.
 */
export const STORY_ROWS_DRAG_MIME = "application/x-narraleaf-story-rows";

export type StoryRowsDragPayload = {
    storyId: StoryId;
    sceneId: StorySceneId;
    blockIds: StoryBlockId[];
};

export function readStoryRowsDrag(dataTransfer: DataTransfer | null): StoryRowsDragPayload | null {
    const raw = dataTransfer?.getData(STORY_ROWS_DRAG_MIME);
    if (!raw) {
        return null;
    }
    try {
        const parsed = JSON.parse(raw) as StoryRowsDragPayload;
        return typeof parsed?.storyId === "string"
            && typeof parsed?.sceneId === "string"
            && Array.isArray(parsed?.blockIds)
            && parsed.blockIds.length > 0
            ? parsed
            : null;
    } catch {
        return null;
    }
}

/**
 * Move rows into another scene and say so.
 *
 * The step lands on the *source* scene's stack. Both gestures start with rows selected in the scene
 * editor, so that editor is what the author is standing in and its Ctrl+Z is the one that has to
 * take the move back (`resolveWorkspaceUndoScope`).
 *
 * Returns how many rows travelled; zero means nothing was written, which is the answer a live
 * session gives because this operation is not in its vocabulary.
 */
export function moveStoryRowsToScene(params: {
    storyService: StoryService;
    uiService?: UIService;
    storyId: StoryId;
    sourceSceneId: StorySceneId;
    targetSceneId: StorySceneId;
    blockIds: readonly StoryBlockId[];
}): number {
    const { storyService, uiService, storyId, sourceSceneId, targetSceneId, blockIds } = params;
    if (sourceSceneId === targetSceneId || blockIds.length === 0) {
        return 0;
    }
    const moved = storyService.moveBlocksToScene(
        storyId,
        sourceSceneId,
        targetSceneId,
        blockIds,
        { parentId: null, beforeBlockId: null },
        { scopeId: storySceneHistoryScope(storyId, sourceSceneId) },
    );
    if (moved === 0) {
        uiService?.showNotification(translate("story.structuralOps.moveRows.refused"), "warning");
        return 0;
    }
    const sceneName = storyService.getStoryDocument(storyId).scenes[targetSceneId]?.name ?? "";
    uiService?.showNotification(
        translateN("story.structuralOps.moveRows.done", moved, { count: moved, scene: sceneName }),
        "success",
    );
    return moved;
}

/**
 * Merge a scene into the one before it, after asking.
 *
 * `sceneId` names either end of the pair and `side` says which; the earlier scene always survives,
 * so the result does not depend on which end the author reached from. Returns the scene that was
 * removed, so the caller can close whatever was showing it.
 *
 * Anything outside the story document that names the disappearing scene is looked for first and
 * refuses the merge: those references cannot be re-pointed from here, and a merge that leaves them
 * dangling is a build failure the author did not ask for.
 */
export async function mergeStoryScenes(params: {
    storyService: StoryService;
    uiService: UIService;
    blueprintService?: LocalBlueprintService;
    storyId: StoryId;
    sceneId: StorySceneId;
    side: "next" | "previous";
}): Promise<StorySceneId | null> {
    const { storyService, uiService, blueprintService, storyId, sceneId, side } = params;
    const document = storyService.getStoryDocument(storyId);
    const { previousSceneId, nextSceneId } = sceneNeighbours(document, sceneId);
    const survivingSceneId = side === "next" ? sceneId : previousSceneId;
    const mergedSceneId = side === "next" ? nextSceneId : sceneId;
    if (!survivingSceneId || !mergedSceneId) {
        uiService.showNotification(translate("story.structuralOps.mergeScenes.noNeighbour"), "info");
        return null;
    }
    const surviving = document.scenes[survivingSceneId];
    const merged = document.scenes[mergedSceneId];
    if (!surviving || !merged) {
        return null;
    }
    const referrers = findSceneReferrersInBlueprints(blueprintService?.getBlueprintDocument(), mergedSceneId);
    // Planned before the confirm rather than after it: a refusal is not something to ask about first.
    const planned = planSceneMerge(document, survivingSceneId, mergedSceneId, referrers);
    if (!planned) {
        return null;
    }
    if (planned.blockers.length > 0) {
        await uiService.showAlert(
            translate("story.structuralOps.mergeScenes.refused", { name: merged.name }),
            translate("story.structuralOps.mergeScenes.refusedDetail", {
                referrers: planned.blockers.map(describeSceneReferrer).join(", "),
            }),
        );
        return null;
    }
    const rowCount = merged.rootBlockIds.length;
    const confirmed = await uiService.showConfirm(
        translate("story.structuralOps.mergeScenes.confirm", { merged: merged.name, surviving: surviving.name }),
        translateN("story.structuralOps.mergeScenes.detail", rowCount, { count: rowCount, surviving: surviving.name }),
    );
    if (!confirmed) {
        return null;
    }
    const survivingName = surviving.name;
    const plan = storyService.mergeScenes(storyId, survivingSceneId, mergedSceneId, referrers);
    if (!plan) {
        uiService.showNotification(translate("story.structuralOps.moveRows.refused"), "warning");
        return null;
    }
    const done = translateN("story.structuralOps.mergeScenes.done", plan.movingRootCount, {
        count: plan.movingRootCount,
        scene: survivingName,
    });
    uiService.showNotification(done, "success");
    return mergedSceneId;
}

/**
 * One referrer, as the author would go looking for it.
 *
 * A row is named by where it is - its scene and its position in it - because that is what the
 * author has to open to move it. The other two name themselves.
 */
function describeSceneReferrer(referrer: StorySceneReferrer): string {
    switch (referrer.kind) {
        case "jump":
            return translate("story.structuralOps.mergeScenes.referrerJump", {
                scene: referrer.sceneName,
                row: referrer.row,
            });
        case "entryScene":
            return translate("story.structuralOps.mergeScenes.referrerEntryScene");
        default:
            return referrer.name;
    }
}
