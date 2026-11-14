import { WindowAppType } from "@shared/types/window";
import { normalizeProjectPath } from "@shared/utils/recentProject";

import type { AppWindow } from "./appWindow";

/** The refusal code for a project some window has open, which the launcher says in its own words. */
export const RECENT_PROJECT_OPEN = "recent-project-open";

/**
 * The remembered project a launcher request names, held to the two conditions every act on a
 * project from outside it shares.
 *
 * **Only the launcher, and only one of its rows.** The launcher has no project of its own, so the
 * history is the guard: a renderer talked into asking can point this at a folder the author already
 * opened as a project and at nothing else - not a home directory, not another window's project by
 * some other spelling. Comparison goes through `normalizeProjectPath` for the same reason the reveal
 * handler's does.
 *
 * **Never one that is open.** Every caller changes the project underneath whoever holds it - its
 * server address, or its whole folder - and a workspace that has it open would go on working from
 * what it read, then write that back.
 *
 * Answers the history's own spelling of the path, which is the one the rest of the app keys on.
 */
export function requireIdleRecentProject(window: AppWindow, projectPath: string): string {
    if (window.getWindowType() !== WindowAppType.Launcher) {
        throw new Error("Only the launcher may change a remembered project from outside it.");
    }
    const wanted = normalizeProjectPath(projectPath);
    const known = window.app.globalState.recentlyOpened.list()
        .find(project => normalizeProjectPath(project.path) === wanted);
    if (!wanted || !known) {
        throw new Error("Refusing to change a folder that is not a remembered project.");
    }
    if (window.app.findWorkspaceForProject(known.path) || window.app.projectHeldElsewhere(known.path)) {
        throw Object.assign(new Error("This project is open in a window. Close it first."), { code: RECENT_PROJECT_OPEN });
    }
    return known.path;
}
