import type { ResolvedStoryLayer, StoryLayerDepth } from "@shared/types/story";
import { DEFAULT_STORY_LAYER_DEPTH } from "@shared/types/story";
import { translate } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";

/**
 * A resolved layer as the author reads it: the two built-in layers by their names in the interface
 * language, a custom layer by the name its `create` row gives it.
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
    return resolved.name || translate("story.layerPanel.unnamed");
}

/** A depth by its name in the interface language; an absent one is the default. */
export function storyLayerDepthLabel(depth: StoryLayerDepth | undefined): string {
    return translate(`story.layerDepth.${depth ?? DEFAULT_STORY_LAYER_DEPTH}` as TranslationKey);
}
