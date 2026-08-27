import type { TeamLiveSession } from "@shared/types/team";
import type { LiveSessionRole } from "./liveSessionView";

/**
 * The decisions taken on the way into a room, and on the way back to one this window itself opened,
 * as functions of what is known rather than as branches inside the thing that acts on them.
 *
 * Each is asked twice - once by a control deciding what to offer, once by the act behind it - and
 * each is the kind of question that is easy to answer differently in two places. Kept here so
 * there is one answer, and so that "which half am I", "what does joining cost" and "is that room
 * on the server still mine" can be checked without a server, a repository or a room.
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
 *
 * **Both shapes are given back the same thing when the room ends: whatever this machine's own last
 * progress was.** For `sync` that is the checkpoint recorded here, or the revision the tree was
 * already on when there was nothing to record. For `clone` it is the clone itself - this machine
 * had no progress of its own before, so what it came by IS its own from then on. One rule, and no
 * case in which an author has to work out whose the bytes on their disk are.
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

/* ------------------------------------------------------------------- coming back */

/**
 * ⚠ **A room does not outlive its host, and nothing here nominates a successor.**
 *
 * There was once a handover: the leaving host published, named the longest-standing member, and
 * everybody else watched for the room that member opened. It is gone, and the reason it is gone is
 * worth keeping because the shape is tempting. **The host is the only copy that counts** - everyone
 * else is sending intents at it - so a room whose host has walked out has no authority for an
 * intent to reach, and the only thing a guest can safely do with what is on its own disk is put
 * back what was there before it joined. A successor could carry the CONTENT on, but not the
 * question every other machine is then left holding: whose is this work, and what may I discard?
 * Nobody in that room ever held an answer to it.
 *
 * So the ending is the whole of what happens, and a host that comes back opens a room the others
 * are offered rather than pulled into. See {@link LiveGhostRoom} for the one thing that does
 * survive a window going away, which is that window's claim on its OWN room.
 */

/**
 * How long the note a host leaves itself is worth acting on.
 *
 * A window that reloads writes down that it was hosting and reads it back on the way up. Long
 * enough for a workspace to start - the slowest thing in between is a whole-project write - and
 * short enough that a note found the next morning is not a room opening around an author who has
 * moved on to something else.
 */
export const LIVE_HOSTED_NOTE_MS = 90_000;

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
