import type { StoryBlock, StoryLayerDepth, StoryScene } from "./document";
import { normalizeStageObjectName } from "./displayableTarget";
import { listSceneBlocksInDocumentOrder } from "./order";

/** Every depth, nearest first - the order the layer panel's lanes and every picker list them in. */
export const STORY_LAYER_DEPTHS: readonly StoryLayerDepth[] = ["near", "follow", "mid", "far", "farthest"];

/** What a layer with no depth stated does: move with the camera, as every layer always has. */
export const DEFAULT_STORY_LAYER_DEPTH: StoryLayerDepth = "follow";

/**
 * The share of a camera pan or zoom each depth follows - the engine layer's `parallax`.
 *
 * These numbers are Studio's, not the author's. A depth is something an author can say ("the hills
 * are far away"); the share that makes far look far is a tuning question with no answer an author
 * could check, so it is not offered as a setting. Changing one changes how every story that uses it
 * plays, which is the point of keeping them in one table.
 */
const DEPTH_PARALLAX: Record<StoryLayerDepth, number> = {
    near: 1.4,
    follow: 1,
    mid: 0.6,
    far: 0.3,
    farthest: 0,
};

export function isStoryLayerDepth(value: unknown): value is StoryLayerDepth {
    return typeof value === "string" && Object.prototype.hasOwnProperty.call(DEPTH_PARALLAX, value);
}

/** The engine parallax for a depth; anything unrecognised moves with the camera. */
export function storyLayerDepthParallax(depth: StoryLayerDepth | undefined): number {
    return depth && isStoryLayerDepth(depth) ? DEPTH_PARALLAX[depth] : 1;
}

/** Whether a layer row is the one that says how far away the scene's built-in background layer sits. */
export function isBackgroundLayerDepthRow(block: StoryBlock): boolean {
    return block.kind === "action"
        && block.payload.action === "layer"
        && block.payload.operation === "setDepth"
        && block.payload.target?.kind === "default"
        && block.payload.target.layer === "background";
}

/**
 * How far from the camera each layer of a scene sits, read off the rows that say so.
 *
 * Depth is a property of the layer for the whole scene, not a step the story takes, so where a row
 * stands does not matter - which is also why this reads the whole scene, disabled rows aside, rather
 * than walking to some row. A custom layer's depth is on its `create` row, keyed by the stage name
 * the compiler registers it under; the built-in background layer's is on a `setDepth` row, and when
 * a scene has two of those the later one is the one that holds (lint names the earlier).
 */
export function sceneLayerDepths(scene: StoryScene | null | undefined): {
    background: StoryLayerDepth | undefined;
    custom: Map<string, StoryLayerDepth>;
} {
    const custom = new Map<string, StoryLayerDepth>();
    let background: StoryLayerDepth | undefined;
    for (const block of listSceneBlocksInDocumentOrder(scene, { skipSubtree: candidate => candidate.disabled === true })) {
        if (block.kind !== "action" || block.payload.action !== "layer") {
            continue;
        }
        const payload = block.payload;
        if (payload.operation === "create" && payload.depth && isStoryLayerDepth(payload.depth)) {
            custom.set(normalizeStageObjectName(payload.objectName), payload.depth);
        } else if (isBackgroundLayerDepthRow(block) && payload.depth && isStoryLayerDepth(payload.depth)) {
            background = payload.depth;
        }
    }
    return { background, custom };
}
