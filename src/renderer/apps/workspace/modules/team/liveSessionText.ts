import type {
    LiveEntryFailure,
    LiveRefusalNotice,
    LiveSessionEnd,
    LiveSessionView,
    LiveUndoRefusalReason,
} from "@/lib/workspace/services/live/liveSessionView";
import type { TranslationKey } from "@shared/i18n";
import type { LiveRefusalReason } from "@shared/live/ops";

/**
 * What a live session's facts are called, in the catalog.
 *
 * The service answers in values and never in prose, so the step from "this happened" to "this is
 * what it says" lives on the interface side - here, once, rather than in each of the two surfaces
 * that show it. The panel says why a room could not be entered; the story editor says why an edit
 * or an undo did not land, and both read the same session.
 *
 * Every table below is a `Record` over the whole of its union rather than a chain of comparisons.
 * A state added to the session does not compile until somebody has decided what it says, which is
 * the only way a new refusal cannot reach an author as silence.
 */

/** A key, with whatever the sentence interpolates. */
export type LiveSentence = {
    key: TranslationKey;
    params?: Record<string, string>;
};

/** Why entering did not happen, for the kinds whose sentence needs nothing from the failure. */
const ENTRY_FAILURES: Record<LiveEntryFailure["kind"], TranslationKey> = {
    // Already in one. The freeze's own refusal says it in the words the controls already use.
    busy: "workspace.shell.team.liveBlockedSession",
    // Replaced by the refusal's own key below - a freeze names the state that has to be left, and
    // there are five of those.
    frozen: "workspace.shell.team.liveBlockedSession",
    "no-server": "workspace.shell.team.liveNoServer",
    "no-instance": "workspace.shell.team.liveNoInstance",
    "no-repository": "workspace.shell.team.liveNoRepository",
    "no-revision": "workspace.shell.team.liveNoRevision",
    "clone-required": "workspace.shell.team.liveCloneRequired",
    "revision-mismatch": "workspace.shell.team.liveVersionMismatch",
    // A merge is open now, and a merge is one of the freezes that refuses a session anyway.
    "merge-conflicts": "workspace.shell.team.liveBlockedMerge",
    "room-gone": "workspace.shell.team.liveRoomGone",
    // The room is there and this window still cannot follow it. Both name the reason rather than
    // falling back to a guess, because the only story this window could guess is one it already
    // holds - see `LiveSession.join`.
    "room-story-unknown": "workspace.shell.team.liveRoomStoryUnknown",
    "story-not-here": "workspace.shell.team.liveStoryNotHere",
    refused: "workspace.shell.team.liveRefused",
    failed: "workspace.shell.team.liveFailed",
};

/** What the author is told about an attempt to enter that did not. */
export function liveEntryFailureSentence(failure: LiveEntryFailure): LiveSentence {
    if (failure.kind === "frozen") {
        // The five freezes have five ways out, and `refuseLiveSessionEntry` already chose the one
        // that names the state standing in the way.
        return { key: failure.refusal.message };
    }
    if (failure.kind === "clone-required") {
        return { key: ENTRY_FAILURES[failure.kind], params: { project: failure.project } };
    }
    return { key: ENTRY_FAILURES[failure.kind] };
}

/**
 * What the author is told about a session that ended, or null when nothing is said.
 *
 * Leaving is silent: the author pressed the control, watched the row change, and a notice
 * confirming it is one more thing to dismiss. The other two happened to them.
 */
const SESSION_ENDS: Record<LiveSessionEnd["cause"], TranslationKey | null> = {
    left: null,
    "host-left": "workspace.shell.team.liveEndedHostLeft",
    // Emphatically not a goodbye. This machine's copy of the story stopped matching the room's, so
    // it left - and what is on this disk now is not what the others are looking at.
    diverged: "workspace.shell.team.liveEndedDiverged",
};

export function liveEndSentence(end: LiveSessionEnd): TranslationKey | null {
    return SESSION_ENDS[end.cause];
}

/** The host's answer to an edit, when the answer was no. */
const REFUSALS: Record<LiveRefusalReason, TranslationKey> = {
    "row-claimed": "story.live.refusedRowClaimed",
    "row-gone": "story.live.refusedRowGone",
    "anchor-gone": "story.live.refusedAnchorGone",
    "scene-gone": "story.live.refusedSceneGone",
    "not-in-session": "story.live.refusedNotInSession",
    "unknown-op": "story.live.refusedUnknownOp",
};

/**
 * What the author is told about an edit the host would not take.
 *
 * ⚠ Whatever shows this must leave the author's text exactly where it is. A refused row is the one
 * case where the words on screen are the only copy of a finished paragraph, and the reason this
 * refusal exists at all is that losing one silently is worse than any interruption.
 */
export function liveRefusalSentence(refusal: LiveRefusalNotice): LiveSentence {
    const key = REFUSALS[refusal.reason];
    // A person is being named, and the row-claimed sentence is the only one that names anybody.
    return refusal.heldBy === undefined ? { key } : { key, params: { name: refusal.heldBy } };
}

/**
 * Why the last undo or redo did nothing, or null where nothing is said.
 *
 * The two ends of the stack are silent. Pressing Ctrl+Z once more than there are steps is an
 * ordinary thing to do, and a notice for it would fire on a gesture nobody made a mistake with.
 */
const UNDO_REFUSALS: Record<LiveUndoRefusalReason, TranslationKey | null> = {
    "nothing-to-undo": null,
    "nothing-to-redo": null,
    "not-mine": "story.live.undoNotMine",
    "no-record": "story.live.undoNoRecord",
    "scene-gone": "story.live.undoSceneGone",
    "row-gone": "story.live.undoRowGone",
    "row-restored": "story.live.undoRowRestored",
    "container-gone": "story.live.undoContainerGone",
    "anchor-gone": "story.live.undoAnchorGone",
    "container-filled": "story.live.undoContainerFilled",
    "subtree-lost": "story.live.undoSubtreeLost",
    "chapters-changed": "story.live.undoChaptersChanged",
};

export function liveUndoRefusalSentence(reason: LiveUndoRefusalReason): TranslationKey | null {
    return UNDO_REFUSALS[reason];
}

/**
 * The word for where this window stands in the room.
 *
 * A value with no label, like every other fact in this panel: a room row already says it is a room,
 * so the slot beside its name only has to say which half of it this window is.
 */
export function liveStandingKey(view: LiveSessionView): TranslationKey | null {
    switch (view.phase) {
        case "idle":
            return null;
        case "entering":
            return "workspace.shell.team.liveEntering";
        case "leaving":
            return "workspace.shell.team.liveLeaving";
        case "catching-up":
        case "active":
            return view.role === "host"
                ? "workspace.shell.team.liveHost"
                : "workspace.shell.team.liveGuest";
    }
}

/**
 * Everybody in the room except this window, by account.
 *
 * Empty while entering, and empty in a room of one - both of which draw nothing, because a line
 * saying nobody else is here is a line nobody reads.
 */
export function liveOtherMembers(view: LiveSessionView): string[] {
    return (view.session?.members ?? [])
        .filter(member => member.instance !== view.self)
        .map(member => member.account);
}
