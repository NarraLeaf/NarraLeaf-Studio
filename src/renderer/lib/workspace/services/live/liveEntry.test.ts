import { describe, expect, it } from "vitest";
import type { TeamLiveSession } from "@shared/types/team";
import {
    chooseLiveSuccessor,
    continuesLiveSession,
    decideLiveRole,
    LIVE_CONTINUATION_MS,
    planLiveGhostRoom,
    planLiveJoin,
    type LiveContinuation,
} from "./liveEntry";

function room(patch: Partial<TeamLiveSession> = {}): TeamLiveSession {
    return {
        id: "room-1",
        project: "repo-1",
        revision: "rev-9",
        openedBy: "ada",
        openedByInstance: "instance-ada",
        openedAt: 0,
        members: [],
        ...patch,
    };
}

describe("which half of a session a window is", () => {
    it("is the host when the room says this instance opened it", () => {
        expect(decideLiveRole(room(), "instance-ada")).toBe("host");
    });

    it("is a guest for every other window, including another window of the same person", () => {
        // The instance rather than the account: one person can have the project open twice, and
        // only one of those windows holds the document that counts.
        expect(decideLiveRole(room(), "instance-ada-second")).toBe("guest");
        expect(decideLiveRole(room(), "instance-grace")).toBe("guest");
    });
});

describe("what joining a room costs", () => {
    it("checkpoints before syncing when the tree holds something no revision has", () => {
        expect(planLiveJoin({
            sessionProject: "repo-1",
            openProject: "repo-1",
            uncommittedChanges: true,
        })).toEqual({ kind: "sync", checkpoint: true });
    });

    it("skips the checkpoint when there is nothing to record", () => {
        // A checkpoint of a tree that has not changed is a lie about the author's history.
        expect(planLiveJoin({
            sessionProject: "repo-1",
            openProject: "repo-1",
            uncommittedChanges: false,
        })).toEqual({ kind: "sync", checkpoint: false });
    });

    it("needs a clone when the room is about a project this machine does not have", () => {
        // And no checkpoint with it: there is no copy here to protect, which is what makes joining
        // a session one of the ordinary ways to come by a project.
        expect(planLiveJoin({
            sessionProject: "repo-2",
            openProject: "repo-1",
            uncommittedChanges: true,
            revision: "rev-9",
        })).toEqual({ kind: "clone", project: "repo-2", revision: "rev-9" });
    });

    it("needs a clone for a window with no project open at all", () => {
        expect(planLiveJoin({
            sessionProject: "repo-2",
            openProject: null,
            uncommittedChanges: false,
        })).toEqual({ kind: "clone", project: "repo-2" });
    });
});

function member(instance: string, joinedAt: number) {
    return { instance, joinedAt };
}

describe("who opens the room that carries on", () => {
    it("is the member who has been in it longest", () => {
        expect(chooseLiveSuccessor(
            [member("instance-ada", 0), member("instance-bo", 10), member("instance-cy", 5)],
            "instance-ada",
        )).toBe("instance-cy");
    });

    it("is nobody in a room of one", () => {
        // Not a handover at all: there is no one to hand it to, and the room ending is the whole of
        // what happens.
        expect(chooseLiveSuccessor([member("instance-ada", 0)], "instance-ada")).toBeNull();
    });

    it("breaks a tie by instance, so two windows cannot each decide they are the one", () => {
        expect(chooseLiveSuccessor(
            [member("instance-ada", 0), member("instance-cy", 4), member("instance-bo", 4)],
            "instance-ada",
        )).toBe("instance-bo");
    });
});

describe("whether a new room carries on from the one that closed", () => {
    const continuation: LiveContinuation = {
        previousRoom: "room-1",
        story: "story-1",
        successor: "instance-bo",
        previousHost: "instance-ada",
        since: 1_000,
    };

    it("never follows the room that ended, however it is still listed", () => {
        expect(continuesLiveSession(
            continuation,
            room({ id: "room-1", story: "story-1", openedByInstance: "instance-ada" }),
            2_000,
        )).toBe(false);
    });

    it("follows the room the nominated successor opened", () => {
        expect(continuesLiveSession(
            continuation,
            room({ id: "room-2", story: "story-1", openedByInstance: "instance-bo" }),
            2_000,
        )).toBe(true);
    });

    it("follows the previous host's own room, which is what a reload leaves behind", () => {
        expect(continuesLiveSession(
            continuation,
            room({ id: "room-2", story: "story-1", openedByInstance: "instance-ada" }),
            2_000,
        )).toBe(true);
    });

    it("does not follow a room about a different story", () => {
        expect(continuesLiveSession(
            continuation,
            room({ id: "room-2", story: "story-2", openedByInstance: "instance-bo" }),
            2_000,
        )).toBe(false);
    });

    it("does not follow a room somebody else opened", () => {
        // A window that was in a room is not thereby a member of every room that follows it. This
        // is what stops an author being pulled into a collaboration they were never asked about.
        expect(continuesLiveSession(
            continuation,
            room({ id: "room-2", story: "story-1", openedByInstance: "instance-cy" }),
            2_000,
        )).toBe(false);
    });

    it("stops following once enough time has passed", () => {
        expect(continuesLiveSession(
            continuation,
            room({ id: "room-2", story: "story-1", openedByInstance: "instance-bo" }),
            1_000 + LIVE_CONTINUATION_MS + 1,
        )).toBe(false);
    });
});

describe("a room this window opened and then vanished from", () => {
    it("is re-founded while somebody is still in it", () => {
        expect(planLiveGhostRoom(
            room({
                openedByInstance: "instance-ada",
                members: [
                    { instance: "instance-ada", account: "ada", label: "a", joinedAt: 0 },
                    { instance: "instance-bo", account: "bo", label: "b", joinedAt: 1 },
                ],
            }),
            "instance-ada",
        )).toEqual({ kind: "refound" });
    });

    it("is closed when nobody is", () => {
        // What is left otherwise is a room the author's own panel offers them as somebody else's.
        expect(planLiveGhostRoom(
            room({
                openedByInstance: "instance-ada",
                members: [{ instance: "instance-ada", account: "ada", label: "a", joinedAt: 0 }],
            }),
            "instance-ada",
        )).toEqual({ kind: "close" });
    });
});
