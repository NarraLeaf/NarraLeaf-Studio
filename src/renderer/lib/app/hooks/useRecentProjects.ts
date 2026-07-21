import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { MissingRecentProject, RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { normalizeProjectPath } from "@shared/utils/recentProject";

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

/**
 * Which remembered projects are not on disk, keyed by normalized path. Checked once, when the
 * surface using this mounts.
 *
 * Once per entry into the app is the point: a project can be moved or deleted while the app is
 * closed, and without a sweep the only way to find out is to click the entry and land on an error
 * screen. Checking on the way in lets the list say so up front instead.
 *
 * Reporting only - nothing is pruned here or in the main process. A missing folder is often
 * temporary (an external drive unplugged, a share not mounted yet) and the recorded path is what
 * the user needs to find it again, so what happens to the entry is their call.
 */
export function useMissingRecentProjects(): ReadonlyMap<string, MissingRecentProject> {
    const [missing, setMissing] = useState<ReadonlyMap<string, MissingRecentProject>>(new Map());

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const result = await getInterface().app.checkRecentProjects();
                if (!cancelled && result.success) {
                    setMissing(new Map(result.data.missing.map(
                        project => [normalizeProjectPath(project.path), project],
                    )));
                }
            } catch (error) {
                // A failed sweep is not worth surfacing: the list still works, and every entry in
                // it is verified again the moment it is opened.
                console.error("[recent] Failed to check recent projects:", error);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, []);

    return missing;
}
