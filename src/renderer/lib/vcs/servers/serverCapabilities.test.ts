import { describe, expect, it } from "vitest";
import type { VcsServerSession } from "@shared/types/vcs";
import { serverCan } from "./serverCapabilities";

/**
 * What a screen may ask a server for.
 *
 * The whole value of this is in the two negatives: a session that has never been asked
 * what its server offers, and a server that answered and did not name the thing. Both have
 * to come out false, because the alternative is a request that will be refused and a
 * refusal that needs a sentence - and there is no sentence to write, since a deployment
 * not offering a roster is a fact about the deployment rather than about this machine.
 */

function session(capabilities?: string[]): VcsServerSession {
    return {
        authUrl: "https://team.example.lan:41402",
        remoteOrigin: "lore://team.example.lan:41337",
        account: {
            userId: "u-1",
            displayName: "Ada Blackwood",
            username: "ada",
            email: "ada@example.com",
            identity: "Ada Blackwood <ada@example.com>",
            expiresAt: 0,
        },
        signedInAt: 0,
        ...(capabilities === undefined ? {} : { capabilities }),
    };
}

describe("what a server offers", () => {
    it("says yes to what the server named", () => {
        const named = session(["projects", "project-detail", "members", "project-history"]);

        expect(serverCan(named, "members")).toBe(true);
        expect(serverCan(named, "project-detail")).toBe(true);
        expect(serverCan(named, "project-history")).toBe(true);
    });

    it("says no to what it did not name, without asking it", () => {
        expect(serverCan(session(["projects"]), "members")).toBe(false);
    });

    it("treats one capability independently of another", () => {
        // Measured: a deployment can list projects and answer for one of them without
        // serving history, so the two surfaces cannot share a gate.
        const half = session(["projects", "project-detail"]);

        expect(serverCan(half, "project-detail")).toBe(true);
        expect(serverCan(half, "project-history")).toBe(false);
    });

    it("says no for a session stored before Studio kept the list", () => {
        // The safe direction: the cost is a section appearing after the tab refreshes the
        // server, where the other direction is a request that is certain to be refused.
        expect(serverCan(session(), "members")).toBe(false);
        expect(serverCan(session([]), "members")).toBe(false);
    });

    it("says no where there is no server at all", () => {
        expect(serverCan(null, "members")).toBe(false);
        expect(serverCan(undefined, "project-detail")).toBe(false);
    });
});
