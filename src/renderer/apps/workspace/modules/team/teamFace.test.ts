import { describe, expect, it } from "vitest";

import { teamServerFace } from "./teamFace";

/**
 * Which of two questions the word beside a server is answering.
 *
 * "Not checked" was measured on a real machine sitting beside the address of a server the
 * workspace had just checked, held a session with, and confirmed holds this project. It
 * was true about the branch comparison and false about everything a reader takes it to
 * mean, which is what these pin.
 */
describe("the word beside a project's server", () => {
    const SYNCED = {
        remoteAvailable: true,
        remoteAuthorized: true,
        remoteBranchExists: true,
        localAhead: false,
        remoteAhead: false,
    };

    it("says connected where the server answered and nothing has compared the branch", () => {
        const face = teamServerFace({ kind: "verified", project: {} as never }, null);
        expect(face.key).toBe("workspace.shell.team.connected");
    });

    it("gives the branch comparison the spot as soon as there is one", () => {
        const face = teamServerFace({ kind: "verified", project: {} as never }, SYNCED);
        expect(face.key).not.toBe("workspace.shell.team.connected");
    });

    it("lets a server that does not hold this project outrank any comparison", () => {
        // Even with a sync state saying everything is up to date - which it would be,
        // against a branch on a server that has since had the project taken off it.
        const face = teamServerFace({ kind: "not-there" }, SYNCED);
        expect(face.key).toBe("workspace.shell.team.notThere");
        expect(face.tone).toBe("text-warning");
    });

    it("says a server is not answering rather than repeating a stale comparison", () => {
        const face = teamServerFace({ kind: "unreachable", detail: "ECONNREFUSED" }, SYNCED);
        expect(face.key).toBe("workspace.shell.team.unreachable");
    });

    it("leaves the comparison alone for a project with no server to check", () => {
        expect(teamServerFace({ kind: "none" }, null).key)
            .toBe("workspace.shell.versionControl.server.state.notChecked");
    });
});
