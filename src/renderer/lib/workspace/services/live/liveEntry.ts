import type { TeamLiveSession } from "@shared/types/team";
import type { LiveSessionRole } from "./liveSessionView";

/**
 * The two decisions taken on the way into a room, as functions of what is known rather than as
 * branches inside the thing that acts on them.
 *
 * Both are asked twice - once by a control deciding what to offer, once by the act behind it - and
 * both are the kind of question that is easy to answer differently in two places. Kept here so
 * there is one answer, and so that "which half am I" and "what does joining cost" can be checked
 * without a server, a repository or a room.
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
