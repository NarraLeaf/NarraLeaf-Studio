import type { LiveDivergence } from "@/lib/live";
import type { LiveInverseReason } from "@/lib/live/inverse";
import type { LiveSessionEntryRefusal } from "@/lib/team/liveSessionEntry";
import type { LiveOpKind, LiveRefusalReason } from "@shared/live/ops";
import type { StoryBlockId, StoryId } from "@shared/types/story";
import type { TeamLiveSession, TeamProblem } from "@shared/types/team";

/**
 * Everything a live session is willing to say about itself, as one value.
 *
 * **The whole of what the interface renders, and the whole of what it is allowed to know.** Nothing
 * here is a sentence: every member is a fact or a key, and the panel decides how to say it. That is
 * not tidiness - a service that produced prose would produce it in one language, at a moment when
 * nobody knows which surface is going to show it, and the same fact would then be worded twice.
 *
 * Read whole rather than subscribed to piecemeal: a session's state changes as one thing (a message
 * arrives, a phase moves, the room ends) and a panel drawing from six separate readers would show
 * six moments of it at once.
 */

/** Which half of the session this window is. See `decideLiveRole`. */
export type LiveSessionRole = "host" | "guest";

/**
 * Where this window is in a session's life.
 *
 * `catching-up` is a phase of its own rather than a flag on `active`, because it is the one stretch
 * in which this machine's document is knowingly behind: it has joined, it has asked the host for
 * everything since the room opened, and until that arrives what is on screen is the revision the
 * room opened on rather than what the room is looking at.
 */
export type LiveSessionPhase = "idle" | "entering" | "catching-up" | "active" | "leaving";

/** Why a session is over. */
export type LiveSessionEndCause =
    /** This author left it. */
    | "left"
    /**
     * The room is gone. The host holds the only copy that counts, so its window leaving ends the
     * session for everybody - there is no authority left to send an intent to.
     */
    | "host-left"
    /** This machine and the host stopped agreeing about the document. See {@link LiveDivergence}. */
    | "diverged";

export type LiveSessionEnd = {
    cause: LiveSessionEndCause;
    /** The room that ended, so a panel can tell one ending from the next. */
    sessionId: string;
    /**
     * Whether the room itself is gone, rather than this window merely having stepped out of it.
     *
     * ⚠ **`cause` does not answer this and must not be read as though it did.** `left` is true of a
     * guest walking out of a room that carries on without them and of a host closing one, and those
     * are opposite answers to the only question a panel actually has: is this still somewhere
     * anybody can go. A panel that guessed drew a room it had just closed as one to join.
     */
    closed: boolean;
    /** The evidence, for `diverged`. Absent for every other cause. */
    divergence?: LiveDivergence;
};

/**
 * Why entering a session did not happen.
 *
 * Every one of these is a different remedy, which is why they are separate kinds rather than one
 * message: a workspace frozen for a merge has to finish the merge, a machine without the project
 * has to clone it, and a room opened on a revision this tree has moved past cannot be joined at all
 * until somebody re-bases it.
 */
