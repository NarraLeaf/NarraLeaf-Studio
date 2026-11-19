/**
 * The author's Studio settings, kept on a NarraLeaf Team server for the next computer.
 *
 *     GET /api/team/v1/studio-config     the document kept for the signed-in account
 *     PUT /api/team/v1/studio-config     keep this one in its place
 *
 * A renderer holds neither the token nor a way onto the network, so the main process carries the
 * document both ways with the session's token. It never reads it: the renderer composes it on the
 * way up and checks it on the way down (`settingsDocument.ts`), exactly as for a file the author
 * picks. Only the two methods and the one path are ever sent, so this is not a way to make an
 * authenticated request anywhere else on the server.
 */
import https from "node:https";
import type { IncomingMessage } from "node:http";
import type tls from "node:tls";

import {
    TEAM_STUDIO_CONFIG_MAX_BYTES,
    TEAM_STUDIO_CONFIG_PATH,
    type TeamStudioConfigOutcome,
} from "@shared/types/team";

import { trustedCertificates } from "../vcs/authorityTrust";
import { endpointOf } from "./TeamClient";

const TIMEOUT_MS = 20_000;
/** A refusal's sentence is short; nothing past this is read. */
const SENTENCE_BYTES = 4096;
/** Set by the server on the 404 that means "nothing kept yet", which an older server's 404 lacks. */
const STORED_HEADER = "x-narraleaf-studio-config";

export interface StudioConfigTarget {
    /** The server's `https://host:port`, as the session list records it. */
    readonly authUrl: string;
    readonly token: string;
    /** Where the certificate authorities the author accepted are kept. */
    readonly userDataDir: string;
    /** This Studio's version, kept beside the document so the console can show it. */
    readonly studioVersion: string;
}

interface Answer {
    readonly status: number;
    readonly headers: IncomingMessage["headers"];
    readonly body: Buffer;
}

/** Read the document the server keeps for this account. */
export async function downloadStudioConfig(target: StudioConfigTarget): Promise<TeamStudioConfigOutcome> {
    const answer = await exchange(target, "GET");
    if (answer === null) return { ok: false, reason: "unreachable" };
    if (answer.status === 200) return { ok: true, content: answer.body.toString("utf8") };
    return studioConfigRefusal(answer.status, answer.headers[STORED_HEADER], answer.body);
}

/** Keep this document on the server in place of whatever was there. */
export async function uploadStudioConfig(target: StudioConfigTarget, content: string): Promise<TeamStudioConfigOutcome> {
    const body = Buffer.from(content, "utf8");
    if (body.length > TEAM_STUDIO_CONFIG_MAX_BYTES) return { ok: false, reason: "too-large" };
    const answer = await exchange(target, "PUT", body);
    if (answer === null) return { ok: false, reason: "unreachable" };
    if (answer.status === 200) return { ok: true };
    return studioConfigRefusal(answer.status, answer.headers[STORED_HEADER], answer.body);
}

/**
 * What a status other than 200 means.
 *
 * A 404 is "nothing kept yet" only when the server says so in its header; without it the server
 * does not know the path at all, which is a server older than `studio-config`.
 */
export function studioConfigRefusal(
    status: number,
    storedHeader: string | string[] | undefined,
    body: Buffer,
): TeamStudioConfigOutcome {
    if (status === 404) {
        return storedHeader === "none" ? { ok: true } : { ok: false, reason: "unsupported" };
    }
    if (status === 405) return { ok: false, reason: "unsupported" };
    if (status === 401) return { ok: false, reason: "signed-out" };
    if (status === 403) return { ok: false, reason: "forbidden", ...sentence(body) };
    if (status === 413) return { ok: false, reason: "too-large" };
    return { ok: false, reason: "failed", ...sentence(body) };
}

function sentence(body: Buffer): { message?: string } {
    try {
        const parsed: unknown = JSON.parse(body.toString("utf8"));
        if (typeof parsed === "object" && parsed !== null && typeof (parsed as { error?: unknown }).error === "string") {
            return { message: (parsed as { error: string }).error.slice(0, 300) };
        }
    } catch {
        // Not the server's JSON refusal; nothing to pass on.
    }
    return {};
}

async function exchange(target: StudioConfigTarget, method: "GET" | "PUT", body?: Buffer): Promise<Answer | null> {
    const endpoint = endpointOf(target.authUrl);
    if (endpoint === null) return null;
    const headers: Record<string, string> = { authorization: `Bearer ${target.token}` };
    if (body !== undefined) {
        headers["content-type"] = "application/json";
        headers["content-length"] = String(body.length);
        headers["x-narraleaf-studio-version"] = target.studioVersion.slice(0, 64);
    }
    const settings: https.RequestOptions & tls.ConnectionOptions = {
        host: endpoint.host,
        port: endpoint.port,
        path: TEAM_STUDIO_CONFIG_PATH,
        method,
        headers,
        // The same connection settings as every other request Studio makes to a Team server: the
        // certificate authorities the author accepted, and nothing from the system's store.
        rejectUnauthorized: true,
        ca: trustedCertificates(target.userDataDir),
        ALPNProtocols: ["http/1.1"],
        servername:
            /^[\d.]+$/.test(endpoint.host) || endpoint.host.includes(":") ? undefined : endpoint.host,
        agent: false,
    };

    return await new Promise<Answer | null>((settle) => {
        const request = https.request(settings);
        request.on("error", () => settle(null));
        request.setTimeout(TIMEOUT_MS, () => {
            request.destroy();
            settle(null);
        });
        request.on("response", (response: IncomingMessage) => {
            const status = response.statusCode ?? 0;
            // The document itself is bounded by what the server keeps; a refusal by a sentence.
            const limit = status === 200 ? TEAM_STUDIO_CONFIG_MAX_BYTES : SENTENCE_BYTES;
            const pieces: Buffer[] = [];
            let length = 0;
            response.on("data", (piece: Buffer) => {
                length += piece.length;
                if (length > limit) {
                    request.destroy();
                    settle(status === 200 ? null : { status, headers: response.headers, body: Buffer.alloc(0) });
                    return;
                }
                pieces.push(piece);
            });
            response.on("end", () => settle({ status, headers: response.headers, body: Buffer.concat(pieces) }));
            response.on("error", () => settle(null));
        });
        request.end(body);
    });
}
