import type { App } from "@/app/app";
import type { ProjectSessionHolder } from "@shared/types/projectSession";
import type { ProjectSessionLockManager } from "../managers/projectSessionLockManager";
import { emitWorkspaceConsoleLog } from "./workspaceConsole";

/**
 * The runtimes a Studio does not start on a project another Studio has open.
 *
 * # Why the error screen is not enough on its own
 *
 * A workspace that loses the session claim stops on its error screen before any service starts,
 * and that screen offers nothing but Retry and the launcher. The window itself stays, though, named
 * after the project, and every request the main process takes from it is checked against that name
 * and nothing more - so the window could still start Dev Mode, a preview, a test run or a build.
 *
 * Dev Mode is the one that showed it. It resolves every asset through the project's workspace
 * window, and this one never started, so the Dev Mode window came up black: the title page's text
 * in the interface font, no picture, no background, no project font, a story that never began and
 * an issue bar blaming the project's own images - and nothing anywhere saying the project was open
 * in another Studio. That is a project that looks broken, which is the one thing a refusal must not
 * look like.
 *
 * So the refusal is also held here, where the runtimes start, and it says the one thing that is
 * true. The others are refused for the reason the claim exists at all: each of them writes into the
 * project folder (`.nlstudio/`, `dist/`), which is the other Studio's to write while it has it.
 *
 * # What is asked, and why not "does this Studio hold the lock"
 *
 * {@link ProjectSessionLockManager.heldElsewhere} - whether this Studio's last claim on the project
 * was refused. A project on a read-only volume opens with no lock held by anyone, and must still
 * run; only a project somebody else has is turned away.
 */
export const HELD_ELSEWHERE_OPERATIONS = [
    "Dev Mode",
    "preview",
    "test run",
    "production build",
    "patch export",
] as const;

export type HeldElsewhereOperation = typeof HELD_ELSEWHERE_OPERATIONS[number];

/** Where the other Studio is, in the words the error screen uses for it. */
function describeWhere(holder: ProjectSessionHolder): string {
    return holder.sameHost ? "on this computer" : `on ${holder.hostname}`;
}

export function projectHeldElsewhereMessage(
    operation: HeldElsewhereOperation,
    holder: ProjectSessionHolder,
): string {
    const subject = operation.charAt(0).toUpperCase() + operation.slice(1);
    if (holder.released) {
        // The other Studio took the project and has closed it again since; there is nothing to
        // close there, only this window to open again.
        return `${subject} is unavailable: this project was opened in another NarraLeaf Studio ${describeWhere(holder)}. `
            + "Open the project here again.";
    }
    return `${subject} is unavailable: this project is open in another NarraLeaf Studio ${describeWhere(holder)}. `
        + "Close it there, then open the project here again.";
}

/** The part of the app this gate reads. Structural, so a test can hand it a double. */
export interface ProjectSessionGateHost {
    getProjectSessionLockManager(): Pick<ProjectSessionLockManager, "heldElsewhere">;
}

/**
 * The refusal for `operation` on this project, or `null` when it may run.
 *
 * Returns the message rather than throwing, like the trust gate beside it, so each manager can fail
 * in the shape it already fails in.
 */
export function projectHeldElsewhereRefusal(
    host: ProjectSessionGateHost,
    projectPath: string,
    operation: HeldElsewhereOperation,
): string | null {
    const holder = host.getProjectSessionLockManager().heldElsewhere(projectPath);
    return holder ? projectHeldElsewhereMessage(operation, holder) : null;
}

/**
 * {@link projectHeldElsewhereRefusal}, and put it where it can be found.
 *
 * The workspace console first, like every other refusal a run meets; but the window this usually
 * protects is on its error screen and has no console showing, so the line goes into the main log
 * as well - otherwise "Dev Mode did nothing" is all anyone can find out afterwards.
 */
export function refuseProjectHeldElsewhere(
    app: App,
    projectPath: string,
    operation: HeldElsewhereOperation,
): string | null {
    const message = projectHeldElsewhereRefusal(app, projectPath, operation);
    if (message) {
        app.logger.warn(`[Project] Refused ${operation} on ${projectPath}: it is open in another NarraLeaf Studio.`);
        emitWorkspaceConsoleLog(app, projectPath, { level: "error", source: "Project", message });
    }
    return message;
}
