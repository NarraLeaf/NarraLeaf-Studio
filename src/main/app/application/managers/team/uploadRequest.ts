/**
 * Putting a build or a picture on a NarraLeaf Team server.
 *
 * Both are an HTTP `PUT` beside the socket - a build is up to a gigabyte, and a frame over the
 * socket is a few megabytes at most - to the same TLS listener the session is on, with the session's
 * bearer token:
 *
 *   - `PUT /api/team/v1/projects/{project}/builds?name=&file=&platform=&revision=&note=&latest=`
 *     streams one file and answers `{ build }`;
 *   - `PUT /api/team/v1/projects/{project}/attachments` takes one PNG, JPEG or WebP picture and
 *     answers `{ attachment, url }`.
 *
 * Nothing here decides *which* file is sent: the handler that calls this has already held the path
 * to the artifacts the project's own last build recorded. This module reads it, counts it out and
 * reports how far it has got.
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import https from "node:https";
import path from "node:path";
import type tls from "node:tls";

import type { TeamAttachment, TeamBuild } from "@shared/types/team";
import { TEAM_ATTACHMENT_MAX_BYTES, TEAM_BUILD_MAX_BYTES } from "@shared/types/team";

import { trustedCertificates } from "../vcs/authorityTrust";
import { endpointOf } from "./TeamClient";

/** A whole build is allowed this long without a byte moving before it is given up on. */
const IDLE_TIMEOUT_MS = 60_000;

export interface UploadTarget {
    /** The server's `https://host:port`, as the session list records it. */
    readonly authUrl: string;
    readonly token: string;
    /** Where the certificate authorities the author accepted are kept. */
    readonly userDataDir: string;
}

export interface BuildUploadMeta {
    readonly name: string;
    readonly note?: string;
    /** Studio's platform name; see {@link teamPlatformOf}. */
    readonly platform?: string;
    readonly revision?: string;
    readonly latest?: boolean;
}

export type UploadOutcome<T> =
    | { ok: true; value: T }
    | { ok: false; status: number; message: string };

/**
 * The platform as a Team server's pages name it.
 *
 * Studio says `macos` where the console says `mac`; everything else Studio builds for is spelled the
 * same on both sides. A platform neither knows is `other` rather than whatever string came in.
 */
export function teamPlatformOf(platform: string | undefined): string | undefined {
    if (platform === undefined || platform === "") return undefined;
    if (platform === "macos") return "mac";
    return ["windows", "mac", "linux", "web", "android", "ios"].includes(platform) ? platform : "other";
}

/** The query string a build upload carries. Empty values are left out rather than sent blank. */
export function buildUploadQuery(file: string, meta: BuildUploadMeta): string {
    const query = new URLSearchParams();
    query.set("file", file);
    query.set("name", meta.name.trim() || file);
    if (meta.note !== undefined && meta.note.trim() !== "") query.set("note", meta.note.trim());
    const platform = teamPlatformOf(meta.platform);
    if (platform !== undefined) query.set("platform", platform);
    if (meta.revision !== undefined && meta.revision !== "") query.set("revision", meta.revision);
    if (meta.latest === true) query.set("latest", "1");
    return query.toString();
}

/** The sentence a server put in a refusal, or one made from the status. */
function refusalMessage(status: number, body: string): string {
    try {
        const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
        if (typeof parsed.error === "string" && parsed.error !== "") return parsed.error;
        if (typeof parsed.message === "string" && parsed.message !== "") return parsed.message;
    } catch {
        // not JSON: fall through to the status
    }
    if (status === 401) return "sign in again to upload";
    if (status === 403) return "this account may not upload here";
    if (status === 404) return "the server has no such project";
    if (status === 413) return "that is larger than the server keeps";
    return `the server answered ${status}`;
}

function settingsFor(target: UploadTarget, requestPath: string, length: number, type: string): https.RequestOptions & tls.ConnectionOptions {
    const endpoint = endpointOf(target.authUrl);
    if (endpoint === null) throw new Error("that server's address cannot be read");
    return {
        host: endpoint.host,
        port: endpoint.port,
        path: requestPath,
        method: "PUT",
        headers: {
            authorization: `Bearer ${target.token}`,
            "content-type": type,
            "content-length": String(length),
        },
        // The same connection settings as every other request Studio makes to a Team server.
        rejectUnauthorized: true,
        ca: trustedCertificates(target.userDataDir),
        ALPNProtocols: ["http/1.1"],
        servername: /^[\d.]+$/.test(endpoint.host) || endpoint.host.includes(":") ? undefined : endpoint.host,
        agent: false,
    };
}

