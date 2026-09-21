import { describe, expect, it } from "vitest";
import { isVcsSignInAddress, vcsAuthorityIsVouchedFor } from "@shared/types/vcs";
import type { VcsServerAuthority } from "@shared/types/vcs";
import { authorityInstallPlan } from "./authorityTrust";
import {
    VcsSignInError,
    decodeServerAccount,
    isSignInRefusal,
    readSignInToken,
    signInAddressFor,
    signInToServer,
} from "./serverSession";

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

/**
 * What a token answers about itself.
 *
 * This is the difference between a form with two boxes an author was told to fill in by
 * somebody else, and a form with one box holding the thing they were actually given. A
 * real Team server writes seven audience entries for one host - every spelling the client
 * compares against - and two of them are the addresses Studio needs.
 */
describe("reading the addresses out of a token", () => {
    const AUDIENCE = [
        "loreserver",
        "https://team.example.lan:41402",
        "https://team.example.lan:41402/",
        "team.example.lan",
        "team.example.lan:41337",
        "lore://team.example.lan:41337",
        "lore://team.example.lan:41337/",
    ];

    it("takes the sign-in address from the audience, so nobody has to be told it", () => {
        const read = readSignInToken(tokenWith({ ...ACCOUNT, aud: AUDIENCE }));
        expect(read.authUrl).toBe("https://team.example.lan:41402");
        // Once, though the audience names it twice. The trailing slash is one of the
        // spellings the audience carries on purpose and is not a second address.
        expect(read.remotes).toEqual(["lore://team.example.lan:41337"]);
    });

    it("carries the fingerprint the server signs with, when the token names one", () => {
        const fingerprint = "3D:38:9F:E6:12:C3:14:F0:C5:28:53:41:39:06:DC:E9:B6:0A:7A:EA:F1:FF:D0:3C:B2:4C:F8:71:01:46:DC:48";
        const read = readSignInToken(tokenWith({ ...ACCOUNT, aud: AUDIENCE, authority_sha256: fingerprint }));
        expect(read.authorityFingerprint).toBe(fingerprint);
    });

    it("answers empty for a token that says none of it, rather than inventing one", () => {
        // A plain loreserver's token, and a Team server older than the claim. Both stay working:
        // empty is what makes the address field appear and the fingerprint be compared
        // by a person, which is what everybody did before this.
        const read = readSignInToken(tokenWith(ACCOUNT));
        expect(read.authUrl).toBe("");
        expect(read.remotes).toEqual([]);
        expect(read.authorityFingerprint).toBe("");
        // The account is still read, because that half never depended on the audience.
        expect(read.account.userId).toBe(ACCOUNT.sub);
    });

    it("reads a single-valued audience, which is legal even though a Team server writes an array", () => {
        expect(readSignInToken(tokenWith({ ...ACCOUNT, aud: "https://one.example.lan" })).authUrl)
            .toBe("https://one.example.lan");
    });

    it("asks for an address only once it is established that nothing can supply one", async () => {
        // Refused before anything is dialled, which is what lets the rail keep the
        // address field hidden until this answer comes back.
        const attempt = signInToServer({ repositoryPath: "", offline: false, cache: false }, {
            remoteUrl: "lore://team.example.lan:41337",
            authUrl: "",
            token: tokenWith(ACCOUNT),
            userDataDir: "",
        });
        await expect(attempt).rejects.toBeInstanceOf(VcsSignInError);
        await attempt.catch((error: VcsSignInError) => {
            expect(error.problem).toEqual({ kind: "address" });
        });
    });
});

/**
 * Where a token is presented.
 *
 * A token is a bearer credential, and the sign-in sends it to whatever address this settles on. So
 * the address a request carries may not overrule the one the token names for itself - it used to,
 * which made the destination of the credential a field anybody filling in the request could set.
 * The typed address is still how a token that names no endpoint - a plain `loreserver`'s - is
 * presented anywhere at all.
 */
