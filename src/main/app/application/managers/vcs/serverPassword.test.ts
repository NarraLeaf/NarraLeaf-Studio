import { beforeEach, describe, expect, it, vi } from "vitest";
import { signInWithPassword } from "./serverPassword";

/**
 * Presenting a username and a password, read as the server answers it.
 *
 * Three things are decided here and none of them is visible from the shape of the call.
 *
 * The request carries **no bearer token at all** - not an empty one - because this is the
 * one route asked before a token exists, and a header saying `Bearer ` is a claim to be
 * carrying something.
 *
 * The status is what separates the answers, not the sentence in the body: a server too old
 * for this route says 404 and the remedy is to ask for a token, while a server that has the
 * route and refused says 401 and the remedy is different credentials. Reading the English
 * in the body would tie Studio to one server's wording.
 *
 * And a server says one thing however the credentials were wrong, so there is exactly one
 * refusal here to tell anybody about.
 */

const request = vi.hoisted(() => vi.fn());

vi.mock("./serverApi", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    request,
}));

const INPUT = {
    authUrl: "https://team.example.lan:41402",
    username: "ada",
    password: "harbourlight",
    userDataDir: "D:/userData",
};

function answers(status: number, body: unknown): void {
    request.mockResolvedValue({ status, body: typeof body === "string" ? body : JSON.stringify(body) });
}

beforeEach(() => request.mockReset());

describe("signing in with a password", () => {
    it("hands back the token the server issued", async () => {
        answers(200, { token: "  eyJhbGciOi.token.value  ", account: { username: "ada" } });
        await expect(signInWithPassword(INPUT)).resolves.toEqual({
            ok: true,
            token: "eyJhbGciOi.token.value",
        });
    });

    it("presents no bearer, because this is where one comes from", async () => {
        answers(200, { token: "t" });
        await signInWithPassword(INPUT);
        const [, options] = request.mock.calls[0] as [unknown, { token?: string; method: string; body: string }];
        expect(options.token).toBeUndefined();
        expect(options.method).toBe("POST");
    });

    it("sends the credentials as the body and nowhere else", async () => {
        answers(200, { token: "t" });
        await signInWithPassword(INPUT);
        const [endpoint, options] = request.mock.calls[0] as [unknown, { path: string; body: string }];
        expect(JSON.parse(options.body)).toEqual({ username: "ada", password: "harbourlight" });
        // The password must not have been smuggled into the address or anything else the
        // call carries: a query string is written to logs by things Studio does not own.
        expect(options.path).not.toContain("harbourlight");
        expect(JSON.stringify(endpoint)).not.toContain("harbourlight");
    });

    it.each([401, 403])("reports one refusal for every wrong credential, on %i", async status => {
        answers(status, { error: "the username or password is not right" });
        await expect(signInWithPassword(INPUT)).resolves.toEqual({ ok: false, reason: "refused" });
    });

    it.each([404, 405])("says a server without the route cannot do this, on %i", async status => {
        answers(status, { error: "this server has nothing at that address." });
        await expect(signInWithPassword(INPUT)).resolves.toEqual({ ok: false, reason: "unavailable" });
    });

    it("says nothing answered when the call did not complete", async () => {
        // Thrown from the implementation, and only for this one call: a rejected promise
        // made up front is already rejected before anything awaits it, and an
        // implementation left in place rejects again for whatever runs next.
        request.mockImplementationOnce(async () => { throw new Error("ETIMEDOUT"); });
        await expect(signInWithPassword(INPUT)).resolves.toEqual({ ok: false, reason: "unreachable" });
    });

    it("does not read an accepted answer that carried no token as a sign-in", async () => {
        answers(200, { account: { username: "ada" } });
        await expect(signInWithPassword(INPUT)).resolves.toEqual({ ok: false, reason: "unknown" });
    });

    it("does not read a body that is not JSON as a sign-in", async () => {
        answers(200, "<html>a proxy answered instead</html>");
        await expect(signInWithPassword(INPUT)).resolves.toEqual({ ok: false, reason: "unknown" });
    });

    it("refuses an address it cannot resolve to an endpoint, without calling out", async () => {
        await expect(signInWithPassword({ ...INPUT, authUrl: "not an address" }))
            .resolves.toEqual({ ok: false, reason: "unknown" });
        expect(request).not.toHaveBeenCalled();
    });
});
