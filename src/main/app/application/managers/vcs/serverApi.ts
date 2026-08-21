/**
 * One connection to a server's Studio API, shared by everything that asks it something.
 *
 * The projects list came first and carried the whole transport inside it: the trust
 * material, the request, the timeout, the reading of a refusal. Members, one project's
 * detail and its history all ask the same host over the same certificate with the same
 * token, so a second copy of that would be a second place for the certificate handling to
 * drift - and the certificate handling is the part that is not obvious.
 *
 * **The authority the author accepted is passed in explicitly.** Node reads the system
 * certificate store once per process and memoises it, so a certificate installed after
 * this process started is invisible to it until Studio is restarted. Handing the PEM over
 * is what makes trusting a server take effect at the moment it is trusted.
 */
import https from "https";
import tls from "tls";

import type { VcsServerProjectsProblem } from "@shared/types/vcs";

import { trustedCertificates } from "./authorityTrust";
import { parseServerAddress, type ServerEndpoint } from "./serverDiscovery";

/** Where the Studio API lives, versioned as the server versions it. */
export const STUDIO_API_ROOT = "/api/studio/v1";

/** A bound on the whole exchange, for the reason `serverDiscovery` sets one. */
const TIMEOUT_MS = 15_000;

/** More than any list this asks for, and small enough that a page cannot be mistaken for one. */
const MAX_BODY_LENGTH = 2 * 1024 * 1024;

/** What an attempt came back with, before it is read as anything. */
export interface Answer {
    status: number;
    body: string;
}

/**
 * Why an ask did not produce what was asked for.
 *
 * The same set for every collection the server serves, and the same set the renderer
 * already has a sentence for: what fails is reaching the server or being accepted by it,
 * and neither of those is different for members than it is for projects.
 */
export type ServerApiProblem = VcsServerProjectsProblem;

/** Ask once, and let the failure through as it is. */
export function request(
    endpoint: ServerEndpoint,
    options: {
        method: "GET" | "POST" | "DELETE";
        path: string;
        /**
         * Absent for the one route that is asked before there is anything to present:
         * signing in with a password is how a token is obtained, so it cannot carry one.
         * An empty header is not the same thing as no header, and this must not send one.
         */
        token?: string;
        userDataDir: string;
        body?: string;
    },
): Promise<Answer> {
    const payload = options.body === undefined ? undefined : Buffer.from(options.body, "utf-8");
    const settings: https.RequestOptions & tls.ConnectionOptions = {
        host: endpoint.host,
        port: endpoint.port,
        path: options.path,
        method: options.method,
        headers: {
            accept: "application/json",
            ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }),
            ...(payload === undefined
                ? {}
                : { "content-type": "application/json", "content-length": payload.length }),
        },
        rejectUnauthorized: true,
        ca: trustedCertificates(options.userDataDir),
        ALPNProtocols: ["http/1.1"],
        // An IP address is not a valid SNI name; the same reasoning as the probe.
        servername: /^[\d.]+$/.test(endpoint.host) || endpoint.host.includes(":")
            ? undefined
            : endpoint.host,
        agent: false,
    };

    return new Promise<Answer>((resolve, reject) => {
        let deadline: NodeJS.Timeout | undefined;
        const answer = (value: Answer): void => { clearTimeout(deadline); resolve(value); };
        const failed = (error: Error): void => { clearTimeout(deadline); reject(error); };

        const call = https.request(settings, (response) => {
            const status = response.statusCode ?? 0;
            let body = "";
            response.setEncoding("utf-8");
            response.on("data", (chunk: string) => {
                body += chunk;
                if (body.length < MAX_BODY_LENGTH) return;
                response.destroy();
                answer({ status, body });
            });
            response.on("end", () => answer({ status, body }));
            response.on("error", failed);
        });
        deadline = setTimeout(() => {
            call.destroy(Object.assign(new Error(`${endpoint.host}:${endpoint.port} did not answer`), {
                code: "ETIMEDOUT",
            }));
        }, TIMEOUT_MS);
        call.on("error", failed);
        if (payload !== undefined) call.write(payload);
        call.end();
    });
}