describe("choosing where a token is presented", () => {
    const NAMED = { authUrl: "https://team.example.lan:41402", authUrls: ["https://team.example.lan:41402"] };

    it("presents a token where it says, when nothing else is given", () => {
        expect(signInAddressFor(NAMED, "")).toBe("https://team.example.lan:41402");
    });

    it("refuses an address the token does not name, before anything is sent", () => {
        expect(() => signInAddressFor(NAMED, "https://collector.example.net:41402")).toThrow(VcsSignInError);
        try {
            signInAddressFor(NAMED, "https://collector.example.net:41402");
        } catch (error) {
            // Said as a token that is not for this server, which is what it is: the panel's
            // sentence for that already exists and names the remedy.
            expect((error as VcsSignInError).problem).toEqual({ kind: "token" });
        }
    });

    it("refuses the same host on another port, which is another endpoint", () => {
        expect(() => signInAddressFor(NAMED, "https://team.example.lan:41403")).toThrow(VcsSignInError);
    });

    it("accepts the token's own endpoint however it is spelled, and uses the token's spelling", () => {
        // The spellings a discovery answer and an audience are known to disagree on while
        // naming one endpoint: case, a trailing slash.
        expect(signInAddressFor(NAMED, "HTTPS://Team.Example.LAN:41402/")).toBe("https://team.example.lan:41402");
    });

    it("drops a default port the same way on both sides", () => {
        const named = { authUrl: "https://team.example.lan", authUrls: ["https://team.example.lan"] };
        expect(signInAddressFor(named, "https://team.example.lan:443")).toBe("https://team.example.lan");
    });

    it("accepts any of several endpoints a token names", () => {
        const named = {
            authUrl: "https://one.example.lan:41402",
            authUrls: ["https://one.example.lan:41402", "https://two.example.lan:41402"],
        };
        expect(signInAddressFor(named, "https://two.example.lan:41402")).toBe("https://two.example.lan:41402");
    });

    it("takes a typed address for a token that names none, which is the case it exists for", () => {
        const none = { authUrl: "", authUrls: [] };
        expect(signInAddressFor(none, "https://lan.example:41402")).toBe("https://lan.example:41402");
    });

    it("asks for an address where neither side has one", () => {
        const none = { authUrl: "", authUrls: [] };
        try {
            signInAddressFor(none, "  ");
            expect.unreachable();
        } catch (error) {
            expect((error as VcsSignInError).problem).toEqual({ kind: "address" });
        }
    });

    it("is what a sign-in goes through, so a mismatch is refused before the backend is reached", async () => {
        const token = tokenWith({ ...ACCOUNT, aud: ["https://team.example.lan:41402", "lore://team.example.lan:41337"] });
        // No backend is loaded in this file; reaching it would fail differently. The refusal is
        // the token problem, which is only raised before anything is dialled.
        const attempt = signInToServer({ repositoryPath: "", offline: false, cache: false }, {
            remoteUrl: "lore://team.example.lan:41337",
            authUrl: "https://collector.example.net:41402",
            token,
            userDataDir: "",
        });
        await attempt.then(
            () => expect.unreachable(),
            (error: VcsSignInError) => expect(error.problem).toEqual({ kind: "token" }),
        );
    });
});

/**
 * Whether the token vouches for the authority that actually answered.
 *
 * Three states, and the interface does something different in each: offer to install,
 * warn that something else is answering, or fall back to asking a person. The middle one
 * is why this is not simply "do we have a fingerprint".
 */