export type LiveEntryFailure =
    /** Already in one. A window holds at most one session. */
    | { kind: "busy" }
    /** The workspace is frozen for something else; `refusal` says which and what to say. */
    | { kind: "frozen"; refusal: LiveSessionEntryRefusal }
    /** This project points at no Team server, so there is no room to open or join. */
    | { kind: "no-server" }
    /** The window has not been given an instance id by the server yet. */
    | { kind: "no-instance" }
    /** No repository, so there is no revision a session could open on. */
    | { kind: "no-repository" }
    /** A repository with no revisions in it. A session needs a starting point that exists. */
    | { kind: "no-revision" }
    /**
     * The room is about a project this window does not have open. Nothing here can be protected
     * because nothing here is at stake: the way in is the clone flow, which belongs to the launcher.
     */
    | { kind: "clone-required"; project: string; revision?: string }
    /**
     * The tree could not be brought to the revision the room opened on - somebody has pushed past
     * it. Joining anyway would put two machines in one room holding different documents, which is
     * the one failure the digest guard exists to catch after the fact.
     */
    | { kind: "revision-mismatch"; expected: string; actual: string | null }
    /** The sync left files a human has to settle. The merge comes first; the session is not urgent. */
    | { kind: "merge-conflicts"; paths: readonly string[] }
    /** The room named is not open on this project any more. */
    | { kind: "room-gone"; sessionId: string }
    /**
     * The room does not say which document it is about, so there is nothing to follow.
     *
     * Only a room opened by a Studio older than the field, against a server older than the
     * requirement. Refused rather than guessed at: the only document this window could guess is
     * one it already holds, which is the wrong answer whenever the two copies differ and no answer
     * at all for somebody who has just arrived. The remedy is on the other machine, so the sentence
     * has to name it.
     */
    | { kind: "room-story-unknown" }
    /**
     * The room's document is not in this copy, even after syncing to the revision it opened on.
     *
     * Should not happen - the host commits and pushes before opening, so the document is in that
     * revision - which is exactly why it is worth naming. Without it the session would start,
     * every read of the document would answer null, and nothing on screen would say why.
     */
    | { kind: "story-not-here"; storyId: StoryId }
    /** The server refused, or could not be reached. */
    | { kind: "refused"; problem: TeamProblem }
    /** Something local threw - a checkpoint, a push, a sync. `detail` is for a log, not a screen. */
    | { kind: "failed"; detail: string };

/** Why a step could not be taken back. The inverse's own reasons, plus the two ends of the stack. */
export type LiveUndoRefusalReason = LiveInverseReason | "nothing-to-undo" | "nothing-to-redo";

/** The host's answer to something this window asked for, when the answer was no. */
export type LiveRefusalNotice = {
    reason: LiveRefusalReason;
    /** Which operation was refused, so the panel can name the gesture rather than the message. */
    op: LiveOpKind;
    /** Who holds the row, for `row-claimed`. An account name - a person is being named. */
    heldBy?: string;
};

/** What a live session is, right now. */
export type LiveSessionView = {
    phase: LiveSessionPhase;
    /** Null outside a session, and while entering one. */
    role: LiveSessionRole | null;
    /** The room as the server describes it: who is in it, what it is called, what it opened on. */
    session: TeamLiveSession | null;
    /** The story document this session is about. */
    storyId: StoryId | null;
    /** This window's instance id in the room. What tells its own effects from everybody else's. */
    self: string | null;
    /** The revision the room opened on. */
    revision: string | null;
    /**
     * The revision this window recorded on its way in, or null when there was nothing to record.
     *
     * Held so the author can be told where their uncommitted work went before the session's state
     * landed on top of it. A checkpoint nobody can name is a checkpoint nobody can go back to.
     */
    checkpoint: string | null;
    /** The last operation this window applied, in the host's order. */
    appliedSeq: number;
    /** How many of this window's intents are still waiting for an answer. Always 0 for a host. */
    pendingIntents: number;
    /** Whether this window is waiting on the host to fill a gap it saw in the order. */
    waitingForCatchUp: boolean;
    /** Who is writing which row, block id to account name. */
    claims: Readonly<Record<StoryBlockId, string>>;
    /** The last thing the host said no to, or null. Cleared when the next operation is accepted. */
    lastRefusal: LiveRefusalNotice | null;
    /** Why the last undo or redo did nothing, or null. Cleared when the next one is taken. */
    undoRefusal: LiveUndoRefusalReason | null;
    /** Whether there is a step of this window's own to take back, and one to put back. */
    canUndo: boolean;
    canRedo: boolean;
    /** Why the last attempt to enter a session did not, or null. */
    entryFailure: LiveEntryFailure | null;
    /** How the last session ended, or null when none has. Survives into `idle` so it can be read. */
    ended: LiveSessionEnd | null;
};

/** A window in no session, and never in one. The state every workspace starts in. */
export const IDLE_LIVE_SESSION: LiveSessionView = {
    phase: "idle",
    role: null,
    session: null,
    storyId: null,
    self: null,
    revision: null,
    checkpoint: null,
    appliedSeq: 0,
    pendingIntents: 0,
    waitingForCatchUp: false,
    claims: {},
    lastRefusal: null,
    undoRefusal: null,
    canUndo: false,
    canRedo: false,
    entryFailure: null,
    ended: null,
};
