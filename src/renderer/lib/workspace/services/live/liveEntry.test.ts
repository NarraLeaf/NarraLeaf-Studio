import { describe, expect, it } from "vitest";
import type { TeamLiveSession } from "@shared/types/team";
import {
    decideLiveRole,
    planLiveGhostRoom,
    planLiveJoin,
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
