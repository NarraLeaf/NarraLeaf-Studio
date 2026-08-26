/**
 * The five requests a file makes on its way through a NarraLeaf Team server.
 *
 * **Separate from `vcs/serverApi.ts`, and every difference is the point.** That one answers a
 * question: it writes a short JSON body, reads a whole answer into a string, refuses past two
 * megabytes and gives the entire exchange fifteen seconds. All three are right for a list of
 * projects and fatal for a file - a two-hundred-megabyte upload is neither short nor quick, and
 * reading one into a string is the memory cost this whole change exists to remove.
 *
 * So this streams in both directions and is bounded by **silence rather than by duration**: a
 * transfer may take an hour as long as it is moving, and is given up on when nothing has moved for
 * {@link IDLE_MS}. What it shares with its neighbour is the part that matters - the same
 * certificate authorities the author accepted, the same refusal to fall back to the system's, and
 * the same ALPN, so a file goes over exactly the connection the fingerprint was compared on.
 */
import https from "node:https";
import type { IncomingHttpHeaders, IncomingMessage } from "node:http";
import { Transform, type Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type tls from "node:tls";

import { trustedCertificates } from "../vcs/authorityTrust";
import { endpointOf } from "./TeamClient";

/**
 * How long a transfer may make no progress before it is given up on.
 *
 * ⚠ **Idle rather than total.** A deadline on the whole exchange - which is what the JSON client
 * next door has - would fail every large file on a slow link and would fail it later the bigger it
 * was, which is the worst possible shape for a limit. This one fires when nothing has arrived,
 * which is what a dropped connection actually looks like, and the transfer is then picked up again
 * from the byte it reached rather than from nothing.
 */
export const IDLE_MS = 60_000;

/** Where one object lives: the server, and the name it is under. */
export interface BlobTarget {
    /** The server's `https://host:port`, as the session list records it. */
    readonly authUrl: string;
    readonly token: string;
    /** Where the certificate authorities the author accepted are kept. */
    readonly userDataDir: string;
    /** Which window is asking, so the server can check it has this project open. */
    readonly instance: string;
    readonly project: string;
    readonly transferId: string;
}

/** What the server says about an object. */
export interface BlobDescription {
    readonly length: number;
    readonly received: number;
    readonly complete: boolean;
    readonly digest: string;
}

/** What came back, for the requests whose answer is a status rather than bytes. */
export interface BlobAnswer {
    readonly status: number;
    readonly headers: IncomingHttpHeaders;
    /** The body, for the statuses that carry a sentence. Bounded; these are never large. */
    readonly body: string;
}

/** How far a transfer has got, reported as it goes. */
export type BlobProgress = (bytes: number) => void;

class BlobRequestFailed extends Error {}

/** Reserve an object, saying how long it is and what it will hash to. */
export async function reserveBlob(
    target: BlobTarget,
    said: { length: number; digest: string },
): Promise<BlobAnswer> {
    return exchange(target, {
        method: "POST",
        query: `?length=${said.length}&digest=${encodeURIComponent(said.digest)}`,
    });
}

/** Ask how much of an object the server holds. Undefined for one it has never heard of. */
export async function describeBlob(target: BlobTarget): Promise<BlobDescription | undefined> {
    const answer = await exchange(target, { method: "HEAD" });
    if (answer.status === 404) {
        return undefined;
    }
    if (answer.status !== 200) {
        throw new BlobRequestFailed(sentenceIn(answer));
    }
    return {
        length: count(answer.headers["nl-blob-length"]) ?? 0,
        received: count(answer.headers["nl-blob-received"]) ?? 0,
        complete: single(answer.headers["nl-blob-complete"]) === "true",
        digest: single(answer.headers["nl-blob-digest"]) ?? "",
    };
}

/** Take an object off the server. */
export async function dropBlob(target: BlobTarget): Promise<void> {
    await exchange(target, { method: "DELETE" });
}

/**
 * Write a file into an object, from the byte the server says it ends at.
 *
 * The source is a stream and is never read ahead of the socket: what paces this is the socket's
 * own back pressure, which is why there is no chunk size and nothing to tune.
 */
export async function sendBlob(
    target: BlobTarget,
    input: {
        source: Readable;
        offset: number;
        onProgress: BlobProgress;
        signal: AbortSignal;
    },
): Promise<BlobAnswer> {
    return exchange(target, {
        method: "PATCH",
        headers: { "nl-blob-offset": String(input.offset), "content-type": "application/octet-stream" },
        // ⚠ Counted with a stream in the middle rather than by listening for `data` on the source.
        // A `data` listener puts a stream into flowing mode the moment it is added, which is before
        // whatever is going to read it has been connected - so the first pieces of a file can be
        // read and dropped, and the file that arrives is short by however much got away.
        body: input.source.pipe(counting(input.offset, input.onProgress)),
        signal: input.signal,
    });
}

/** A stream that passes everything through and says how much has gone. */
export function counting(from: number, onProgress: BlobProgress): Transform {
    let moved = from;
    return new Transform({
        transform(chunk: Buffer, _encoding, done): void {
            moved += chunk.length;
            onProgress(moved);
            done(null, chunk);
        },
    });
}

/**
 * Read an object into a file, from the byte this machine has already written.
 *
 * The response does not end when the server has run out of bytes: it is held while the sender is
 * still writing, so what arrives here arrives as it is sent. What ends it is the object being
 * whole, being dropped, or nothing having been written to it for a while - and the caller tells
 * those apart by asking again, which is the same thing it does after a lost connection.
 */
export async function receiveBlob(
    target: BlobTarget,
    input: {
        sink: Writable;
        from: number;
        onProgress: BlobProgress;
        signal: AbortSignal;
    },
): Promise<{ status: number; wrote: number }> {
    const request = open(target, {
        method: "GET",
        headers: input.from > 0 ? { range: `bytes=${input.from}-` } : {},
    });

    return new Promise<{ status: number; wrote: number }>((settle, fail) => {
        let wrote = input.from;
        const stop = (): void => {
            request.destroy(new BlobRequestFailed("this transfer was stopped"));
        };
        input.signal.addEventListener("abort", stop, { once: true });

        request.on("error", (cause: Error) => {
            input.signal.removeEventListener("abort", stop);
            fail(cause);
        });
        request.setTimeout(IDLE_MS, () => {
            request.destroy(new BlobRequestFailed("that server stopped answering"));
        });
        request.on("response", (response: IncomingMessage) => {
            if (response.statusCode !== 200 && response.statusCode !== 206) {
                response.resume();
                input.signal.removeEventListener("abort", stop);
                settle({ status: response.statusCode ?? 0, wrote });
                return;
            }
            response.on("data", (chunk: Buffer) => {
                wrote += chunk.length;
                input.onProgress(wrote);
            });
            // ⚠ The sink is deliberately left open. This ends whenever the server runs out of
            // patience with a file that is still being written, and the next attempt appends to
            // the same handle rather than truncating what is already there.
            pipeline(response, input.sink, { end: false })
                .then(() => {
                    input.signal.removeEventListener("abort", stop);
                    settle({ status: response.statusCode ?? 0, wrote });
                })
                .catch((cause: unknown) => {
                    input.signal.removeEventListener("abort", stop);
                    fail(cause instanceof Error ? cause : new BlobRequestFailed(String(cause)));
                });
        });
        request.end();
    });
}

/* ------------------------------------------------------------------------------ the request */

function open(
    target: BlobTarget,
    input: { method: string; query?: string; headers?: Record<string, string> },
): ReturnType<typeof https.request> {
    const endpoint = endpointOf(target.authUrl);
    if (endpoint === null) {
        throw new BlobRequestFailed(`${target.authUrl} is not an address this build understands`);
    }
    const path =
        `/api/team/v1/blobs/${encodeURIComponent(target.project)}/${encodeURIComponent(target.transferId)}`
        + (input.query ?? "");

    const settings: https.RequestOptions & tls.ConnectionOptions = {
        host: endpoint.host,
        port: endpoint.port,
        path,
        method: input.method,
        headers: {
            authorization: `Bearer ${target.token}`,
            "nl-instance": target.instance,
            ...(input.headers ?? {}),
        },
        // The same three lines as every other request Studio makes to a Team server, and for the
        // same reason: this is the connection whose certificate an author compared once.
        rejectUnauthorized: true,
        ca: trustedCertificates(target.userDataDir),
        ALPNProtocols: ["http/1.1"],
        servername:
            /^[\d.]+$/.test(endpoint.host) || endpoint.host.includes(":") ? undefined : endpoint.host,
        agent: false,
    };
    return https.request(settings);
}

/** One request whose answer is short. Used for reserve, describe, drop and the end of an append. */
async function exchange(
    target: BlobTarget,
    input: {
        method: string;
        query?: string;
        headers?: Record<string, string>;
        body?: Readable;
        signal?: AbortSignal;
    },
): Promise<BlobAnswer> {
    const request = open(target, input);

    return new Promise<BlobAnswer>((settle, fail) => {
        const stop = (): void => {
            request.destroy(new BlobRequestFailed("this transfer was stopped"));
        };
        input.signal?.addEventListener("abort", stop, { once: true });
        const finish = (): void => {
            input.signal?.removeEventListener("abort", stop);
        };

        request.on("error", (cause: Error) => {
            finish();
            fail(cause);
        });
        request.setTimeout(IDLE_MS, () => {
            request.destroy(new BlobRequestFailed("that server stopped answering"));
        });
        request.on("response", (response: IncomingMessage) => {
            let body = "";
            response.setEncoding("utf-8");
            response.on("data", (piece: string) => {
                // Bounded because these answers are a sentence and a couple of numbers. A server
                // answering something enormous here is one this build has no business reading.
                if (body.length < 8192) {
                    body += piece;
                }
            });
            response.on("end", () => {
                finish();
                settle({ status: response.statusCode ?? 0, headers: response.headers, body });
            });
        });

        if (input.body === undefined) {
            request.end();
            return;
        }
        pipeline(input.body, request).catch((cause: unknown) => {
            // A pipeline that fails after the response arrived has already settled this promise,
            // and a rejection here would be unhandled. Rejecting twice is harmless.
            finish();
            fail(cause instanceof Error ? cause : new BlobRequestFailed(String(cause)));
        });
    });
}

/** The sentence a server put in a refusal, or the status if it did not put one. */
export function sentenceIn(answer: BlobAnswer): string {
    try {
        const read = JSON.parse(answer.body) as { error?: unknown };
        if (typeof read.error === "string" && read.error !== "") {
            return read.error;
        }
    } catch {
        // Not JSON. The status is the whole of what is known.
    }
    return `that server answered ${answer.status}`;
}

/** A number a refusal carried, for the one refusal that names a figure. */
export function figureIn(answer: BlobAnswer, name: string): number | undefined {
    try {
        const read = JSON.parse(answer.body) as Record<string, unknown>;
        const value = read[name];
        return typeof value === "number" && Number.isFinite(value) ? value : undefined;
    } catch {
        return undefined;
    }
}

function single(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

function count(value: string | string[] | undefined): number | undefined {
    const text = single(value);
    return text !== undefined && /^\d{1,16}$/.test(text) ? Number(text) : undefined;
}
