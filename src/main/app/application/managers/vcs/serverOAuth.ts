/**
 * Signing in to a Team server through the browser, instead of typing a password here.
 *
 * Team is an OAuth 2.0 authorization server for this app (RFC 8252: a native app as a
 * public client). Studio listens on the loopback interface on a port the OS picks, opens
 * the system browser at the server's authorization page, and waits. The person signs in
 * there — or already is — and approves "NarraLeaf Studio on <this device>"; the browser is
 * sent back to the loopback listener with a code, and Studio redeems the code, with the
 * PKCE verifier only it holds, for the same token a password sign-in has always produced
 * plus a refresh token.
 *
 * **Nothing here sees a password.** The browser and the server handle that, and a password
 * manager or a single sign-on the person already has works as it does for any website.
 *
 * The refresh token is what keeps the sign-in alive without asking again: see
 * {@link refreshWithServer}. Both are sealed by `serverTokens` like the token always was.
 */
import { createHash, randomBytes } from "crypto";
import http from "http";
import type { AddressInfo } from "net";

import { endpointOf, request } from "./serverApi";

/** The client id Team knows this app by. */
export const STUDIO_OAUTH_CLIENT_ID = "narraleaf-studio";

/** How long Studio waits for the person to finish in the browser. */
const BROWSER_TIMEOUT_MS = 5 * 60 * 1000;

/** What a browser sign-in came to. */
export type ServerOAuthResult =
    | { ok: true; token: string; refreshToken: string }
    | { ok: false; reason: "denied" | "timeout" | "unreachable" | "refused" | "unknown" };

/** What a refresh came to. `refused` means the device was signed out: ask the person again. */
export type ServerRefreshResult =
    | { ok: true; token: string; refreshToken: string }
    | { ok: false; reason: "refused" | "unreachable" | "unknown" };

export interface ServerOAuthRequest {
    /** The endpoint the discovery document named, e.g. `https://team.example.lan:41402`. */
    authUrl: string;
    /** What the approval page calls this machine. */
    deviceName: string;
    userDataDir: string;
    /** Opens a URL in the system browser. `shell.openExternal` in the app. */
    openExternal: (url: string) => Promise<void>;
    /** Lets a caller stop waiting, when the person cancels in Studio. */
    signal?: AbortSignal;
}

function base64url(bytes: Buffer): string {
    return bytes.toString("base64url");
}

/** The page the browser lands on once it has handed the code back. Plain, and in both languages. */
function landingPage(ok: boolean): string {
    const zh = ok ? "已完成登录，请回到 NarraLeaf Studio。" : "登录没有完成，请回到 NarraLeaf Studio 重试。";
    const en = ok ? "Signed in. You can go back to NarraLeaf Studio." : "The sign-in did not finish. Go back to NarraLeaf Studio and try again.";
    return `<!doctype html><meta charset="utf-8"><title>NarraLeaf Studio</title>`
        + `<body style="font:15px system-ui;background:#0f1115;color:#eef1f5;display:grid;place-items:center;height:100vh;margin:0">`
        + `<div style="text-align:center"><p>${zh}</p><p style="color:#9aa3ae">${en}</p></div>`;
}

/** Wait for one redirect to the loopback listener, then stop listening. */
function awaitRedirect(
    server: http.Server,
    state: string,
    signal: AbortSignal | undefined,
): Promise<{ code: string } | { error: "denied" | "timeout" | "unknown" }> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (value: { code: string } | { error: "denied" | "timeout" | "unknown" }): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            // Let the landing page reach the browser before the socket goes.
            setTimeout(() => server.close(), 200);
            resolve(value);
        };
        const timer = setTimeout(() => finish({ error: "timeout" }), BROWSER_TIMEOUT_MS);
        signal?.addEventListener("abort", () => finish({ error: "timeout" }), { once: true });
        server.on("request", (incoming, response) => {
            const url = new URL(incoming.url ?? "/", "http://127.0.0.1");
            if (url.pathname !== "/callback") {
                response.writeHead(404).end();
                return;
            }
            // A redirect that does not carry the state this sign-in made is not this
            // sign-in's answer — another page on this machine guessing the port.
            if (url.searchParams.get("state") !== state) {
                response.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(landingPage(false));
                return;
            }
            const code = url.searchParams.get("code");
            const ok = code !== null && code !== "";
            response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(landingPage(ok));
            if (ok) finish({ code });
            else finish({ error: url.searchParams.get("error") === "access_denied" ? "denied" : "unknown" });
        });
    });
}

