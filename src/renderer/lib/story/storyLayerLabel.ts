import type { ResolvedStoryLayer, StorySceneLayer } from "@shared/types/story";
import { sceneLayerFollow } from "@shared/types/story";
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

/** How much of the camera's movement a layer follows, as a whole percentage. */
export function storyLayerFollowPercent(layer: StorySceneLayer): number {
    return Math.round(sceneLayerFollow(layer) * 100);
}

/** "Follows 30% of the camera", in the interface language. */
export function storyLayerFollowLabel(layer: StorySceneLayer): string {
    return translate("story.sceneLayers.follow", { percent: String(storyLayerFollowPercent(layer)) });
}
