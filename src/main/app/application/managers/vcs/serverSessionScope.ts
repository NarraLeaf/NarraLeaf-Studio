/**
 * Which project may act as which server account.
 *
 * A sign-in is the machine's: the backend keeps one per account in a per-user store outside any
 * repository, and the backend itself will present it for any repository whose calls carry that
 * account's id. So the only place a project can be told apart from another project on the same
 * server is here, in what Studio decides to put in those calls. This module is that decision, kept
 * free of the backend and of Electron so it can be read - and tested - on its own.
 *
 * **The rule.** A sign-in serves a project only after the author has said it does, and the answer
 * is kept per (server origin, project directory) - see `VcsSessionUse` for why the directory and
 * not the project's own identifier. The first request a project makes that needs the sign-in is
 * where the question is put; a yes is remembered and bound to the account it was given for, a no
 * is remembered too, and nothing is remembered for a question closed without an answer.
 *
 * **Existing sign-ins need nothing special.** One stored before this record existed has no rows,
 * which is exactly the state of a project that has never been asked - so every project that used
 * to borrow it is asked once, on its first request, and none of them loses it silently.
 */
import path from "path";
import type { VcsServerSession, VcsSessionUse, VcsSessionUser } from "@shared/types/vcs";
import { normalizeProjectPath } from "@shared/utils/recentProject";

/** Where the answers are kept in the global state. */
export const SESSION_USES_KEY = "versionControl.serverSessionProjects" as const;

/** The project half of the pair: the directory, through the one identity rule the app shares. */
export function sessionUseProjectKey(projectPath: string): string {
    return normalizeProjectPath(path.resolve(projectPath));
}

/**
 * Where one project stands with the sign-in held for its server.
 *
 *  - `none`: this installation holds no sign-in for that server, or the project has none.
 *  - `granted`: the author said this project uses it, for the account that is signed in now.
 *  - `declined`: the author said this project does not use it.
 *  - `undecided`: nobody has asked, or the answer was given for an account that is no longer the
 *    one signed in there. The account is the thing agreed to, so a yes does not carry over to a
 *    different one.
 */
export type SessionStanding =
    | { kind: "none" }
    | { kind: "granted"; session: VcsServerSession }
    | { kind: "declined"; session: VcsServerSession }
    | { kind: "undecided"; session: VcsServerSession };

/**
 * How eager a request is to put the question.
 *
 *  - `read`: never. A panel drawing itself, the author named on a version - nothing that happens
 *    without the author pressing something may raise a window.
 *  - `first-use`: only where nobody has answered. Send, Get, Check: pressed every working day, so
 *    a no must stay a no rather than come back on every press.
 *  - `explicit`: whenever the project does not use it. The author is choosing this server now -
 *    connecting the project to it, or asking to use the sign-in from the Team panel - and an
 *    earlier no was about a question they are asking again.
 */
export type SessionAskMode = "read" | "first-use" | "explicit";

/** The rows as stored, with anything that is not one dropped rather than trusted. */
export function readSessionUses(stored: unknown): VcsSessionUse[] {
    if (!Array.isArray(stored)) return [];
    return stored.filter((row): row is VcsSessionUse => (
        typeof row === "object" && row !== null
        && typeof (row as VcsSessionUse).remoteOrigin === "string"
        && typeof (row as VcsSessionUse).project === "string"
        && typeof (row as VcsSessionUse).projectPath === "string"
        && ((row as VcsSessionUse).userId === null || typeof (row as VcsSessionUse).userId === "string")
    ));
}

export function sessionStanding(input: {
    sessions: readonly VcsServerSession[];
    uses: readonly VcsSessionUse[];
    remoteOrigin: string | null | undefined;
    projectPath: string;
}): SessionStanding {
    const { remoteOrigin } = input;
    if (!remoteOrigin) return { kind: "none" };
    const session = input.sessions.find((each) => each.remoteOrigin === remoteOrigin);
    if (!session) return { kind: "none" };

    const project = sessionUseProjectKey(input.projectPath);
    const use = input.uses.find((row) => row.remoteOrigin === remoteOrigin && row.project === project);
    if (!use) return { kind: "undecided", session };
    if (use.userId === null) return { kind: "declined", session };
    return use.userId === session.account.userId
        ? { kind: "granted", session }
        : { kind: "undecided", session };
}

/** Whether a request made in `mode` puts the question to a project standing where it does. */
export function shouldAskForSessionUse(standing: SessionStanding, mode: SessionAskMode): boolean {
    if (mode === "read") return false;
    if (standing.kind === "undecided") return true;
    return mode === "explicit" && standing.kind === "declined";
}

/** The rows with this pair's answer in place of whatever it said before. */
export function withSessionUse(
    uses: readonly VcsSessionUse[],
    answer: { remoteOrigin: string; projectPath: string; userId: string | null; at: number },
): VcsSessionUse[] {
    const project = sessionUseProjectKey(answer.projectPath);
    return [
        ...uses.filter((row) => !(row.remoteOrigin === answer.remoteOrigin && row.project === project)),
        {
            remoteOrigin: answer.remoteOrigin,
            project,
            projectPath: path.resolve(answer.projectPath),
            userId: answer.userId,
            decidedAt: answer.at,
        },
    ];
}

/** The rows without this pair's answer, as though it had never been asked. */
export function withoutSessionUse(
    uses: readonly VcsSessionUse[],
    remoteOrigin: string,
    projectPath: string,
): VcsSessionUse[] {
    const project = sessionUseProjectKey(projectPath);
    return uses.filter((row) => !(row.remoteOrigin === remoteOrigin && row.project === project));
}

/** The rows with every answer about one server gone, for when the server itself is removed. */
export function withoutSessionUsesAt(uses: readonly VcsSessionUse[], remoteOrigin: string): VcsSessionUse[] {
    return uses.filter((row) => row.remoteOrigin !== remoteOrigin);
}

/**
 * The projects a sign-in serves, named the way the recent-projects list names them.
 *
 * Only rows for the account signed in now: a yes given to an earlier account at the same address
 * serves nobody until it is given again.
 */
export function sessionUsers(
    uses: readonly VcsSessionUse[],
    session: VcsServerSession,
    nameOf: (projectPath: string) => string | null,
): VcsSessionUser[] {
    return uses
        .filter((row) => row.remoteOrigin === session.remoteOrigin && row.userId === session.account.userId)
        .map((row) => ({
            path: row.projectPath,
            name: nameOf(row.projectPath) || path.basename(row.projectPath) || row.projectPath,
        }));
}