/** Read a token response, or null when it is not one. */
function readTokens(body: string): { token: string; refreshToken: string } | null {
    try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed !== "object" || parsed === null) return null;
        const { access_token: token, refresh_token: refreshToken } = parsed as Record<string, unknown>;
        return typeof token === "string" && token !== "" && typeof refreshToken === "string" && refreshToken !== ""
            ? { token, refreshToken }
            : null;
    } catch {
        return null;
    }
}

/** POST to the token endpoint, as JSON (Team reads either JSON or a form). */
async function askTokenEndpoint(
    authUrl: string,
    userDataDir: string,
    fields: Record<string, string>,
): Promise<{ status: number; body: string } | "unreachable" | "unknown"> {
    const endpoint = endpointOf(authUrl);
    if (endpoint === null) return "unknown";
    try {
        return await request(endpoint, {
            method: "POST",
            path: "/oauth/token",
            userDataDir,
            body: JSON.stringify({ client_id: STUDIO_OAUTH_CLIENT_ID, ...fields }),
        });
    } catch {
        return "unreachable";
    }
}

/**
 * Sign in through the browser: listen, open, wait, redeem.
 *
 * The listener is on 127.0.0.1 by IP and on a port the OS chose, and it is closed as soon
 * as one redirect has arrived or the wait is over — it answers nothing else meanwhile.
 */
export async function signInWithBrowser(input: ServerOAuthRequest): Promise<ServerOAuthResult> {
    if (endpointOf(input.authUrl) === null) return { ok: false, reason: "unknown" };

    const verifier = base64url(randomBytes(32));
    const challenge = base64url(createHash("sha256").update(verifier).digest());
    const state = base64url(randomBytes(16));

    const server = http.createServer();
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", () => resolve());
        });
    } catch {
        return { ok: false, reason: "unknown" };
    }
    const port = (server.address() as AddressInfo).port;
    const redirectUri = `http://127.0.0.1:${port}/callback`;

    const authorize = new URL("/oauth/authorize", input.authUrl);
    authorize.search = new URLSearchParams({
        client_id: STUDIO_OAUTH_CLIENT_ID,
        redirect_uri: redirectUri,
        response_type: "code",
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        device_name: input.deviceName,
    }).toString();

    const waiting = awaitRedirect(server, state, input.signal);
    try {
        await input.openExternal(authorize.toString());
    } catch {
        server.close();
        return { ok: false, reason: "unknown" };
    }
    const redirect = await waiting;
    if ("error" in redirect) return { ok: false, reason: redirect.error };

    const answer = await askTokenEndpoint(input.authUrl, input.userDataDir, {
        grant_type: "authorization_code",
        code: redirect.code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
    });
    if (answer === "unreachable" || answer === "unknown") return { ok: false, reason: answer };
    if (answer.status === 400 || answer.status === 401) return { ok: false, reason: "refused" };
    if (answer.status !== 200) return { ok: false, reason: "unknown" };
    const tokens = readTokens(answer.body);
    return tokens === null ? { ok: false, reason: "unknown" } : { ok: true, ...tokens };
}

/**
 * Trade a refresh token for a fresh token and the next refresh token.
 *
 * The refresh token is single-use: the one passed in is spent whether or not the answer
 * is read, so the caller stores what comes back before anything else.
 */
export async function refreshWithServer(input: {
    authUrl: string;
    refreshToken: string;
    userDataDir: string;
}): Promise<ServerRefreshResult> {
    const answer = await askTokenEndpoint(input.authUrl, input.userDataDir, {
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
    });
    if (answer === "unreachable" || answer === "unknown") return { ok: false, reason: answer };
    if (answer.status === 400 || answer.status === 401) return { ok: false, reason: "refused" };
    if (answer.status !== 200) return { ok: false, reason: "unknown" };
    const tokens = readTokens(answer.body);
    return tokens === null ? { ok: false, reason: "unknown" } : { ok: true, ...tokens };
}

/** When a token expires, in milliseconds, read from its `exp` without verifying it. */
export function tokenExpiry(token: string): number | null {
    const payload = token.split(".")[1];
    if (payload === undefined) return null;
    try {
        const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
        const exp = typeof claims === "object" && claims !== null ? (claims as { exp?: unknown }).exp : undefined;
        return typeof exp === "number" ? exp * 1000 : null;
    } catch {
        return null;
    }
}
