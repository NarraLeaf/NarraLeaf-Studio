import tls from "tls";
import { X509Certificate } from "crypto";
import {
    VCS_SIGN_IN_SCHEMES,
    composeVcsIdentity,
    isVcsSignInAddress,
    parseVcsRemoteUrl,
    vcsAddressesInAudience,
    type VcsServerAccount,
    type VcsServerSession,
    type VcsSignInProblem,
    type VcsSignInToken,
} from "@shared/types/vcs";
import { describeAuthority, writeAuthorityCertificate } from "./authorityTrust";
import {
    listAuthSessions,
    loginWithToken,
    logoutFromRemote,
    type LoreGlobals,
} from "./lore";

/**
 * Signing this installation in to a server that verifies who is calling.
 *
 * A bare `loreserver` accepts anybody and nothing here ever runs against one. A server
 * with a `[server.auth]` section does not, and then two things have to be true before a
 * single revision can move: a token issued by whoever runs that server has to be in the
 * backend's per-user store, and the calls that reach the network have to carry the
 * account id that store is keyed by.
 *
 * Three things about this cost a day each if they are not known in advance. All three
 * were measured against a running server rather than read off a protocol document:
 *
 *  - **The sign-in address must be `https` or `ucs-auth`.** The client refuses every
 *    other scheme by name, `http` included, and `http` is what a person types. It is
 *    also, now, not a thing an author types at all: a token names its own endpoint in
 *    `aud`, and {@link readSignInToken} reads it out.
 *  - **The certificate must chain to this machine's own trust store.** There is no
 *    pinning hook to pass an authority through and `SSL_CERT_FILE` does nothing on
 *    Windows, so nothing inside the connection can establish trust the first time. The
 *    decision is a person's and stays one, but it is made here, against a fingerprint
 *    the token carries - see `authorityTrust.ts` for what installing it means.
 *  - **Every transport failure comes back as the same sentence.** An untrusted
 *    authority, a port nothing listens on, an unresolvable name and an endpoint
 *    speaking plain HTTP all produce `exchanging external token: failed to connect to
 *    auth endpoint: transport error`. Only the timing differs (10 ms, 2.04 s, 233 ms,
 *    6 ms). That is why {@link diagnoseEndpoint} exists: without it the author is told
 *    "transport error" and has four unrelated things to try.
 *
 * The token itself is never stored by Studio, never logged and never sent to a
 * renderer. It goes straight into the backend's store, which is where the rest of the
 * system reads it from.
 */

/** A sign-in that did not happen, carrying which of the failures it was. */
export class VcsSignInError extends Error {
    constructor(readonly problem: VcsSignInProblem, message: string) {
        super(message);
        this.name = "VcsSignInError";
    }
}

/**
 * Read the account out of a token without verifying it.
 *
 * Verification is the server's job and it does it on every exchange; nothing is decided
 * here that a forged token could turn to anyone's advantage. What this is for is
 * refusing a paste that is not a token at all, at the moment of the paste, instead of
 * letting it fail later as a connection error that names nothing.
 *
 * `sub` is the account id. The claim set also carries the display name and the account
 * name; an address is optional, and a server that records none simply produces an
 * identity with no angle brackets - the same shape as an author who set no email.
 */
function tokenClaims(token: string): Record<string, unknown> {
    const parts = token.trim().split(".");
    if (parts.length !== 3 || !parts[1]) {
        throw new VcsSignInError(
            { kind: "token" },
            "That is not a sign-in token. Paste the whole token the server's operator gave you.",
        );
    }

    try {
        return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as Record<string, unknown>;
    } catch {
        throw new VcsSignInError(
            { kind: "token" },
            "That token could not be read. Paste the whole token the server's operator gave you.",
        );
    }
}

export function decodeServerAccount(token: string): VcsServerAccount {
    const claims = tokenClaims(token);

    const text = (key: string): string => (typeof claims[key] === "string" ? (claims[key] as string).trim() : "");
    // `sub` is where the account id belongs in a JWT and is what this server writes.
    // `user_id` is accepted beside it because that is the name the backend's own
    // session store uses for the same value, and a server spelling it that way would
    // otherwise be refused for having no account in it.
    const userId = text("sub") || text("user_id");
    if (!userId) {
        throw new VcsSignInError(
            { kind: "token" },
            "That token names no account, so it is not one this server issued.",
        );
    }

    const username = text("preferred_username");
    const displayName = text("name") || username || userId;
    const email = text("email");
    const expires = typeof claims.exp === "number" ? claims.exp : 0;

    return {
        userId,
        displayName,
        username,
        email,
        // The same shape every other version-control tool records, built by the same
        // function the offline settings go through - so a project's history does not
        // change format when its author signs in.
        identity: composeVcsIdentity(displayName, email) || displayName,
        expiresAt: expires > 0 ? expires * 1000 : 0,
    };
}

