import { useEffect } from "react";
import { getInterface } from "@/lib/app/bridge";
import { emitStoryRowHighlight } from "./storyRowHighlightBus";

/**
 * Listens for the Dev Mode play head (Dev Mode window → main → workspace) and republishes it on the
 * renderer-local bus. Mounted once at the workspace root; open story editors follow along in place.
 */
export function StoryRowHighlightBridge(): null {
    useEffect(() => {
        const token = getInterface().devMode.onStoryRowHighlight(highlight => {
            emitStoryRowHighlight(highlight);
        });
        return () => token.cancel();
    }, []);

    return null;
}
