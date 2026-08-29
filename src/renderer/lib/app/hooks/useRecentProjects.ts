import { useCallback, useEffect, useState } from "react";
import { getInterface } from "@/lib/app/bridge";
import type { MissingRecentProject, RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { normalizeProjectPath, withRecentProjectNames } from "@shared/utils/recentProject";

const RECENT_PROJECTS_KEY = "app.recentProjects";

/**
 * The recently-opened projects, kept live. Read once on mount, then refreshed whenever the main
 * process broadcasts a change to the history, so no surface shows a stale list.
 *
 * The subscription is the point, and it is why this lives in the shared lib rather than in one
 * app: the history is global, so any window can change it at any time - another window opening a
 * project, or the launcher removing one. A surface that only read it at mount would keep offering
 * projects that are gone and miss ones that were just added.
 *
 * Both paths in run through `withRecentProjectNames`. The stored value is not this window's to
 * trust: it comes straight out of `app.recentProjects` without passing the main process's own
 * `RecentlyOpened.list`, and a record whose name never got written used to throw in the launcher's
 * avatar helper and take the whole app down with it. This is the single seam every renderer
 * consumer of the history goes through, so repairing it here repairs all of them.
 */
export function useRecentProjects(): RecentlyOpenedProject[] {
    const [recentProjects, setRecentProjects] = useState<RecentlyOpenedProject[]>([]);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            try {
                const result = await getInterface().app.state.getGlobalState(RECENT_PROJECTS_KEY);
                if (!cancelled && result.success) {
                    setRecentProjects(withRecentProjectNames(result.data.value ?? []));
                }
            } catch (error) {
                console.error("[recent] Failed to load recent projects:", error);
            }
        })();

        const token = getInterface().app.state.onGlobalStateChanged((change) => {
            if (change.key === RECENT_PROJECTS_KEY) {
                setRecentProjects(withRecentProjectNames((change.value as RecentlyOpenedProject[] | null) ?? []));
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
 * Show a remembered project's folder in the OS file manager.
 *
 * Returns the failure message rather than swallowing it, unlike the remove above: removing is a
 * change the list itself reports back, so a silent failure is visible, while a folder that never
 * opened leaves nothing on screen to notice. `null` means it worked; an empty string means it
 * failed without saying why, and the caller supplies the wording - same contract as the launcher's
 * other project actions.
 */
export function useRevealRecentProject(): (projectPath: string) => Promise<string | null> {
    return useCallback(async (projectPath: string) => {
        try {
            const result = await getInterface().app.revealRecentProject(projectPath);
            return result.success ? null : (result.error ?? "");
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }, []);
}

/**
 * Each remembered project's own app icon as a `data:` URL, keyed by normalized path.
 *
 * A project that ships a logo is drawn by it rather than by the two letters of its name, which is
 * what every project used to get. Absent from the map means "no logo to draw" - a project that
 * never set one, or one whose icon we could not read - and the surface falls back to the monogram.
 *
 * Resolved by the main process from each project's own `metadata.icons`, not carried in the
 * history record: the logo is project content and changes without the history being touched, so a
 * copy stored alongside the path would show the previous one until the project was opened again.
 *
 * Read again whenever the history changes - which is what puts an icon on a project the moment it
 * is opened for the first time - and whenever this window is focused. The second one is what makes
 * changing a logo visible: an author sets one in the workspace's Project panel and then looks at
 * the title bar's switcher or the launcher, and neither of those is a new window, so without it
 * they would keep showing the folder glyph until Studio was restarted.
 */
export function useRecentProjectIcons(): ReadonlyMap<string, string> {
    const [icons, setIcons] = useState<ReadonlyMap<string, string>>(new Map());

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            try {
                const result = await getInterface().app.recentProjectIcons();
                if (!cancelled && result.success) {
                    setIcons(new Map(result.data.icons.map(
                        entry => [normalizeProjectPath(entry.path), entry.icon],
                    )));
                }
            } catch (error) {
                // Decoration only: the list is perfectly usable in monograms.
                console.error("[recent] Failed to read recent project icons:", error);
            }
        };

        const reload = () => void load();

        reload();
        window.addEventListener("focus", reload);
        const token = getInterface().app.state.onGlobalStateChanged((change) => {
            if (change.key === RECENT_PROJECTS_KEY) {
                reload();
            }
        });

        return () => {
            cancelled = true;
            window.removeEventListener("focus", reload);
            token.cancel();
        };
    }, []);

    return icons;
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