/** The sentence a server put in its refusal, if it put one there. */
function detailOf(body: string): string {
    try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
            const message = (parsed as { error: unknown }).error;
            if (typeof message === "string" && message.trim() !== "") return message.trim();
        }
    } catch {
        // Not JSON, so there is nothing in it to quote.
    }
    return "";
}

/** Turn a status that is not a success into the problem it stands for. */
export function problemFor(answer: Answer): ServerApiProblem {
    if (answer.status === 401 || answer.status === 403) return { kind: "refused" };
    const detail = detailOf(answer.body);
    return detail === "" ? { kind: "unknown" } : { kind: "rejected", detail };
}

/**
 * The endpoint behind a stored `authUrl`.
 *
 * Sessions keep `https://host:port`, and `parseServerAddress` takes the `nlteam://` form
 * an author was given; the two describe one machine, so the scheme is swapped rather than
 * a second parser written.
 */
export function endpointOf(authUrl: string): ServerEndpoint | null {
    return parseServerAddress(authUrl.replace(/^https:/, "nlteam:"));
}

/** An answer's object, or null because it was not one. */
export function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
}

/**
 * One field, present only when the server actually carried it.
 *
 * **Nothing is filled in**, which is why these hand back a fragment to spread rather than
 * a value to assign: a default here would be a claim - zero revisions, a commit at the
 * epoch, an empty branch name - about work somebody else did. A field the answer does not
 * carry has to survive the trip as nothing.
 */
export function numberField(record: Record<string, unknown>, key: string): Record<string, number> {
    const value = record[key];
    return typeof value === "number" && Number.isFinite(value) ? { [key]: value } : {};
}

/** The same bargain as {@link numberField}, and an empty string counts as nothing said. */
export function textField(record: Record<string, unknown>, key: string): Record<string, string> {
    const value = record[key];
    return typeof value === "string" && value.trim() !== "" ? { [key]: value } : {};
}

/**
 * Ask for one JSON document and hand back what it parsed to, or why it did not.
 *
 * The four failures every caller has are handled once here - no endpoint, nothing
 * answered, a status that is not the expected one, a body that is not JSON - so what a
 * caller writes is the reading of a shape it understands.
 *
 * A route whose whole answer is its status answers with no document at all, and gets
 * `value: undefined` rather than a complaint about a body that was never promised. A
 * caller reading a field off that value still refuses, because there is no field there.
 */
export async function askServer(options: {
    authUrl: string;
    token: string;
    userDataDir: string;
    path: string;
    method?: "GET" | "POST" | "DELETE";
    body?: string;
    /** The one status that counts as an answer. Anything else is read as a refusal. */
    expect?: number;
}): Promise<{ ok: true; value: unknown } | { ok: false; problem: ServerApiProblem }> {
    const endpoint = endpointOf(options.authUrl);
    if (endpoint === null) return { ok: false, problem: { kind: "unknown" } };

    let answer: Answer;
    try {
        answer = await request(endpoint, {
            method: options.method ?? "GET",
            path: options.path,
            token: options.token,
            userDataDir: options.userDataDir,
            ...(options.body === undefined ? {} : { body: options.body }),
        });
    } catch {
        return { ok: false, problem: { kind: "unreachable" } };
    }
    if (answer.status !== (options.expect ?? 200)) {
        return { ok: false, problem: problemFor(answer) };
    }
    // 204 is the whole answer to a request whose result is that it worked, and there is
    // nothing in it to parse - `JSON.parse("")` throws, which would report a success as
    // a failure nobody could act on.
    if (answer.body.trim() === "") return { ok: true, value: undefined };

    try {
        return { ok: true, value: JSON.parse(answer.body) as unknown };
    } catch {
        return { ok: false, problem: { kind: "unknown" } };
    }
}
