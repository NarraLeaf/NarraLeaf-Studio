import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";

const RECENT_PROJECTS_KEY = "app.recentProjects";

/**
 * The recently-opened projects, kept live. Read once on mount, then refreshed whenever the main
 * process broadcasts a change to the history, so no surface shows a stale list.
 *
 * The subscription is the point, and it is why this lives in the shared lib rather than in one
 * app: the history is global, so any window can change it at any time - another window opening a
 * project, or the launcher removing one. A surface that only read it at mount would keep offering
 * projects that are gone and miss ones that were just added.
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

/**
 * Drop a project from the history.
 *
 * Sends the path and lets the main process rebuild the list, rather than writing back a filtered
 * copy of what this window last saw - with several windows open, that copy is stale the moment
 * another one opens a project, and writing it would erase that.
 */
export function useRemoveRecentProject(): (projectPath: string) => Promise<void> {
    return useCallback(async (projectPath: string) => {
        try {
            const result = await getInterface().app.removeRecentProject(projectPath);
            if (!result.success) {
                console.error("[recent] Failed to remove recent project:", result.error);
            }
        } catch (error) {
            console.error("[recent] Failed to remove recent project:", error);
        }
    }, []);
}
