import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";

/**
 * Whether this workspace may enter a live session right now.
 *
 * A live session freezes the workspace itself - everything but the story document it is about - and
 * that freeze is a **module-level singleton**: freezing again with a new reason replaces the old
 * one. So joining a session in a workspace that is already frozen for some other reason would not
 * add a second latch, it would quietly lift the first. Joining mid-merge is the worst of them: the
 * merge freeze is the only thing stopping an auto-save writing the author's own side of a
 * conflicted file over the merge's result, and nothing on screen would say it had gone.
 *
 * So the answer is to refuse, and to say which state is in the way - the four freezes have four
 * different ways out and none of them is "unfreeze" in general.
 *
 * Kept as a function of the reason alone, with no service and no server in it, because both entry
 * points ask the same question at different moments (opening a session, and being offered one to
 * join) and a check written twice is a check that will one day be written once.
 */

/** Why a live session may not be entered, as a key the caller reads a sentence out of. */
export type LiveSessionEntryRefusal = {
    /** The freeze standing in the way. */
    frozenBy: WorkspaceFreezeReason["kind"];
    /** The catalog key of what the author is told. */
    message: LiveSessionRefusalKey;
};

export type LiveSessionRefusalKey =
    | "workspace.shell.team.liveBlockedRevision"
    | "workspace.shell.team.liveBlockedManual"
    | "workspace.shell.team.liveBlockedMerge"
    | "workspace.shell.team.liveBlockedRecovery"
    | "workspace.shell.team.liveBlockedSession";

/**
 * A sentence per freeze, exhaustive over the kinds.
 *
 * A record rather than a chain of comparisons: a new kind of freeze does not compile until somebody
 * has decided what it means for a session, and defaulting would mean a future freeze silently
 * allowing one.
 */
const REFUSALS: Record<WorkspaceFreezeReason["kind"], LiveSessionRefusalKey> = {
    revision: "workspace.shell.team.liveBlockedRevision",
    manual: "workspace.shell.team.liveBlockedManual",
    merge: "workspace.shell.team.liveBlockedMerge",
    recovery: "workspace.shell.team.liveBlockedRecovery",
    // Already in one. Its freeze is this project's, and a second session would take the first one's
    // writable path set away from it while the host was still broadcasting effects for it.
    "live-session": "workspace.shell.team.liveBlockedSession",
};

/**
 * The refusal standing in the way of opening or joining a live session, or null when there is none.
 *
 * Consulted by the controls **and** by the acts behind them. The controls hide themselves so nobody
 * presses a dead button; the acts ask again because a keybinding, a plugin or a stale panel reaches
 * them without passing a control.
 */
export function refuseLiveSessionEntry(
    reason: WorkspaceFreezeReason | null,
): LiveSessionEntryRefusal | null {
    if (reason === null) {
        return null;
    }
    return { frozenBy: reason.kind, message: REFUSALS[reason.kind] };
}
