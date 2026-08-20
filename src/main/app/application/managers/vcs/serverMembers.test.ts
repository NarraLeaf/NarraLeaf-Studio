import { beforeEach, describe, expect, it, vi } from "vitest";
import { listServerMembers } from "./serverMembers";

/**
 * The roster, read as the server sends it.
 *
 * Two things are being decided here and neither is obvious from the wire. The first is
 * what an account with a field missing becomes: a display name it did not give falls back
 * to the username, because a row with no name is a row nobody can read, and the three flags
 * fall back to false, because marking nobody is a plain list where marking somebody is a
 * claim about their authority. The second is that the address travels - the panel is where
 * the decision not to print it lives, and a reader who opens one member gets one.
 */

const askServer = vi.hoisted(() => vi.fn());

vi.mock("./serverApi", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    askServer,
}));

const CREDENTIALS = {
    authUrl: "https://team.example.lan:41402",
    token: "token",
    userDataDir: "D:/userData",
};

function answers(value: unknown): void {
    askServer.mockResolvedValue({ ok: true, value });
}

/** Narrow a result to its answer, failing the test rather than the type check. */
function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
    expect(result).toMatchObject({ ok: true });
    return result as Extract<T, { ok: true }>;
}

beforeEach(() => askServer.mockReset());

describe("reading a roster", () => {
    it("reads an account whole, address included", async () => {
        answers({
            members: [{
                username: "ada",
                displayName: "Ada Lovelace",
                email: "ada@nomen.example",
                operator: true,
                disabled: false,
                serviceAccount: false,
                createdAt: 1786767612503,
            }],
        });

        await expect(listServerMembers(CREDENTIALS)).resolves.toEqual({
            ok: true,
            members: [{
                username: "ada",
                displayName: "Ada Lovelace",
                email: "ada@nomen.example",
                operator: true,
                disabled: false,
                serviceAccount: false,
                createdAt: 1786767612503,
            }],
        });
    });

    it("falls back to the username where the server named nothing else", async () => {
        answers({ members: [{ username: "ci" }] });

        await expect(listServerMembers(CREDENTIALS)).resolves.toEqual({
            ok: true,
            members: [{
                username: "ci",
                displayName: "ci",
                // No address is an empty one rather than a missing field: every reader of
                // this asks the same question of it, and one answer is easier to get right.
                email: "",
                operator: false,
                disabled: false,
                serviceAccount: false,
            }],
        });
    });

    it("marks nobody an operator on a server that said nothing about anybody", async () => {
        answers({ members: [{ username: "ada", displayName: "Ada", operator: "yes" }] });

        const result = await listServerMembers(CREDENTIALS);

        // A string is not a yes. Guessing the other way would put authority on a row that
        // never claimed any.
        expect(ok(result).members[0].operator).toBe(false);
    });

    it("refuses a roster with an entry it cannot read rather than one name short", async () => {
        answers({ members: [{ username: "ada" }, { displayName: "no username" }] });

        await expect(listServerMembers(CREDENTIALS))
            .resolves.toEqual({ ok: false, problem: { kind: "unknown" } });
    });

    it("refuses an answer that is not a roster at all", async () => {
        answers({ members: "everybody" });

        await expect(listServerMembers(CREDENTIALS))
            .resolves.toEqual({ ok: false, problem: { kind: "unknown" } });
    });

    it("hands a refusal back coded, as it came", async () => {
        askServer.mockResolvedValue({ ok: false, problem: { kind: "refused" } });

        await expect(listServerMembers(CREDENTIALS))
            .resolves.toEqual({ ok: false, problem: { kind: "refused" } });
    });

    it("asks the one path, and asks it with the token", async () => {
        answers({ members: [] });

        await listServerMembers(CREDENTIALS);

        expect(askServer).toHaveBeenCalledWith({ ...CREDENTIALS, path: "/api/studio/v1/members" });
    });
});