/**
 * Read everything a token answers about itself: who, where, and which authority.
 *
 * The two addresses come out of `aud`, which a token carries because the client
 * compares it against whatever it is dialling. That makes them the server's own
 * statement about itself rather than something an author was told over chat and asked to
 * retype - and retyping was where this went wrong for people who do not run the server.
 *
 * The fingerprint is Hub's `authority_sha256`. Nothing verifies the signature over it,
 * and `vcsAuthorityIsVouchedFor` in shared types is where that is accounted for.
 */
export function readSignInToken(token: string): VcsSignInToken {
    const account = decodeServerAccount(token);
    const claims = tokenClaims(token);
    const audience = Array.isArray(claims.aud)
        ? (claims.aud as unknown[])
        // A single-valued audience is legal JWT and a Hub does not write one, but a
        // server that does would otherwise have its one address ignored.
        : typeof claims.aud === "string" ? [claims.aud] : [];
    const { authUrls, remotes } = vcsAddressesInAudience(audience);
    const fingerprint = typeof claims.authority_sha256 === "string" ? claims.authority_sha256.trim() : "";

    return {
        account,
        authUrl: authUrls[0] ?? "",
        remotes,
        authorityFingerprint: fingerprint,
    };
}

/** What the endpoint's certificate chain came to, or why there was no chain to look at. */
type EndpointVerdict =
    | { kind: "authority"; fingerprint: string; pem: string; subject: string; expiresAt: string }
    | { kind: "unreachable"; detail: string }
    | { kind: "unknown"; detail: string };

/**
 * What is actually wrong with a sign-in address, after the backend has said only
 * "transport error".
 *
 * Run ONLY after a failure. Node verifies against its own bundled roots rather than the
 * platform's, so an authority a person has installed in the Windows store would look
 * untrusted here - which would be a wrong answer if this ran on the happy path, and is
 * harmless when the happy path never reaches it.
 *
 * The fingerprint of the authority is carried back because it is what the person
 * compares against the one their server printed. Naming it is the difference between
 * "trust something" and "trust this".
 */
export async function diagnoseEndpoint(authUrl: string, timeoutMs = 5_000): Promise<EndpointVerdict> {
    let parsed: URL;
    try {
        parsed = new URL(authUrl);
    } catch {
        return { kind: "unreachable", detail: authUrl };
    }
    const port = parsed.port ? Number(parsed.port) : 443;
    const host = parsed.hostname;

    return new Promise<EndpointVerdict>((resolve) => {
        let settled = false;
        const done = (verdict: EndpointVerdict) => {
            if (settled) return;
            settled = true;
            socket.destroy();
            resolve(verdict);
        };

        const socket = tls.connect({
            host,
            port,
            // The handshake has to complete before the certificate can be looked at, so
            // verification is off here and the verdict is reached from the chain below.
            // Nothing is sent on this socket: it is opened to look and closed again.
            rejectUnauthorized: false,
            // An IP address is not a valid SNI name, and passing one makes node warn.
            servername: /^[\d.]+$/.test(host) || host.includes(":") ? undefined : host,
        }, () => {
            const certificate = socket.getPeerCertificate(true);
            if (!certificate || Object.keys(certificate).length === 0) {
                done({ kind: "unknown", detail: "the endpoint offered no certificate" });
                return;
            }
            // Walk to the top of the chain: what a person trusts is the authority, not
            // the endpoint's own certificate, and the authority is what their server's
            // trust command prints a fingerprint for. Trusting the leaf instead would
            // also have to be redone every time the endpoint's certificate is replaced,
            // which a Hub does yearly on its own.
            let root = certificate;
            const seen = new Set<string>();
            while (root.issuerCertificate && !seen.has(root.fingerprint256)) {
                seen.add(root.fingerprint256);
                if (root.issuerCertificate === root) break;
                root = root.issuerCertificate;
            }
            if (!root.raw) {
                done({ kind: "unknown", detail: "the endpoint's certificate could not be read" });
                return;
            }
            // Re-read from the DER rather than trusting the fields beside it: `raw` is
            // what would be written to disk and installed, so the fingerprint shown must
            // be that file's, not one reported alongside it.
            const parsedRoot = new X509Certificate(root.raw);
            done({
                kind: "authority",
                fingerprint: parsedRoot.fingerprint256,
                pem: parsedRoot.toString(),
                subject: parsedRoot.subject.split("\n").join(", "),
                expiresAt: parsedRoot.validTo,
            });
        });

        socket.setTimeout(timeoutMs, () => done({ kind: "unreachable", detail: `${host}:${port} did not answer` }));
        socket.on("error", (error: NodeJS.ErrnoException) => {
            // A TLS-level error on a socket that did connect is still a certificate
            // question - the endpoint is there, it simply would not agree with us.
            done(error.code && /ECONN|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EAI_AGAIN/.test(error.code)
                ? { kind: "unreachable", detail: `${host}:${port}: ${error.code}` }
                : { kind: "unknown", detail: error.message });
        });
    });
}

/**
 * Present a token to a server and keep the session it hands back.
 *
 * `globals.identity` is the account id here and on every later call that reaches the
 * network, because that is the key the backend's session store is looked up by. It is
 * not the author's name and must never be confused with one: passing the name instead
 * fails with `No token stored`, which reads as a token that was never presented rather
 * than one that was stored under a different key.
 *
 * The repository path on the globals is incidental - the store this writes is per-user
 * and outside any repository - but the backend still wants one, so callers pass the
 * project they are signing in from.
 */
