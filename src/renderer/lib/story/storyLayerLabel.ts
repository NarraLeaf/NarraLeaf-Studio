import type { ResolvedStoryLayer, StorySceneLayer } from "@shared/types/story";
import { sceneLayerDistance, STORY_LAYER_DISTANCE_MAX, STORY_LAYER_DISTANCE_MIN } from "@shared/types/story";
import { translate } from "@/lib/i18n";

/**
 * A resolved layer as the author reads it: the two built-in layers by their names in the interface
 * language, one of the scene's own by the name the scene gives it.
 *
 * `resolveStoryLayerRef` answers a fixed English word for the built-ins because it lives in shared
 * code that has no language; every surface that shows one to the author goes through here instead.
 */
export function storyLayerLabel(resolved: ResolvedStoryLayer): string {
    if (resolved.kind === "default") {
        return resolved.layer === "background"
            ? translate("story.layerField.backgroundName")
            : translate("story.layerField.defaultName");
    }
    return resolved.name || translate("story.sceneLayers.unnamed");
}

/** A layer of the scene's stack as the author reads it. */
export function storySceneLayerLabel(layer: StorySceneLayer): string {
    if (layer.kind === "custom") {
        return layer.name || translate("story.sceneLayers.unnamed");
    }
    return layer.kind === "background"
        ? translate("story.layerField.backgroundName")
        : translate("story.layerField.defaultName");
}

/**
 * A distance as the interface writes it: `∞` for a layer that does not move with the camera, and
 * otherwise as many decimals as its size calls for - two below the characters' distance, one up to
 * ten, none beyond.
 */
export function formatLayerDistance(distance: number): string {
    if (!Number.isFinite(distance)) {
        return "∞";
    }
    const decimals = distance < 1 ? 2 : distance < 10 ? 1 : 0;
    return String(Number(distance.toFixed(decimals)));
}

/** A typed distance, or null when it is not one: a number within range, or `∞` (also `inf`). */
export function parseLayerDistance(text: string): number | null {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === "∞" || trimmed === "inf" || trimmed === "infinity") {
        return Infinity;
    }
    if (!/^\d*\.?\d+$/.test(trimmed)) {
        return null;
    }
    const value = Number(trimmed);
    return value >= STORY_LAYER_DISTANCE_MIN && value <= STORY_LAYER_DISTANCE_MAX ? value : null;
}

/** "Distance 3", in the interface language. */
export function storyLayerDistanceLabel(layer: StorySceneLayer): string {
    return translate("story.sceneLayers.distance", { value: formatLayerDistance(sceneLayerDistance(layer)) });
}
