import { describe, expect, it, vi } from "vitest";
import type { AgentFolderAccessAnswer } from "@shared/agent/protocol";
import { AgentRefusal } from "./agentCall";
import { ensureAgentMayRead, findAllowedImportRoot, isPathInside, type AgentReadCheck } from "./agentPaths";

/** Which files `assets_import` may read: inside the project or an allowed root, after normalisation. */
describe("isPathInside", () => {
    it("accepts the root itself and anything under it", () => {
        expect(isPathInside("/art", "/art", false)).toBe(true);
        expect(isPathInside("/art/bg/day.png", "/art", false)).toBe(true);
    });

    it("refuses a path that only starts with the root's spelling", () => {
        expect(isPathInside("/artwork/day.png", "/art", false)).toBe(false);
    });

    it("refuses a path that climbs out after normalisation", () => {
        expect(isPathInside("/art/../secrets/key.pem", "/art", false)).toBe(false);
        expect(isPathInside("/art/bg/../../etc/passwd", "/art", false)).toBe(false);
    });

    it("keeps a directory whose name merely begins with two dots", () => {
        expect(isPathInside("/art/..hidden/day.png", "/art", false)).toBe(true);
    });

    it("refuses relative paths outright", () => {
        expect(isPathInside("art/day.png", "/art", false)).toBe(false);
    });

    it("folds case only when asked to", () => {
        expect(isPathInside("/Art/day.png", "/art", false)).toBe(false);
        expect(isPathInside("/Art/day.png", "/art", true)).toBe(true);
    });
});

describe("findAllowedImportRoot", () => {
    it("always allows the project directory, then the listed roots", () => {
        expect(findAllowedImportRoot("/project/_import/a.png", "/project", [], false)).toBe("/project");
        expect(findAllowedImportRoot("/downloads/a.png", "/project", ["/art", "/downloads"], false)).toBe("/downloads");
        expect(findAllowedImportRoot("/elsewhere/a.png", "/project", ["/art"], false)).toBeNull();
    });
});

describe("ensureAgentMayRead", () => {
    const answer = (partial: Partial<AgentFolderAccessAnswer>): AgentFolderAccessAnswer => ({ granted: [], denied: [], pending: [], refused: [], ...partial });
    const check = (ask: AgentReadCheck["ask"], fullAccess = false): AgentReadCheck => ({
        projectPath: "/project",
        policy: { writesEnabled: true, allowedImportRoots: ["/art"], fullAccess },
        callId: "call-1",
        ask,
        caseInsensitive: false,
    });
    const refusal = async (promise: Promise<void>): Promise<AgentRefusal> => {
        try {
            await promise;
        } catch (error) {
            expect(error).toBeInstanceOf(AgentRefusal);
            return error as AgentRefusal;
        }
        throw new Error("expected a refusal");
    };

    it("asks nothing for paths already allowed", async () => {
        const ask = vi.fn();
        await ensureAgentMayRead(["/project/a.png", "/art/b.png"], check(ask));
        expect(ask).not.toHaveBeenCalled();
    });

    it("asks main about the rest, with the call id, and passes once they are granted", async () => {
        const ask = vi.fn(async () => answer({ granted: ["/kit"] }));
        await ensureAgentMayRead(["/art/b.png", "/kit/bg/c.png"], check(ask));
        expect(ask).toHaveBeenCalledWith({ callId: "call-1", paths: ["/kit/bg/c.png"] });
    });

    it("refuses a call that is still waiting on the author, saying to call again", async () => {
        const error = await refusal(ensureAgentMayRead(["/kit/c.png"], check(async () => answer({ pending: ["/kit"] }))));
        expect(error.code).toBe("path_not_allowed");
        expect(error.hint).toBe("Studio is asking the author to allow /kit; call again once they answer.");
    });

    it("refuses a declined folder and says not to ask again", async () => {
        const error = await refusal(ensureAgentMayRead(["/kit/c.png"], check(async () => answer({ denied: ["/kit"] }))));
        expect(error.message).toContain("Declined by the author: /kit.");
        expect(error.hint).toContain("Do not ask again");
    });

    it("refuses the whole call when only some paths were granted", async () => {
        const error = await refusal(ensureAgentMayRead(
            ["/kit/c.png", "/Users/me/Library/x.png"],
            check(async () => answer({ granted: ["/kit"], refused: [{ folder: "/Users/me/Library", reason: "studio" }] }), true),
        ));
        expect(error.message).toContain("1 path is outside");
        expect(error.message).toContain("Studio's own folders");
    });

    it("refuses relative paths without asking, and falls back when main cannot be asked", async () => {
        const ask = vi.fn(async () => null);
        expect((await refusal(ensureAgentMayRead(["kit/c.png"], check(ask)))).message).toContain("absolute");
        expect(ask).not.toHaveBeenCalled();
        expect((await refusal(ensureAgentMayRead(["/kit/c.png"], check(ask)))).hint).toContain("could not ask");
    });

    it("does not count the allowed folders for an untrusted project, and passes on main's reason", async () => {
        const ask = vi.fn(async () => answer({ refused: [{ folder: "/art", reason: "untrusted" }] }));
        const untrusted: AgentReadCheck = { ...check(ask), policy: { ...check(ask).policy, projectTrusted: false } };
        const error = await refusal(ensureAgentMayRead(["/project/a.png", "/art/b.png"], untrusted));
        expect(ask).toHaveBeenCalledWith({ callId: "call-1", paths: ["/art/b.png"] });
        expect(error.message).toContain("not trusted");
        expect(error.hint).toContain("trust the project");
        await ensureAgentMayRead(["/project/a.png"], untrusted);
    });
});
