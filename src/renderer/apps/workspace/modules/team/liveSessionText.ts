import type {
    LiveEntryFailure,
    LiveRefusalNotice,
    LiveSessionEnd,
    LiveSessionView,
    LiveUndoRefusalReason,
} from "@/lib/workspace/services/live/liveSessionView";
import type { TranslationKey } from "@shared/i18n";
import type { LiveRefusalReason } from "@shared/live/ops";
import type { TeamProjectState } from "../../hooks/useTeamProject";

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
 * The next thing to do about a refusal, or null where the refusal already says it.
 *
 * **A `Record` over the whole union, like the sentences above it, and for a stronger reason.** A
 * refusal that names a state without naming a way out is a control the author presses again, gets
 * the same red line from, and stops trusting - and the states this feature can be in are precisely
 * the ones an author has no way of guessing at. So a new one does not compile until somebody has
 * decided whether there is anything to do about it.
 *
 * Null is a real answer and is used deliberately: where the sentence is already an instruction
 * ("Record a version to start a live session"), a second line repeating it in other words is noise.
 */
const ENTRY_REMEDIES: Record<LiveEntryFailure["kind"], TranslationKey | null> = {
    // Already in one, and the control the author pressed is the one that leaves it.
    busy: null,
    // The freeze's sentence names the state that has to be left, which is the whole remedy.
    frozen: null,
    // Both sentences are instructions already.
    "no-server": null,
    "no-revision": null,
    "no-instance": "workspace.shell.team.liveNoInstanceNext",
    "no-repository": "workspace.shell.team.liveNoRepositoryNext",
    // "That session is on {project}. Open that project to join it." - the instruction is the whole
    // sentence, and this window cannot open another project anyway.
    "clone-required": null,
    "revision-mismatch": "workspace.shell.team.liveVersionMismatchNext",
    "merge-conflicts": "workspace.shell.team.liveMergeConflictsNext",
    "room-gone": "workspace.shell.team.liveRoomGoneNext",
    // The remedy is on the other machine and the sentence already names it.
    "room-story-unknown": null,
    "story-not-here": "workspace.shell.team.liveStoryNotHereNext",
    refused: "workspace.shell.team.liveRefusedNext",
    failed: "workspace.shell.team.liveFailedNext",
};

export function liveEntryFailureRemedy(failure: LiveEntryFailure): TranslationKey | null {
    return ENTRY_REMEDIES[failure.kind];
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

/**
 * What the author is told about a session that ended, or null when nothing is.
 *
 * `carryingOn` is the one thing that changes what an ending means. A host that hands over or reloads
 * closes the room, and the room is back within seconds under somebody else - so "the session is
 * over" would be the wrong half of what happened, and would be followed by the session reappearing
 * with nothing having explained it.
 */
export function liveEndSentence(end: LiveSessionEnd, carryingOn = false): TranslationKey | null {
    if (carryingOn && end.cause === "host-left") {
        return "workspace.shell.team.liveEndedHandedOver";
    }
    return SESSION_ENDS[end.cause];
}

/** The host's answer to an edit, when the answer was no. */
const REFUSALS: Record<LiveRefusalReason, TranslationKey> = {
    "row-claimed": "story.live.refusedRowClaimed",
    "row-gone": "story.live.refusedRowGone",
    "anchor-gone": "story.live.refusedAnchorGone",
    "scene-gone": "story.live.refusedSceneGone",
    "character-gone": "story.live.refusedCharacterGone",
    "asset-gone": "story.live.refusedAssetGone",
    "asset-id-taken": "story.live.refusedAssetIdTaken",
    "folder-not-empty": "story.live.refusedFolderNotEmpty",
    "track-gone": "story.live.refusedTrackGone",
    "set-gone": "story.live.refusedSetGone",
    "too-large": "story.live.refusedTooLarge",
    "not-in-session": "story.live.refusedNotInSession",
    "document-not-shared": "story.live.refusedDocumentNotShared",
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
    "character-gone": "story.live.undoCharacterGone",
    "character-restored": "story.live.undoCharacterRestored",
    "asset-gone": "story.live.undoAssetGone",
    "content-replaced": "story.live.undoContentReplaced",
    "track-gone": "story.live.undoTrackGone",
    "track-restored": "story.live.undoTrackRestored",
    "set-gone": "story.live.undoSetGone",
    "set-restored": "story.live.undoSetRestored",
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
 * What the control that takes this window out of a room does, and how much it costs.
 *
 * Three answers rather than two, because a host leaving is no longer one act. A room's authority is
 * the window that opened it, so a host walking out of a room with somebody else in it hands it over:
 * the session carries on in a new room opened by whoever was nominated. A host walking out of a room
 * of one ends it - there is nobody to hand it to - and that is the destructive one.
 *
 * Named after what happens rather than after which half of the session this window is, because the
 * two are no longer the same question, and a control that said "End" over a session that carries on
 * would be asking somebody to be brave about nothing.
 */
export function liveLeaveAct(view: LiveSessionView): { key: TranslationKey; destructive: boolean } {
    if (view.role !== "host") {
        return { key: "workspace.shell.team.liveLeaveSession", destructive: false };
    }
    return liveOtherMembers(view).length > 0
        ? { key: "workspace.shell.team.liveHandOverSession", destructive: false }
        : { key: "workspace.shell.team.liveEndSession", destructive: true };
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

/**
 * Why the collaboration control cannot act, or null when it can.
 *
 * **The control is drawn for every project pointed at a Team server**, including the ones that
 * cannot open a room at this moment - a control that appears only once everything is in place
 * cannot be used to find out what is missing. So it goes inert and names the answer it is waiting
 * for, which is a different sentence for each of the five states the project can be in.
 *
 * A `Record` over the whole union rather than a chain of comparisons, for the same reason as every
 * other table in this file: a state added to `TeamProjectState` does not compile until somebody has
 * decided what it says.
 */
const PRESENCE_REFUSALS: Record<TeamProjectState["kind"], TranslationKey | null> = {
    // Nothing is drawn for a project on no server at all, so this is never read.
    none: "workspace.shell.team.liveNoServer",
    "no-account": "workspace.shell.team.noAccountHere",
    connecting: "workspace.shell.team.liveConnecting",
    unreachable: "workspace.shell.team.unreachable",
    "not-there": "workspace.shell.team.notThere",
    verified: null,
};

export function livePresenceRefusal(state: TeamProjectState, canLive: boolean): TranslationKey | null {
    const refusal = PRESENCE_REFUSALS[state.kind];
    if (refusal !== null) {
        return refusal;
    }
    // Answering, holds the project, and still offers no rooms. Only a deployment older than the
    // feature, which is why it is the last question asked rather than the first.
    return canLive ? null : "workspace.shell.team.liveUnsupported";
}

/**
 * The word for a member's standing in a room, given who opened it.
 *
 * The same two words the session's own standing uses, so a member row and the room row cannot
 * disagree about what somebody is called.
 */
export function liveMemberRoleKey(account: string, host: string | null | undefined): TranslationKey {
    return account === host ? "workspace.shell.team.liveHost" : "workspace.shell.team.liveGuest";
}