/** Send a body and read the JSON answer. */
function put(
    settings: https.RequestOptions & tls.ConnectionOptions,
    write: (request: ReturnType<typeof https.request>, fail: (error: Error) => void) => void,
): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error: Error): void => {
            if (settled) return;
            settled = true;
            request.destroy();
            reject(error);
        };
        const request = https.request(settings);
        request.on("error", fail);
        request.setTimeout(IDLE_TIMEOUT_MS, () => fail(new Error("the server stopped answering")));
        request.on("response", (response: IncomingMessage) => {
            const pieces: Buffer[] = [];
            let length = 0;
            response.on("data", (piece: Buffer) => {
                length += piece.length;
                if (length <= 1024 * 1024) pieces.push(piece);
            });
            response.on("end", () => {
                if (settled) return;
                settled = true;
                resolve({ status: response.statusCode ?? 0, body: Buffer.concat(pieces).toString("utf8") });
            });
            response.on("error", fail);
        });
        write(request, fail);
    });
}

function record(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Stream one file to a project's builds.
 *
 * `onProgress` is called as bytes leave, never more than a few times a second, with what has gone
 * and the whole.
 */
export async function uploadBuildFile(
    target: UploadTarget,
    projectId: string,
    filePath: string,
    meta: BuildUploadMeta,
    onProgress?: (sent: number, total: number) => void,
): Promise<UploadOutcome<TeamBuild>> {
    const info = await stat(filePath);
    if (!info.isFile()) return { ok: false, status: 0, message: "only a file can be uploaded, not a folder" };
    if (info.size === 0) return { ok: false, status: 0, message: "that file is empty" };
    if (info.size > TEAM_BUILD_MAX_BYTES) return { ok: false, status: 413, message: "that build is larger than a server keeps" };

    const requestPath = `/api/team/v1/projects/${encodeURIComponent(projectId)}/builds?${buildUploadQuery(path.basename(filePath), meta)}`;
    const settings = settingsFor(target, requestPath, info.size, "application/octet-stream");
    let sent = 0;
    let lastReport = 0;
    const answer = await put(settings, (request, fail) => {
        const source = createReadStream(filePath);
        source.on("error", fail);
        source.on("data", (chunk) => {
            sent += chunk.length;
            const now = Date.now();
            if (onProgress !== undefined && (now - lastReport > 250 || sent === info.size)) {
                lastReport = now;
                onProgress(sent, info.size);
            }
        });
        source.pipe(request);
    });
    if (answer.status !== 200) return { ok: false, status: answer.status, message: refusalMessage(answer.status, answer.body) };
    const build = record(record(JSON.parse(answer.body))?.["build"]);
    if (build === null || typeof build["id"] !== "string") return { ok: false, status: answer.status, message: "the server's answer could not be read" };
    return { ok: true, value: build as unknown as TeamBuild };
}

/** The picture a `data:` URL carries, or null for anything that is not one of the three types. */
export function pictureOfDataUrl(dataUrl: string): Buffer | null {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (match === null) return null;
    const bytes = Buffer.from(match[2]!, "base64");
    return bytes.length === 0 || bytes.length > TEAM_ATTACHMENT_MAX_BYTES ? null : bytes;
}

/** Put one picture beside a project's comments. */
export async function uploadAttachmentBytes(
    target: UploadTarget,
    projectId: string,
    bytes: Buffer,
): Promise<UploadOutcome<{ attachment: TeamAttachment; url: string }>> {
    if (bytes.length > TEAM_ATTACHMENT_MAX_BYTES) return { ok: false, status: 413, message: "that picture is larger than a server keeps" };
    const requestPath = `/api/team/v1/projects/${encodeURIComponent(projectId)}/attachments`;
    const settings = settingsFor(target, requestPath, bytes.length, "application/octet-stream");
    const answer = await put(settings, (request) => request.end(bytes));
    if (answer.status !== 200) return { ok: false, status: answer.status, message: refusalMessage(answer.status, answer.body) };
    const parsed = record(JSON.parse(answer.body));
    const attachment = record(parsed?.["attachment"]);
    const url = parsed?.["url"];
    if (attachment === null || typeof attachment["id"] !== "string" || typeof url !== "string") {
        return { ok: false, status: answer.status, message: "the server's answer could not be read" };
    }
    return { ok: true, value: { attachment: attachment as unknown as TeamAttachment, url } };
}
