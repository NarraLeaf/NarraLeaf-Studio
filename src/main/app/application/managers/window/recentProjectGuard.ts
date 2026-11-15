import type { Dirent } from "fs";
import path from "path";

import type { RecentProjectMissingReason } from "@shared/types/state/appStateTypes";
import { WindowAppType } from "@shared/types/window";
import { DirEntry, findProjectConfigFileName } from "@shared/utils/nlproj";
import {
    PROJECT_FOLDER_MISSING,
    PROJECT_NOT_A_PROJECT,
    TEAM_PROJECT_SIGNED_OUT,
    type ProjectOpenRefusal,
} from "@shared/utils/projectOpenRefusal";
import { normalizeProjectPath } from "@shared/utils/recentProject";

import { unpatchedFsPromises as fs } from "../../../../utils/unpatchedFs";
import { readRemoteOrigin } from "../vcs/localRepositories";

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

/**
 * Whether a remembered project is still openable, or why it is not.
 *
 * Only *absence* answers "missing". A folder we were not allowed to read (macOS TCC, a network
 * mount without permission) or one on a volume that is offline is still perfectly good work, and
 * reporting it as gone would put the user in front of a dialog offering to forget a real project.
 * So ENOENT/ENOTDIR are the only failures that count; everything else reads as present and the
 * user finds out the usual way - by opening it.
 */
export async function findRecentProjectMissingReason(projectPath: string): Promise<RecentProjectMissingReason | null> {
    let entries: Dirent[];
    try {
        const stats = await fs.stat(projectPath);
        if (!stats.isDirectory()) {
            // Something is there, but a project is a folder - a file at that path is not one.
            return "not-a-project";
        }
        entries = await fs.readdir(projectPath, { withFileTypes: true });
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === "ENOENT" || code === "ENOTDIR" ? "folder-missing" : null;
    }

    const dirEntries = entries.map<DirEntry>(entry => ({
        name: path.parse(entry.name).name,
        ext: path.extname(entry.name) || null,
        type: entry.isDirectory() ? "directory" : "file",
    }));

    return findProjectConfigFileName(dirEntries) ? null : "not-a-project";
}

/** The two things a workspace's open has to know, handed in so the rule is testable. */
export interface ProjectOpenFacts {
    missingReason(projectPath: string): Promise<RecentProjectMissingReason | null>;
    /** The server origin the project's repository names, if it names one. */
    remoteOrigin(projectPath: string): string | undefined;
    /** Whether this machine holds a sign-in for that origin. */
    signedIn(remoteOrigin: string): boolean;
}

/** Why the project cannot be opened, or null when it can. */
export async function findProjectOpenRefusal(facts: ProjectOpenFacts, projectPath: string): Promise<ProjectOpenRefusal | null> {
    const missing = await facts.missingReason(projectPath);
    if (missing === "folder-missing") return PROJECT_FOLDER_MISSING;
    if (missing === "not-a-project") return PROJECT_NOT_A_PROJECT;
    const origin = facts.remoteOrigin(projectPath);
    if (origin !== undefined && !facts.signedIn(origin)) return TEAM_PROJECT_SIGNED_OUT;
    return null;
}

/** The facts as this installation has them: the disk, and the sign-ins it holds. */
export function projectOpenFacts(window: AppWindow): ProjectOpenFacts {
    return {
        missingReason: findRecentProjectMissingReason,
        remoteOrigin: projectPath => readRemoteOrigin(path.resolve(projectPath)),
        signedIn: origin => window.app.getVcsManager().listServers().some(session => session.remoteOrigin === origin),
    };
}

/**
 * Refuse to open, from a workspace, a project the launcher would have stopped at its gate.
 *
 * The launcher puts each case to the author as a choice before anything opens (relocate or forget a
 * missing folder; convert or delete a team project this machine has signed out of). A workspace's
 * routes into another project - the title-bar switcher, File > Open Recent in either menu, and
 * opening a folder by hand - have no such dialog, and used to open the project anyway: a team
 * project with no server behind it, or a window over a folder that is not there.
 *
 * Only a workspace opener is held to it: the launcher asks first and offers the way out, and a
 * project that already has a window is focused rather than opened, which is no harm whatever state
 * it is in. Throws an Error whose `code` is the refusal.
 */
export async function requireOpenableFromWorkspace(window: AppWindow, projectPath: string): Promise<void> {
    if (window.getWindowType() !== WindowAppType.Workspace) return;
    if (window.app.findWorkspaceForProject(projectPath)) return;
    const refusal = await findProjectOpenRefusal(projectOpenFacts(window), projectPath);
    if (refusal !== null) {
        throw Object.assign(new Error(`Refusing to open ${projectPath}: ${refusal}`), { code: refusal });
    }
}