describe("comparing an authority against what a token vouched for", () => {
    const authority = (fields: Partial<VcsServerAuthority>): VcsServerAuthority => ({
        fingerprint: "AA:BB",
        expected: "",
        subject: "CN=NarraLeaf Team",
        expiresAt: "Aug 12 00:00:00 2036 GMT",
        path: "",
        canInstall: true,
        command: "",
        ...fields,
    });

    it("is vouched for when the token names the authority that answered", () => {
        expect(vcsAuthorityIsVouchedFor(authority({ expected: "AA:BB" }))).toBe(true);
        // Case is not the difference between two certificates.
        expect(vcsAuthorityIsVouchedFor(authority({ expected: "aa:bb" }))).toBe(true);
    });

    it("is not vouched for when the token named something else", () => {
        // The shape an interception has, and the interface must not read it as merely
        // "no claim": the token named an authority and a different one answered.
        expect(vcsAuthorityIsVouchedFor(authority({ expected: "CC:DD" }))).toBe(false);
    });

    it("is not vouched for by a token that named nothing", () => {
        expect(vcsAuthorityIsVouchedFor(authority({}))).toBe(false);
        expect(vcsAuthorityIsVouchedFor(authority({ expected: "   " }))).toBe(false);
    });
});

/** What this platform does about a certificate, and what it admits it cannot do. */
describe("the install plan", () => {
    const certificate = process.platform === "win32" ? "C:\\Users\\a b\\team.crt" : "/home/a b/team.crt";

    it("names the certificate this machine holds, quoted for the shell it is pasted into", () => {
        const plan = authorityInstallPlan(certificate);
        expect(plan.command).toContain("team.crt");
        // A path with a space in it is ordinary on both platforms that have a per-user
        // store, and an unquoted one produces a command that fails on the second word.
        expect(plan.command).toMatch(/["']/);
    });

    it("passes the path as one argument rather than through a shell", () => {
        const plan = authorityInstallPlan(certificate);
        if (!plan.canInstall) {
            // Linux: nothing is run, so there is nothing to pass. The command is still
            // printed, and the certificate is still on this machine for it to name.
            expect(plan.argv).toEqual([]);
            expect(plan.command).toContain("sudo");
            return;
        }
        // Unquoted here, because nothing takes this apart on spaces.
        expect(plan.argv).toContain(certificate);
        expect(plan.argv[0]).toBe(process.platform === "win32" ? "certutil" : "security");
    });

    it("installs for this account, never for the machine", () => {
        // The whole of the blast radius argument. On Windows that is `-user`; on macOS it
        // is the absence of `-d`, which would make it the system keychain.
        const plan = authorityInstallPlan(certificate);
        if (process.platform === "win32") expect(plan.argv).toContain("-user");
        if (process.platform === "darwin") expect(plan.argv).not.toContain("-d");
    });
});


describe("telling a refusal from anything else the endpoint says", () => {
    /**
     * The sentence a real server sends, measured against loreserver 0.8.6 behind a Team
     * auth endpoint that had already been trusted on this machine.
     *
     * It reads as a refusal to a person and used to read as `unknown` to Studio, which
     * meant the panel offered "The server could not be added" instead of the sentence
     * that names the cause and the remedy.
     */
    const MEASURED =
        `authLoginWithToken: exchanging external token: code: `
        + `'The request does not have valid authentication credentials', `
        + `message: "the token presented for exchange was not accepted"`;

    it("reads the sentence a server sends for a token it will not take", () => {
        expect(isSignInRefusal(MEASURED)).toBe(true);
    });

    it("still reads the wordings that were already known", () => {
        expect(isSignInRefusal("rpc error: code = Unauthenticated")).toBe(true);
        expect(isSignInRefusal("permission denied for this repository")).toBe(true);
        expect(isSignInRefusal("token is expired")).toBe(true);
        expect(isSignInRefusal("invalid signature")).toBe(true);
    });

    it("does not read the failures that are somebody else's to explain", () => {
        // The transport branch answers these before this predicate is reached, and it has
        // a remedy of its own: nothing here may take them.
        expect(isSignInRefusal("transport error")).toBe(false);
        expect(isSignInRefusal("failed to connect to auth endpoint")).toBe(false);
        expect(isSignInRefusal("no authentication implementation registered for scheme")).toBe(false);
    });
});