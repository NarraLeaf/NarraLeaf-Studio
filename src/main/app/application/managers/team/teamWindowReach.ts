/**
 * Which window may speak to a Team server as this installation's account, and about what.
 *
 * # Why the window is the thing asked about
 *
 * A server is reached with the account's sign-in, and that sign-in is the machine's: one per
 * server, sealed in the main process, presented by `TeamManager` on behalf of whoever asks. The
 * author's rule is that it serves a (server, project) pair only once they have said so for that
 * project - `serverSessionScope.ts` keeps the answers - and the version-control channels honour it
 * in `VcsManager`. The Team channels are a pipe that carries any method to any server, so the only
 * place that rule can be applied to them is here, before the pipe, against the window that asked.
 * The workspace already opens collaboration only for a project that said yes; that is an interface
 * default, and every window can send an IPC message whatever its interface does.
 *
 * # The five kinds of window
 *
 *  - **The launcher** is the account's own console for a server: the list of what is on it, its
 *    people, its discussions, joining a room. None of that acts for a project on this disk - it is
 *    the author acting as the account they signed in with, in a window that renders nothing a
 *    project supplied. It reaches every method but bytes.
 *  - **Settings and the project wizard** only ever list what a server holds: Settings counts a
 *    server's projects once it has been added, and the wizard's server picker lists them so one can
 *    be cloned - before any project here exists, so before any project could have answered. Both are
 *    Studio's own windows with no project in them, and `projects.list` is all they are given: a
 *    listing is the one thing the "before a project has answered" moment needs.
 *  - **A workspace** acts for its project and for nothing else. It reaches a server only where the
 *    author said that project uses the sign-in held there. Anywhere else it may only let go of what
 *    it said while it did - see {@link TEAM_LETTING_GO} - because the moment an author says no is
 *    exactly the moment its screen tidies up after itself.
 *  - **Everything else** - Dev Mode, which runs the project's own scripts, the prompts and the raw
 *    window - reaches nothing. None of them has a reason to, so none is given one.
 *
 * `admin.*` is refused to every window: the contract names those methods and Studio calls none of
 * them, so a window asking one is not Studio asking, and on an operator's account it would be the
 * account's power over the server itself.
 */
import { TeamMethod } from "@shared/types/team";
import {
    WINDOW_SERVER_OFF_LIMITS_CODE,
    WINDOW_SIGN_IN_UNUSED_CODE,
    WindowAppType,
} from "@shared/types/window";

import type { AppWindow } from "../window/appWindow";

/** Where one window stands with one server. */
export type TeamReach =
    /** The launcher: the account itself. */
    | { kind: "account" }
    /** Settings and the wizard: listing what the server holds and nothing more. */
    | { kind: "listing" }
    /** A workspace whose project uses the sign-in held for that server. */
    | { kind: "project"; projectPath: string }
    /** A workspace whose project does not: never asked, answered no, or no sign-in there at all. */
    | { kind: "unused"; projectPath: string }
    /** A window that does not speak to servers. */
    | { kind: "none" };

/** What a window is asking to do. */
export type TeamAsk =
    | { op: "open" }
    | { op: "connections" }
    | { op: "call"; method: string }
    | { op: "subscribe" }
    | { op: "transfer" };

/**
 * The calls that only take back something this window said, and are answered even where the project
 * has stopped using the sign-in.
 *
 * **Why these are not held to the rule.** The author says "do not use this sign-in" from the Team
 * panel of a window that is, at that moment, announced on the server and possibly in a room. The
 * panel stops following the server and takes its presence back on the way out - and it is only after
 * the answer was recorded that it does. Refusing the withdrawal would leave this machine listed as
 * present on a project the author just took off the server, and the socket replays an announcement
 * on every reconnect until something withdraws it. So these two pass, **over a session that is
 * already open and never one opened for them** - letting go of nothing needs no sign-in.
 */
export const TEAM_LETTING_GO: ReadonlySet<string> = new Set<string>([
    TeamMethod.clientsWithdraw,
    TeamMethod.liveLeave,
]);

/** The one call Settings and the wizard are given. */
const LISTING_METHODS: ReadonlySet<string> = new Set<string>([TeamMethod.projectsList]);

/** Methods no window reaches. See the note at the top of this file. */
function isAdministration(method: string): boolean {
    return method.startsWith("admin.");
}

