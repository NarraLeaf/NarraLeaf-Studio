import type { StorySceneLayer } from "@shared/types/story";
import { sceneLayerDistance, STORY_LAYER_DISTANCE_MAX, STORY_LAYER_DISTANCE_MIN } from "@shared/types/story";

/** A layer of the stack, keyed the way the layer view tells its layers apart. */
export function sceneLayerKey(layer: StorySceneLayer): string {
    return layer.kind === "custom" ? `custom:${layer.id}` : layer.kind;
}

/** How much closer together the far side of the view draws distances the farther they go. */
const FAR_COMPRESSION = 0.6;
/** How far behind the farthest distance that still moves the layers that do not move are drawn. */
const STILL_GAP = 0.35;

/**
 * Where a layer at `distance` is drawn along the layer view's depth, in units of the view's depth: 0
 * at the characters, positive in front of them, negative behind.
 *
 * Nearer than the characters it is the distance's logarithm, so halving a distance always moves a
 * layer the same way. Behind them the logarithm is drawn closer together the farther it goes, so the
 * far layers stay in view; a layer that does not move with the camera sits a step behind the farthest
 * one that does, the same place whatever else the stack holds.
 */
export function layerDepthAt(distance: number): number {
    if (!(distance < Infinity)) {
        return layerDepthAt(STORY_LAYER_DISTANCE_MAX) - STILL_GAP;
    }
    const log = Math.log(Math.max(STORY_LAYER_DISTANCE_MIN, distance));
    return log <= 0 ? -log : -log / (1 + FAR_COMPRESSION * log);
}

/**
 * The distance drawn at `depth`, as a drag reads it: {@link layerDepthAt} inverted and held to the
 * range, and past halfway to the place of the layers that do not move, one of them.
 */
export function layerDistanceAtDepth(depth: number): number {
    const farthest = layerDepthAt(STORY_LAYER_DISTANCE_MAX);
    if (depth < farthest - STILL_GAP / 2) {
        return Infinity;
    }
    if (depth >= 0) {
        return Math.max(STORY_LAYER_DISTANCE_MIN, Math.exp(-depth));
    }
    const held = Math.max(farthest, depth);
    return Math.min(STORY_LAYER_DISTANCE_MAX, Math.exp(-held / (1 + FAR_COMPRESSION * held)));
}

/**
 * A dragged distance at the step its size reads in - twentieths below the characters' distance,
 * tenths up to 4, halves up to 10, then whole numbers and fives - so a drag leaves numbers an author
 * can compare at a glance.
 */
export function roundLayerDistance(distance: number): number {
    if (!(distance < Infinity)) {
        return distance;
    }
    const step = distance < 1 ? 0.05 : distance < 4 ? 0.1 : distance < 10 ? 0.5 : distance < 30 ? 1 : 5;
    return Number((Math.round(distance / step) * step).toFixed(2));
}

/** Where each layer of the stack is drawn along the view's depth: at its distance, so the layers of one level share a plane. */
export function layerStackDepths(stack: readonly StorySceneLayer[]): number[] {
    return stack.map(layer => layerDepthAt(sceneLayerDistance(layer)));
}

/**
 * The camera position of the moving preview at a moment, as a share of the stage's width: a slow
 * sway from side to side, the motion that shows a layer's distance most plainly.
 */
export function layerSwayOffset(timeMs: number, periodMs = 4200, amplitude = 0.05): number {
    return Math.sin((timeMs / periodMs) * Math.PI * 2) * amplitude;
}
