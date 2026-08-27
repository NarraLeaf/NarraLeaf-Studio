import { getInterface } from "@/lib/app/bridge";
import { translate } from "@/lib/i18n";
import { findProjectConfigFileName } from "@shared/utils/nlproj";
import type { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import type { WindowAppType, WindowProps } from "@shared/types/window";

/**
 * The launcher's "add project" and "open project" flows.
 *
 * Extracted from the Projects tab so the macOS File menu can drive the same code: the menu is
 * handled at the app level (a tab can be unmounted when the user is on another tab), and two
 * copies of these flows would drift.
 *
 * **Two, and there used to be four.** Getting a project off a server and unpacking one from a
 * package were separate entry points here; they are now cards on the wizard's first page, so the
 * only two questions left are "somewhere on this disk" and "bring one in".
 *
 * Each returns an error message to display, or null when it succeeded or the user cancelled.
 */

/**
 * Raise the wizard, and open whatever comes out of it.
 *
 * The props say which question is already answered: none for the plain "Add project", a
 * `remoteUrl` for a project chosen off a server, where the flow to run is the clone flow and
 * the only thing left to ask is where the copy lands. There is deliberately no second clone
 * path in the launcher - the destination is chosen through the native picker on the wizard's
 * own page, and `storageManager` refuses a folder that was never picked, so a hand-rolled one
 * would be one that cannot write anywhere.
 *
 * `openWith` is what the window that comes out of it is opened for beyond the project itself.
 * Today that is one thing - a live session to join - and it is passed through here rather than
 * acted on afterwards because the launcher retires the moment the workspace opens: there is no
 * "afterwards" in this window to do anything in.
 */
export async function createProjectFromWizard(
    props: WindowProps[WindowAppType.ProjectWizard] = {},
    openWith: Omit<WindowProps[WindowAppType.Workspace], "projectPath"> = {},
): Promise<string | null> {
    const result = await getInterface().app.launchProjectWizard(props);
    if (!result.success) {
        return result.error ?? "";
    }
    if (!result.data?.created) {
        // User cancelled the wizard.
        return null;
    }

    await getInterface().workspace.launch(
        { projectPath: result.data.projectPath, ...openWith },
        true, // Close launcher window after opening workspace
    );
    return null;
}

/**
 * Go and be in somebody else's live session.
 *
 * ⚠ **The launcher cannot join on the workspace's behalf, and this is where that fact lives.**
 * A room's membership is recorded per instance, and a launcher window is a different instance
 * from the workspace it opens - so a launcher that joined would put *itself* in the room and
 * leave the editor outside it. What it can do is the half a workspace cannot: work out which
 * room is meant, get the project if this machine has never had it, and hand the intent over.
 *
 * That is also why every way into a room is here rather than in the workspace. Joining one
 * often begins with cloning, cloning needs a window with no project open, and a control that
 * worked only for the people who already had the project would be the wrong half of a feature.
 *
 * Answers an error message to show, or null - which covers both a window on its way up and a
 * clone the author closed without finishing, neither of which leaves anything to say.
 */
export async function joinLiveSession(input: {
    /** Which room, in the form the workspace will use: an id, or the four digits. */
    joinLive: NonNullable<WindowProps[WindowAppType.Workspace]["joinLive"]>;
    /** Where this machine keeps that project, or null when it has never had it. */
    localPath: string | null;
    /** The repository to clone, for a machine that has not got it. Null when it is not known. */
    remote: string | null;
    /** What to say when there is no copy here and no address to fetch one from. */
    unreachable: string;
}): Promise<string | null> {
    if (input.localPath !== null) {
        await getInterface().workspace.launch(
            { projectPath: input.localPath, joinLive: input.joinLive },
            true,
        );
        return null;
    }
    if (input.remote === null) {
        // A room on a project this server did not list. Nothing here can fetch it, and the
        // sentence has to say that rather than opening a wizard with no address in it.
        return input.unreachable;
    }
    return createProjectFromWizard({ remoteUrl: input.remote }, { joinLive: input.joinLive });
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
