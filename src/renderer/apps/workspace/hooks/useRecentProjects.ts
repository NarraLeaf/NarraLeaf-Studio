import { useCallback } from "react";
import { getInterface } from "@/lib/app/bridge";

// The list itself is shared with the launcher - same history, same live subscription.
export { useRecentProjects, useRemoveRecentProject } from "@/lib/app/hooks/useRecentProjects";

type OpenRecentOptions = {
    /** Close the current window once the target opens - a "switch in this window". */
    replaceCurrentWindow?: boolean;
};

/**
 * Open a project from the recent list. Focuses an already-open window instead of duplicating it
 * (see the main-process `App.openProject`), so one project stays one window however it was
 * reached. Rejections are swallowed after logging - a failed open should never take down the
 * surface that triggered it.
 *
 * `replaceCurrentWindow` is opt-in and deliberately unused by the switcher: opening another
 * project is not a request to close the one you are in.
 */
export function useOpenRecentProject(): (projectPath: string, options?: OpenRecentOptions) => Promise<void> {
    return useCallback(async (projectPath: string, options?: OpenRecentOptions) => {
        try {
            const result = await getInterface().workspace.openRecent(projectPath, options?.replaceCurrentWindow);
            if (!result.success) {
                console.error("[recent] Failed to open recent project:", result.error);
            }
        } catch (error) {
            console.error("[recent] Failed to open recent project:", error);
        }
    }, []);
}
