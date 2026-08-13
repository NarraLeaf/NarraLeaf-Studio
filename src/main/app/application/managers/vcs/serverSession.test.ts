import { describe, expect, it } from "vitest";
import { isVcsSignInAddress } from "@shared/types/vcs";
import { VcsSignInError, decodeServerAccount } from "./serverSession";

/**
 * Reading a token, and refusing the things that are not one.
 *
 * Pure: nothing here loads the native library or opens a socket. What it pins is the one
 * step Studio takes on its own behalf before anything is sent - working out which account
 * a token belongs to - because getting it wrong does not fail here. It fails later, at a
 * connection, as `No token stored`, which reads as a token that was never presented.
 *
 * The tokens below are assembled rather than pasted from a server: a real one is a
 * credential, and a fixture that is one would be a credential in the repository.
 */

/** A compact JWT with these claims, signed with nothing. Nothing here verifies signatures. */
function tokenWith(claims: Record<string, unknown>): string {
    const segment = (value: unknown) => Buffer.from(JSON.stringify(value), "utf-8").toString("base64url");
    return `${segment({ alg: "RS256", typ: "JWT" })}.${segment(claims)}.${"c".repeat(16)}`;
}

const ACCOUNT = {
    sub: "53a8fe3e-51c2-4350-bf84-5292886906aa",
    name: "Ada Blackwood",
    preferred_username: "ada",
    exp: 1789170313,
};

describe("reading a sign-in token", () => {
    it("takes the account from the token rather than from anything typed", () => {
        const account = decodeServerAccount(tokenWith(ACCOUNT));
        expect(account.userId).toBe(ACCOUNT.sub);
        expect(account.displayName).toBe("Ada Blackwood");
        expect(account.username).toBe("ada");
        // Milliseconds, because a JWT counts in seconds and every date in this product does not.
        expect(account.expiresAt).toBe(ACCOUNT.exp * 1000);
    });

    it("records the same identity shape a project with no server records", () => {
        const withEmail = decodeServerAccount(tokenWith({ ...ACCOUNT, email: "ada@example.com" }));
        expect(withEmail.identity).toBe("Ada Blackwood <ada@example.com>");
        // A server that keeps no address is not an error and must not produce empty angle
        // brackets: a history is read by people, and `Ada Blackwood <>` names nobody.
        expect(decodeServerAccount(tokenWith(ACCOUNT)).identity).toBe("Ada Blackwood");
    });

    it("accepts an account id under either of the two names a server may use", () => {
        const { sub, ...withoutSub } = ACCOUNT;
        expect(sub).toBeTruthy();
        expect(decodeServerAccount(tokenWith({ ...withoutSub, user_id: sub })).userId).toBe(sub);
    });

    it("falls back through the names a token may or may not carry", () => {
        const { name, ...withoutName } = ACCOUNT;
        expect(name).toBeTruthy();
        // No display name: the account name is a better answer than the identifier.
        expect(decodeServerAccount(tokenWith(withoutName)).displayName).toBe("ada");
        const { preferred_username, ...bare } = withoutName;
        expect(preferred_username).toBeTruthy();
        // Neither: the identifier is all there is, and it is better than an empty line.
        expect(decodeServerAccount(tokenWith(bare)).displayName).toBe(ACCOUNT.sub);
    });

    it("refuses a paste that is not a token, and says that rather than failing at a connection", () => {
        for (const rubbish of ["", "   ", "not-a-token", "one.two", "a.b.c.d"]) {
            expect(() => decodeServerAccount(rubbish), rubbish).toThrowError(VcsSignInError);
        }
        // Three parts and a payload that is not JSON: shaped like a token, and is not one.
        expect(() => decodeServerAccount("aaa.bbb.ccc")).toThrowError(VcsSignInError);
    });

    it("refuses a token that names no account", () => {
        const { sub, ...withoutAccount } = ACCOUNT;
        expect(sub).toBeTruthy();
        let thrown: unknown;
        try {
            decodeServerAccount(tokenWith(withoutAccount));
        } catch (error) {
            thrown = error;
        }
        expect((thrown as VcsSignInError).problem).toEqual({ kind: "token" });
    });
});

describe("a sign-in address", () => {
    it("accepts only the two schemes the backend has an implementation for", () => {
        // Measured against a running server: anything else is refused by name, and the
        // one people type is the one that is refused - so this is checked before a socket.
        expect(isVcsSignInAddress("https://studio.example.lan:41402")).toBe(true);
        expect(isVcsSignInAddress("ucs-auth://studio.example.lan:41402")).toBe(true);
        expect(isVcsSignInAddress("HTTPS://studio.example.lan:41402")).toBe(true);
        expect(isVcsSignInAddress("http://studio.example.lan:41402")).toBe(false);
        expect(isVcsSignInAddress("grpc://studio.example.lan:41402")).toBe(false);
        expect(isVcsSignInAddress("lore://studio.example.lan:41337")).toBe(false);
    });

    it("is an origin, not an address with something after it", () => {
        expect(isVcsSignInAddress("https://studio.example.lan:41402/")).toBe(true);
        expect(isVcsSignInAddress("https://studio.example.lan:41402/auth")).toBe(false);
        expect(isVcsSignInAddress("studio.example.lan:41402")).toBe(false);
        expect(isVcsSignInAddress("")).toBe(false);
    });
});
