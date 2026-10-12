import type { StorySceneLayer } from "@shared/types/story";
import { sceneLayerFollow } from "@shared/types/story";

/** A layer of the stack, keyed the way the layer view tells its layers apart. */
export function sceneLayerKey(layer: StorySceneLayer): string {
    return layer.kind === "custom" ? `custom:${layer.id}` : layer.kind;
}

/**
 * How far in front of (positive) or behind (negative) the characters' plane each layer is drawn in the
 * layer view, in units of the view's depth: the share of the camera's movement a layer follows, less
 * one. Layers that follow the same share are one distance away, and are drawn a step apart in their
 * stack order so that every plane can be seen and picked.
 */
export function layerStackDepths(stack: readonly StorySceneLayer[], tieStep: number): number[] {
    const shares = stack.map(sceneLayerFollow);
    const depths: number[] = [];
    let index = 0;
    while (index < stack.length) {
        let end = index + 1;
        while (end < stack.length && shares[end] === shares[index]) {
            end += 1;
        }
        // The middle of a tie stays at its true distance; the rest fan out to either side.
        const count = end - index;
        for (let at = index; at < end; at += 1) {
            depths.push(shares[at] - 1 + ((count - 1) / 2 - (at - index)) * tieStep);
        }
        index = end;
    }
    return depths;
}

/** The shares a dragged layer settles on when it comes near: all of the camera, none of it, and every other layer's. */
export function snapLayerFollow(stack: readonly StorySceneLayer[], key: string, follow: number, reach = 0.03): number {
    const targets = [1, 0, ...stack.filter(layer => sceneLayerKey(layer) !== key).map(sceneLayerFollow)];
    let best = follow;
    let bestDistance = reach;
    for (const target of targets) {
        const distance = Math.abs(target - follow);
        if (distance <= bestDistance) {
            best = target;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * The camera position of the moving preview at a moment, as a share of the stage's width: a slow
 * sway from side to side, the motion that shows a layer's distance most plainly.
 */
export function layerSwayOffset(timeMs: number, periodMs = 4200, amplitude = 0.05): number {
    return Math.sin((timeMs / periodMs) * Math.PI * 2) * amplitude;
}

/**
 * Where a layer of the moving preview sits for a camera at `offset` (a share of the stage's width) and
 * `zoom`: the engine's parallax, which moves a layer by its share of the camera's movement and zooms it
 * by its share of the camera's zoom (narraleaf-react `cameraParallax.ts`).
 */
export function layerSwayTransform(follow: number, offset: number, zoom: number, stageWidth: number): string {
    const scale = Math.max(0.05, 1 + follow * (zoom - 1));
    return `translate3d(${(-offset * follow * stageWidth).toFixed(2)}px, 0, 0) scale(${scale.toFixed(4)})`;
}
