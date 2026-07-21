import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { findProjectConfigFileName } from "@shared/utils/nlproj";
import type { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";

/**
 * The launcher's "new project" and "open project" flows.
 *
 * Extracted from the Projects tab so the macOS File menu can drive the same code: the menu is
 * handled at the app level (a tab can be unmounted when the user is on another tab), and two
 * copies of these flows would drift.
 *
 * Each returns an error message to display, or null when it succeeded or the user cancelled.
 */

export async function createProjectFromWizard(): Promise<string | null> {
    const result = await getInterface().app.launchProjectWizard({});
    if (!result.success) {
        return result.error ?? "";
    }
    if (!result.data?.created) {
        // User cancelled the wizard.
        return null;
    }

    await getInterface().workspace.launch(
        { projectPath: result.data.projectPath },
        true, // Close launcher window after opening workspace
    );
    return null;
}

export async function openProjectFromFolder(): Promise<string | null> {
    const result = await getInterface().selectFolder();
    if (!result.success) {
        return result.error ?? "";
    }
    if (!result.data.path) {
        // User cancelled the folder picker.
        return null;
    }

    await getInterface().workspace.launch(
        { projectPath: result.data.path },
        true,
    );
    return null;
}

export type RelocateProjectResult =
    | { status: "relocated" }
    | { status: "cancelled" }
    | { status: "error"; message: string };

/**
 * Point a recent-list entry at where its project lives now, then open it.
 *
 * The picked folder is checked for a project config *before* the old entry is dropped: relocating
 * is the recovery path for a project that already went missing once, so the one thing it must not
 * do is trade a known path for a wrong one and leave the user with neither.
 *
 * The old entry is then removed rather than edited, because opening the project re-adds it at its
 * new path anyway (see WorkspaceContext) - and removing has to happen first, since launching
 * retires the launcher window and anything queued after it may never run.
 */
export async function relocateRecentProject(project: RecentlyOpenedProject): Promise<RelocateProjectResult> {
    const picked = await getInterface().selectFolder();
    if (!picked.success) {
        return { status: "error", message: picked.error || translate("launcher.projects.errorOpenFolder") };
    }
    if (!picked.data.path) {
        return { status: "cancelled" };
    }

    const newPath = picked.data.path;
    const listed = await getInterface().fs.list(newPath);
    if (!listed.success || !listed.data.ok) {
        return { status: "error", message: translate("launcher.projects.errorOpenFolder") };
    }
    if (!findProjectConfigFileName(listed.data.data)) {
        return { status: "error", message: translate("launcher.projects.missing.errorNotAProject") };
    }

    await getInterface().app.removeRecentProject(project.path);
    await getInterface().workspace.launch({ projectPath: newPath }, true);
    return { status: "relocated" };
}
