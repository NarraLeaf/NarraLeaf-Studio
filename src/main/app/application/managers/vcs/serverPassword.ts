/**
 * Exchanging a username and a password for a token.
 *
 * The other way in is a token an operator minted and handed over out of band. That works,
 * and it asks an author to hold a credential they cannot read, check or remember. A server
 * that says so accepts the pair of things they already have instead, and answers with the
 * same token the operator would have sent them - so everything after this point, including
 * the record this installation keeps, is the sign-in it always was.
 *
 * **Nothing here keeps the password.** It arrives as an argument, goes into one request
 * body, and is gone when this returns. It is never logged, never stored, and never part of
 * anything passed back.
 *
 * This reads the status itself rather than going through `askServer`, because the status
 * is the whole of what distinguishes "this server has no such route" from "these are not
 * the right credentials", and those two send the author to different places.
 */
import type { VcsPasswordSignInReason } from "@shared/types/vcs";

import { endpointOf, request, STUDIO_API_ROOT } from "./serverApi";

/** Where a server that offers this serves it. */
const SIGN_IN_PATH = `${STUDIO_API_ROOT}/sign-in`;

/** What a password sign-in came to, in the terms the interface has sentences for. */
export type ServerPasswordResult =
    | { ok: true; token: string }
    | { ok: false; reason: VcsPasswordSignInReason };

export interface ServerPasswordRequest {
    /** The endpoint the discovery document named, e.g. `https://team.example.lan:54080`. */
    authUrl: string;
    username: string;
    password: string;
    /** The code from the authenticator app, sent on the second try once the server asked for one. */
    code?: string;
    userDataDir: string;
}

/**
 * Present a username and password, and hand back the token if the server accepted them.
 *
 * **Every refusal is one refusal.** A server that offers this answers an unknown account,
 * a wrong password, a disabled account and a machine account with one identical 401 and
 * one identical sentence - measured against a real server - so there is nothing here to
 * tell apart, and an interface that claimed otherwise would be inventing the difference.
 */
export async function signInWithPassword(
    input: ServerPasswordRequest,
): Promise<ServerPasswordResult> {
    const endpoint = endpointOf(input.authUrl);
    if (endpoint === null) return { ok: false, reason: "unknown" };

    let answer;
    try {
        answer = await request(endpoint, {
            method: "POST",
            path: SIGN_IN_PATH,
            userDataDir: input.userDataDir,
            body: JSON.stringify(input.code === undefined
                ? { username: input.username, password: input.password }
                : { username: input.username, password: input.password, code: input.code }),
        });
    } catch {
        return { ok: false, reason: "unreachable" };
    }

    // Older than this route, so no password will ever work here and the remedy is a token.
    if (answer.status === 404 || answer.status === 405) {
        return { ok: false, reason: "unavailable" };
    }
    if (answer.status === 401 || answer.status === 403) {
        return { ok: false, reason: refusalOf(answer.body, input.code !== undefined) };
    }
    if (answer.status !== 200) {
        return { ok: false, reason: "unknown" };
    }

    let token: unknown;
    try {
        const body: unknown = JSON.parse(answer.body);
        token = typeof body === "object" && body !== null && "token" in body
            ? (body as { token: unknown }).token
            : undefined;
    } catch {
        return { ok: false, reason: "unknown" };
    }

    // Accepted, and did not say with what. There is nothing to store and nothing the
    // author could do differently, so it joins every other answer that could not be read.
    return typeof token === "string" && token.trim() !== ""
        ? { ok: true, token: token.trim() }
        : { ok: false, reason: "unknown" };
}

/**
 * Which refusal a 401 or 403 was.
 *
 * A server that knows about codes says so in the body, and only once the password was
 * right: `secondFactor` asks for a code (or, when one was sent, says it was wrong), and
 * `enrollTwoFactor` says this account must set one up in the web console first. Anything
 * else - including a body that is not JSON - is the one refusal it always was.
 */
function refusalOf(body: string, sentCode: boolean): VcsPasswordSignInReason {
    let parsed: unknown;
    try {
        parsed = JSON.parse(body);
    } catch {
        return "refused";
    }
    if (typeof parsed !== "object" || parsed === null) return "refused";
    const flags = parsed as { secondFactor?: unknown; enrollTwoFactor?: unknown };
    if (flags.enrollTwoFactor === true) return "enroll-two-factor";
    if (flags.secondFactor === true) return sentCode ? "bad-code" : "second-factor";
    return "refused";
}
