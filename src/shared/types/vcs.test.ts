import { describe, expect, it } from "vitest";
import { composeVcsIdentity, serverProblemFromTeam } from "./vcs";

/**
 * The `Name <email>` rule, which is the only place the two Sync settings become the one string
 * Lore records verbatim. Worth pinning: an identity is written into revisions that outlive the
 * machine, so a change of shape here is not a cosmetic change - it is a repository whose history
 * is attributed two different ways depending on which Studio version wrote each revision.
 */
describe("composeVcsIdentity", () => {
    it("joins a name and an email into the form every other tool writes", () => {
        expect(composeVcsIdentity("Ada Lovelace", "ada@example.com")).toBe("Ada Lovelace <ada@example.com>");
    });

    it("records the name alone when no email is configured", () => {
        expect(composeVcsIdentity("Ada Lovelace", "")).toBe("Ada Lovelace");
        expect(composeVcsIdentity("Ada Lovelace", undefined)).toBe("Ada Lovelace");
    });

    it("records the email alone rather than dropping the one thing that was configured", () => {
        expect(composeVcsIdentity("", "ada@example.com")).toBe("<ada@example.com>");
    });

    it("answers empty when neither is set, leaving the unconfigured identity to the caller", () => {
        // Not "NarraLeaf Studio": what an unconfigured author is called is VcsManager's decision,
        // and this function saying it would put that name in two places.
        expect(composeVcsIdentity("", "")).toBe("");
        expect(composeVcsIdentity(undefined, undefined)).toBe("");
    });

    it("trims, so a setting that is only whitespace is the same as unset", () => {
        expect(composeVcsIdentity("  Ada  ", "  ada@example.com  ")).toBe("Ada <ada@example.com>");
        expect(composeVcsIdentity("   ", "   ")).toBe("");
    });

    it("strips angle brackets out of the email instead of nesting them", () => {
        // An author who typed the git form into the email box would otherwise produce
        // `Ada <<ada@example.com>>`, which no reader of a history can split.
        expect(composeVcsIdentity("Ada", "<ada@example.com>")).toBe("Ada <ada@example.com>");
    });
});

/**
 * The one place the socket's refusals are lined up with the vocabulary the server-project
 * screens have sentences for. Pinned because it is where a whole family of screens read the
 * outcome of a call: a wrong mapping here is the wrong sentence in every language, on every
 * one of them.
 */
describe("serverProblemFromTeam", () => {
    it("reads a host that is not answering as unreachable", () => {
        expect(serverProblemFromTeam({ kind: "offline", detail: "ECONNREFUSED" })).toEqual({ kind: "unreachable" });
    });

    it("carries a token this installation cannot present through unchanged", () => {
        expect(serverProblemFromTeam({ kind: "no-token" })).toEqual({ kind: "no-token" });
    });

    it("reads the two credential refusals as one refusal, the way the REST 401/403 did", () => {
        expect(serverProblemFromTeam({ kind: "refused", code: "unauthenticated", detail: "" })).toEqual({ kind: "refused" });
        expect(serverProblemFromTeam({ kind: "refused", code: "refused", detail: "" })).toEqual({ kind: "refused" });
    });

    it("keeps a server's own English on rejected, for a log rather than a screen", () => {
        expect(serverProblemFromTeam({ kind: "refused", code: "conflict", detail: "already exists" }))
            .toEqual({ kind: "rejected", detail: "already exists" });
    });

    it("lands a method a server does not offer, and a server it has no record of, on unknown", () => {
        expect(serverProblemFromTeam({ kind: "unsupported" })).toEqual({ kind: "unknown" });
        expect(serverProblemFromTeam({ kind: "no-server" })).toEqual({ kind: "unknown" });
    });
});