export async function signInToServer(
    globals: LoreGlobals,
    options: { remoteUrl: string; authUrl: string; token: string; userDataDir: string },
): Promise<VcsServerSession> {
    // The token is read first now, because it is what says where to go. A typed address
    // still wins - it is the way to reach a server whose tokens name no endpoint, and a
    // way to correct one that names the wrong one.
    const read = readSignInToken(options.token);
    const typed = options.authUrl.trim();
    const authUrl = typed || read.authUrl;
    if (!authUrl) {
        throw new VcsSignInError(
            { kind: "address" },
            "This token does not say where to sign in, so the address has to be typed.",
        );
    }
    if (!isVcsSignInAddress(authUrl)) {
        throw new VcsSignInError(
            { kind: "scheme" },
            `A sign-in address has to start with ${VCS_SIGN_IN_SCHEMES.map((s) => `${s}://`).join(" or ")}.`,
        );
    }

    const account = read.account;
    // The origin alone: the backend records only that much of a repository URL, and a
    // session written against the full address would not be found by a project whose
    // name on the server differs.
    const remoteOrigin = parseVcsRemoteUrl(options.remoteUrl)?.origin ?? options.remoteUrl.trim();

    try {
        await loginWithToken(
            { ...globals, offline: false, identity: account.userId },
            { remoteUrl: remoteOrigin, token: options.token.trim(), authUrl },
        );
    } catch (error) {
        throw await describeSignInFailure(error, authUrl, {
            userDataDir: options.userDataDir,
            expected: read.authorityFingerprint,
        });
    }

    return { authUrl, remoteOrigin, account, signedInAt: Date.now() };
}

/**
 * Turn what the backend said into the one thing the author has to do next.
 *
 * The transport sentence is the interesting case and the reason this is async: it means
 * four different things and the backend does not say which, so the endpoint is looked at
 * directly. Everything else the backend says about a token it has actually delivered is
 * specific enough to pass on.
 */
async function describeSignInFailure(
    error: unknown,
    authUrl: string,
    context: { userDataDir: string; expected: string },
): Promise<VcsSignInError> {
    if (error instanceof VcsSignInError) return error;
    const message = error instanceof Error ? error.message : String(error);

    if (/no authentication implementation registered for scheme/i.test(message)) {
        return new VcsSignInError(
            { kind: "scheme" },
            `A sign-in address has to start with ${VCS_SIGN_IN_SCHEMES.map((s) => `${s}://`).join(" or ")}.`,
        );
    }
    if (/transport error|failed to connect to auth endpoint/i.test(message)) {
        const verdict = await diagnoseEndpoint(authUrl);
        if (verdict.kind !== "authority") {
            return new VcsSignInError(verdict, message);
        }
        // Written before the author is asked anything, because the file is half of
        // what makes the answer actionable: on Linux the command names it, and on
        // every platform the fingerprint on screen is this file's.
        const certificatePath = await writeAuthorityCertificate(
            context.userDataDir,
            verdict.fingerprint,
            verdict.pem,
        ).catch(() => "");
        return new VcsSignInError(
            {
                kind: "certificate",
                authority: describeAuthority({
                    fingerprint: verdict.fingerprint,
                    expected: context.expected,
                    subject: verdict.subject,
                    expiresAt: verdict.expiresAt,
                    certificatePath,
                }),
            },
            message,
        );
    }
    // The endpoint answered and said no. Its own words name which no it was - expired,
    // revoked, meant for another server - and none of those is something this layer
    // could put better.
    if (/unauthenticated|permission denied|invalid|expired|refused/i.test(message)) {
        return new VcsSignInError({ kind: "refused", detail: message }, message);
    }
    return new VcsSignInError({ kind: "unknown", detail: message }, message);
}

/** Every session the backend is holding for this machine account. */
export async function readServerSessions(
    globals: LoreGlobals,
): Promise<Array<{ authUrl: string; resource: string; userId: string; expiresAt: number }>> {
    const sessions = await listAuthSessions(globals);
    return sessions.map((session) => ({
        authUrl: session.authUrl,
        resource: session.resource,
        userId: session.userId,
        expiresAt: session.expires,
    }));
}

/**
 * Take a signed-in account back off this machine.
 *
 * Every row for that account at that endpoint is cleared, not only the one with an empty
 * resource: measured, a session that has opened repositories has a row per repository
 * beside the endpoint-level one, and clearing only the latter leaves an account that is
 * signed out and still reaches its projects.
 */
export async function signOutOfServer(
    globals: LoreGlobals,
    options: { authUrl: string; userId: string },
): Promise<void> {
    const sessions = await listAuthSessions(globals);
    const mine = sessions.filter(
        (session) => session.userId === options.userId && session.authUrl === options.authUrl,
    );
    for (const session of mine) {
        await logoutFromRemote(globals, {
            authUrl: session.authUrl,
            resource: session.resource,
            userId: session.userId,
        });
    }
}