/**
 * Where a window stands with a server, from what the main process knows about both.
 *
 * `usesSignIn` is the recorded answer for the window's project at that server - true only for a yes
 * given for the account signed in there now. It is asked only of a workspace, and only where there is
 * a server to ask about.
 */
export function teamReach(input: {
    windowType: WindowAppType;
    projectPath: string | null;
    remoteOrigin: string | null;
    usesSignIn: (projectPath: string, remoteOrigin: string) => boolean;
}): TeamReach {
    switch (input.windowType) {
        case WindowAppType.Launcher:
            return { kind: "account" };
        case WindowAppType.Settings:
        case WindowAppType.ProjectWizard:
            return { kind: "listing" };
        case WindowAppType.Workspace: {
            const projectPath = input.projectPath;
            // A workspace always has a project. One that somehow does not has nothing to act for.
            if (projectPath === null) return { kind: "none" };
            const granted = typeof input.remoteOrigin === "string"
                && input.remoteOrigin.length > 0
                && input.usesSignIn(projectPath, input.remoteOrigin);
            return granted ? { kind: "project", projectPath } : { kind: "unused", projectPath };
        }
        default:
            return { kind: "none" };
    }
}

/** Whether a window standing where it does may do what it asks. */
export function teamAllows(reach: TeamReach, ask: TeamAsk): boolean {
    if (ask.op === "call" && isAdministration(ask.method)) return false;
    switch (reach.kind) {
        case "account":
            // Everything but bytes: a transfer reads or writes a file of a project, and the launcher
            // has no project for a file to be in.
            return ask.op !== "transfer";
        case "listing":
            return ask.op === "call" && LISTING_METHODS.has(ask.method);
        case "project":
            // Not the list of every server: that is the launcher's picture of the machine, and a
            // project has one server it is about.
            return ask.op !== "connections";
        case "unused":
        case "none":
            return false;
    }
}

/** Whether a refused call is one that only lets go - see {@link TEAM_LETTING_GO}. */
export function isLettingGo(reach: TeamReach, ask: TeamAsk): boolean {
    return reach.kind === "unused" && ask.op === "call" && TEAM_LETTING_GO.has(ask.method);
}

/**
 * A Team request refused for the window it came from.
 *
 * The code travels through `IPCHandler.failed` to the renderer, and the IPC registry reads it to
 * write the one throttled line `windowProjectRefusal.ts` writes for every refusal of this family.
 *
 * `sign-in-unused` only where the author's yes would have let the request through; a request no
 * answer would allow - a workspace asking for every server's state, anybody asking an `admin.*`
 * method - is off limits, and saying "this project does not use the sign-in" about it would send
 * the author to a remedy that does not remedy it.
 */
export class TeamReachRefusedError extends Error {
    readonly code: typeof WINDOW_SIGN_IN_UNUSED_CODE | typeof WINDOW_SERVER_OFF_LIMITS_CODE;

    constructor(reach: TeamReach, ask: TeamAsk) {
        const unused = reach.kind === "unused"
            && teamAllows({ kind: "project", projectPath: reach.projectPath }, ask);
        const request = describeAsk(ask);
        super(unused
            ? `This project does not use the sign-in held for that server, so ${request} was not sent.`
            : `This window does not reach servers as the signed-in account for ${request}.`);
        this.code = unused ? WINDOW_SIGN_IN_UNUSED_CODE : WINDOW_SERVER_OFF_LIMITS_CODE;
    }
}

/** A short name for what was asked, for the refusal's sentence. */
function describeAsk(ask: TeamAsk): string {
    return ask.op === "call" ? `the call ${ask.method}` : `team.${ask.op}`;
}

/**
 * Where the calling window stands with a server, or a refusal.
 *
 * @throws TeamReachRefusedError when the window may not do what it asks. A call that only lets go is
 *   not refused: it comes back as `letGo` for the handler to send over a session already open.
 */
export function requireTeamReach(
    window: AppWindow,
    remoteOrigin: string | null,
    ask: TeamAsk,
): { reach: TeamReach; letGo: boolean } {
    const reach = window.app.getTeamManager().reachOf(window, remoteOrigin);
    if (teamAllows(reach, ask)) return { reach, letGo: false };
    if (isLettingGo(reach, ask)) return { reach, letGo: true };
    throw new TeamReachRefusedError(reach, ask);
}
