/**
 * The three ways the flow map writes back to a story: draw an edge, drag its end onto another
 * scene, delete it. Each one maps to jump blocks in the *source* scene — the map never edits the
 * target, because a jump is owned by the scene it leaves.
 */

import type { StoryBlock, StoryDocument, StoryId, StorySceneId } from "@shared/types/story";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { SceneFlowEdgeModel } from "./sceneFlowModel";

export interface SceneFlowJumpOpsDeps {
    storyService: StoryService;
    storyId: StoryId;
    generateId: () => string;
}

/**
 * Append an unconditional jump to the end of the source scene, which is where a hand-off belongs:
 * a jump earlier in the scene would make everything after it unreachable.
 */
export function createJumpBlock(
    deps: SceneFlowJumpOpsDeps,
    sourceSceneId: StorySceneId,
    targetSceneId: StorySceneId,
): StoryBlock {
    const block: StoryBlock = {
        id: deps.generateId(),
        kind: "jump",
        parentId: null,
        childrenIds: [],
        payload: { targetSceneId },
    };
    deps.storyService.insertBlock(deps.storyId, sourceSceneId, block, { parentId: null, beforeBlockId: null });
    return block;
}

/**
 * Point every jump behind an edge at a new scene, in place — so a jump nested inside a condition
 * stays inside it, and any transition the author configured survives.
 */
export function retargetJumpBlocks(
    deps: SceneFlowJumpOpsDeps,
    document: StoryDocument,
    edge: SceneFlowEdgeModel,
    nextTargetSceneId: StorySceneId,
): void {
    const scene = document.scenes[edge.source];
    if (!scene) {
        return;
    }
    for (const jump of edge.jumps) {
        const block = scene.blocks[jump.blockId];
        if (block?.kind !== "jump") {
            continue;
        }
        deps.storyService.updateBlock(deps.storyId, edge.source, jump.blockId, {
            ...block.payload,
            targetSceneId: nextTargetSceneId,
        });
    }
}

export function deleteJumpBlocks(deps: SceneFlowJumpOpsDeps, edge: SceneFlowEdgeModel): void {
    for (const jump of edge.jumps) {
        deps.storyService.deleteBlock(deps.storyId, edge.source, jump.blockId);
    }
}

/**
 * Deleting an edge deletes authored blocks, and the map does not show everything about them — a
 * conditional jump lives inside an if/loop the map only hints at with a dashed line, and one edge
 * can stand for several jumps. Ask first in those cases; a lone plain jump is fully visible, so
 * deleting it needs no ceremony.
 */
export function edgeDeletionNeedsConfirm(edge: SceneFlowEdgeModel): boolean {
    return edge.jumps.length > 1 || edge.jumps.some(jump => jump.conditional);
}
