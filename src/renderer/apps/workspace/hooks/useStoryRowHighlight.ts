import { useGlobalSetting } from "@/lib/settings/useGlobalSetting";
import {
    resolveStoryRowHighlight,
    STORY_ROW_HIGHLIGHT_KEY,
    type StoryRowHighlight,
} from "@/lib/settings/storyRowHighlightOptions";

/**
 * Reads the `editor.storyRowHighlight` preference — which of the story editor's two layers, if
 * either, wears a background tint.
 *
 * Follows the global-state broadcast, so a change made in the separate Settings window paints the
 * rows behind it while the author is still looking at the option they picked.
 */
export function useStoryRowHighlight(): StoryRowHighlight {
    return useGlobalSetting(STORY_ROW_HIGHLIGHT_KEY, resolveStoryRowHighlight);
}
