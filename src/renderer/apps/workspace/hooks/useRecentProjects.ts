import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";

const RECENT_PROJECTS_KEY = "app.recentProjects";

/**
 * The recently-opened workspaces, kept live. Read once on mount, then refreshed whenever the main
 * process broadcasts a change to the history (a project opened, or one removed from the launcher),
 * so the title-bar switcher and the File menu never show a stale list.
 */
export function useRecentProjects(): RecentlyOpenedProject[] {
    const [recentProjects, setRecentProjects] = useState<RecentlyOpenedProject[]>([]);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const result = await getInterface().app.state.getGlobalState(RECENT_PROJECTS_KEY);
                if (!cancelled && result.success) {
                    setRecentProjects(result.data.value ?? []);
                }
            } catch (error) {
                console.error("[recent] Failed to load recent projects:", error);
            }
        })();

        const token = getInterface().app.state.onGlobalStateChanged((change) => {
            if (change.key === RECENT_PROJECTS_KEY) {
                setRecentProjects((change.value as RecentlyOpenedProject[] | null) ?? []);
            }
        });

        return () => {
            cancelled = true;
            token.cancel();
        };
    }, []);

    return recentProjects;
}

type OpenRecentOptions = {
    /** Close the current window once the target opens — a "switch in this window". */
    replaceCurrentWindow?: boolean;
};

/**
 * Open a project from the recent list. Focuses an already-open window instead of duplicating it;
 * with `replaceCurrentWindow` it also retires the current window, so switching reuses this window
 * rather than opening alongside (see the main-process `App.openRecentProject`). Rejections are
 * swallowed after logging — a failed switch should never take down the surface that triggered it.
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
