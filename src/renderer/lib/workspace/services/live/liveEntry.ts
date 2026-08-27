import type { TeamLiveSession } from "@shared/types/team";
import type { LiveSessionRole } from "./liveSessionView";

/**
 * The decisions taken on the way into a room, and on the way out of one that is not meant to end,
 * as functions of what is known rather than as branches inside the thing that acts on them.
 *
 * Each is asked twice - once by a control deciding what to offer, once by the act behind it - and
 * each is the kind of question that is easy to answer differently in two places. Kept here so
 * there is one answer, and so that "which half am I", "what does joining cost" and "is this new
 * room the one I was just in" can be checked without a server, a repository or a room.
 */

/**
 * Which half of a session this window is.
 *
 * **Host if it opened the room, guest otherwise, and the room record is what says so.** Not a flag
 * kept from whichever call this window made: a window that opened a room and then had its session
 * drop would re-join its own room, and a role remembered from the call would make it a guest of
 * itself - sending intents to a host that does not exist, because the host was meant to be it.
 *
 * The instance rather than the account, because one person may have the same project open in two
 * windows and only one of them holds the document that counts.
 */
export function decideLiveRole(session: TeamLiveSession, instance: string): LiveSessionRole {
    return session.openedByInstance === instance ? "host" : "guest";
}

/**
 * What joining a room costs this machine before it can follow along.
 *
 * `sync` is the shape for a machine that already has the project: its working tree is somebody's
 * work, so anything uncommitted is recorded first and the tree is then brought to the revision the
 * room opened on. `checkpoint` is false only when there is nothing to record - a checkpoint of a
 * tree that has not changed is a lie about the author's history.
 *
 * `clone` is the shape for a machine that does not have it. **Nothing is checkpointed there and
 * that is not an oversight**: there is no copy of this project on this machine, so there is nothing
 * to protect, and joining a session is therefore one of the ordinary ways to come by the project in
 * the first place. Cloning is the launcher's flow and needs a window that has no project open, so
 * this is reported rather than performed.
 */
export type LiveJoinPlan =
    | { kind: "sync"; checkpoint: boolean }
    | { kind: "clone"; project: string; revision?: string };

export function planLiveJoin(input: {
    /** The project the room is about, by repository id. */
    sessionProject: string;
    /** The project this window has open, by repository id, or null for a window with none. */
    openProject: string | null;
    /** Whether this window's working tree holds anything no revision has. */
    uncommittedChanges: boolean;
    /** What the room opened on, carried through to the clone that has to reach it. */
    revision?: string;
}): LiveJoinPlan {
    if (input.openProject === null || input.openProject !== input.sessionProject) {
        return {
            kind: "clone",
            project: input.sessionProject,
            ...(input.revision === undefined ? {} : { revision: input.revision }),
        };
    }
    return { kind: "sync", checkpoint: input.uncommittedChanges };
}

/* ------------------------------------------------------------------- carrying on */

/**
 * Who opens the next room when this one's host walks out of it.
 *
 * **The longest-standing member, and ties are broken by instance id.** Not because seniority earns
 * anything, but because every window has to be able to arrive at the same answer from a roster that
 * may be one event out of date, and "who has been here longest" is the only ordering the server's
 * roster already carries. The id is the tiebreak because two windows that joined in the same
 * millisecond must not each decide they are the one.
 *
 * Null in a room of one, which is not a handover at all: nobody is left to hand it to, and the room
 * ending is the whole of what happens.
 */
export function chooseLiveSuccessor(
    members: readonly { instance: string; joinedAt: number }[],
    leaving: string,
): string | null {
    const candidates = members.filter(member => member.instance !== leaving);
    if (candidates.length === 0) {
        return null;
    }
    return candidates.reduce((best, member) => {
        if (member.joinedAt !== best.joinedAt) {
            return member.joinedAt < best.joinedAt ? member : best;
        }
        return member.instance < best.instance ? member : best;
    }).instance;
}

/**
 * What a window keeps of a room that ended so that it can follow the one that replaces it.
 *
 * A room's authority is the window that opened it and the protocol has no verb that moves it, so
 * carrying on means a NEW room on the same story - opened by whoever was nominated, or by the same
 * window coming back after a reload. Every window that was in the old room therefore has to
 * recognise the new one, and this is what it recognises it by.
 */
export type LiveContinuation = {
    /**
     * The room that ended. What carries on is a NEW one, never this.
     *
     * Named so it can be refused, because the two ways a window learns a room ended - the server's
     * event and a message from the host - both leave a window in which a stale listing still has it
     * in. Following it would put this window back into a room nobody is answering in.
     */
    previousRoom: string;
    /** The story the old room was about. A room about anything else is a different collaboration. */
    story: string;
    /** The instance the leaving host nominated, or null when nobody said. */
    successor: string | null;
    /** The instance that hosted the room that ended, which may open the next one itself. */
    previousHost: string;
    /** When the old room ended, so following does not resume an afternoon later. */
    since: number;
};

/**
 * How long a window keeps watching for the room to come back.
 *
 * Long enough for the successor to record a checkpoint, put its tree on the published version and
 * open a room - the slowest of those is a whole-project write, so this is measured in tens of
 * seconds rather than in seconds. Short enough that a room somebody opens after lunch is an
 * invitation the author answers rather than a session that starts around them.
 */
export const LIVE_CONTINUATION_MS = 90_000;

/**
 * Whether this newly seen room is the one this window was just in, carried on by somebody else.
 *
 * ⚠ **Deliberately not "any room on this story".** Following one would mean a window that left a
 * collaboration an hour ago being pulled into the next one without being asked. What is being
 * recognised here is narrow on purpose: the same story, opened by the window that was nominated for
 * it or by the host that vanished, within the minute and a half after the room ended.
 */
export function continuesLiveSession(
    continuation: LiveContinuation,
    room: TeamLiveSession,
    now: number,
): boolean {
    if (now - continuation.since > LIVE_CONTINUATION_MS) {
        return false;
    }
    if (room.id === continuation.previousRoom) {
        return false;
    }
    if (room.story !== continuation.story) {
        return false;
    }
    const expected = continuation.successor ?? continuation.previousHost;
    return room.openedByInstance === expected || room.openedByInstance === continuation.previousHost;
}

/**
 * What to do about a room this window already owns, found on the server as the workspace starts.
 *
 * A window that reloads never gets to say goodbye: the close it sends is an IPC call made while the
 * page is being torn down, and the room outlives it on the server with nobody in a position to
 * answer an intent. Both answers below are about that room, and which one is right is decided by
 * whether anybody else is still in it.
 *
 *  - `refound` - somebody is. The collaboration is still happening and this window is still its
 *    host, so the room is replaced by one opened on what this machine has published since. Resuming
 *    the old room instead would leave it opened on a version that no longer holds the session's
 *    work, and the next window to join would take that version and diverge on its first message.
 *  - `close` - nobody is. There is nothing to carry on, and what is left is a room the author's own
 *    panel would offer them as somebody else's to join.
 */
export type LiveGhostRoom = { kind: "refound" } | { kind: "close" };

export function planLiveGhostRoom(room: TeamLiveSession, self: string): LiveGhostRoom {
    return room.members.some(member => member.instance !== self) ? { kind: "refound" } : { kind: "close" };
}
