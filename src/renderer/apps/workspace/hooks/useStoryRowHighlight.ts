import { useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import {
    resolveStoryRowHighlight,
    STORY_ROW_HIGHLIGHT_DEFAULT,
    STORY_ROW_HIGHLIGHT_KEY,
    type StoryRowHighlight,
} from "@/lib/settings/storyRowHighlightOptions";

/**
 * Reads the `editor.storyRowHighlight` preference — which of the story editor's two layers, if
 * either, wears a background tint.
 *
 * Re-reads when the window regains focus so a change made in the separate Settings window applies as
 * soon as the author returns, mirroring `useHideParamNames` (no cross-window push).
 */
export function useStoryRowHighlight(): StoryRowHighlight {
    const [value, setValue] = useState<StoryRowHighlight>(STORY_ROW_HIGHLIGHT_DEFAULT);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const result = await getInterface().app.state.getGlobalState(STORY_ROW_HIGHLIGHT_KEY);
                if (cancelled) {
                    return;
                }
                setValue(resolveStoryRowHighlight(result.success ? result.data.value : undefined));
            } catch {
                // Keep the last known-good value on transient IPC failures.
            }
        };
        void load();
        const onFocus = () => { void load(); };
        window.addEventListener("focus", onFocus);
        return () => {
            cancelled = true;
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    return value;
}
