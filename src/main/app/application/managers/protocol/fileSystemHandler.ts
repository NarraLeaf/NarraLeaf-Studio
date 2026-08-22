import { Logger } from "@shared/utils/logger";
import path from "path";
import { fileURLToPath } from "url";
import { AssetResolved, AssetResolver, ProtocolHandler, ProtocolResponse, ProtocolRule, ProtocolScheme } from "./types";
import { Fs, getMimeType } from "@shared/utils/fs";
import { normalizePath } from "@shared/utils/string";
import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { decodeTextBytes, encodeTextBytes, resolveTextEncodingId } from "../../../../utils/textCodec";
import { decodeWriteBatchFrame } from "@shared/utils/writeBatchFrame";
import { FileStorageBatchEntry, FileStorageInfo, StorageManager } from "../storageManager";

export class FileSystemHandler implements ProtocolHandler, AssetResolver {
    private rules: ProtocolRule[] = [];
    private logger: Logger;

    constructor(
        public readonly scheme: string,
        public readonly privileges: ProtocolScheme["privileges"],
        private readonly getBaseDir: () => string,
        private readonly hostname: string,
        private readonly noCache: boolean = false
    ) {
        this.logger = new Logger("FileSystemHandler");
    }

    addRule(rule: ProtocolRule): this {
        this.rules.push(rule);
        return this;
    }

    canHandle(url: URL): boolean {
        return url.protocol === this.scheme + ":" && url.hostname === this.hostname;
    }

    resolve(url: string): AssetResolved | null {
        const urlObj = new URL(url);
        if (!this.canHandle(urlObj)) {
            return null;
        }

        for (const rule of this.rules) {
            if (this.matchesPattern(rule.include, url)) {
                // Skip if excluded
                if (rule.exclude && this.matchesPattern(rule.exclude, url)) {
                    continue;
                }
                return rule.handler(url);
            }
        }

        return null;
    }

    async handle(request: Request): Promise<ProtocolResponse> {
        const resolved = this.resolve(request.url);
        if (!resolved) {
            this.logger.error(`File not found: ${request.url}`);

            return {
                statusCode: 404,
                headers: {},
                data: undefined
            } as ProtocolResponse;
        }

        const filePath = fileURLToPath(resolved.path);
        const result = await Fs.readRaw(filePath);

        if (!result.ok) {
            // A file that was never built is a 404, not a 500. `dist` can go missing
            // under a running dev session, and an opaque 500 with an empty body hides
            // which bundle is absent; 500 stays for genuine read failures.
            const missing = result.error.code === FsRejectErrorCode.NOT_FOUND;
            this.logger.error(`Error reading file: ${filePath} - ${result.error.message}`);
            return {
                statusCode: missing ? 404 : 500,
                headers: {},
                data: undefined
            };
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": getMimeType(filePath),
                ...((this.noCache || resolved.noCache) ? {
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                } : {
                    "Cache-Control": "public, max-age=180, immutable"
                })
            },
            data: result.data
        } as ProtocolResponse;
    }

    public formatFileUrl(requested: string): string {
        const url = new URL(requested);
        // Ensure we join with a relative path to avoid discarding base dir on Windows
        const pathname = url.pathname.replace(/^\/+/, "/");
        const relativePath = pathname.replace(/^\//, "");
        const fullPath = path.join(this.getBaseDir(), relativePath);
        return `file://${normalizePath(fullPath)}`;
    }

    private matchesPattern(pattern: string | RegExp | ((requested: string) => boolean), url: string): boolean {
        if (typeof pattern === 'string') {
            return url.includes(pattern);
        }
        if (pattern instanceof RegExp) {
            return pattern.test(url);
        }
        return pattern(url);
    }
}

/**
 * Protocol handler for file system hash-based operations
 * Handles requests to app://fs/{hash} URLs
 */
/**
 * How many of a batch's files are written at once.
 *
 * Sized against libuv's default four-thread pool, which is what the `fsync` at the end of every
 * atomic write actually queues on: enough in flight to keep the pool busy across the gaps, low
 * enough that one batch cannot starve every other filesystem call in the process. Measured rather
 * than guessed - three hundred 2 KB files took 884 ms at 8 and 919 ms at 32, so the ceiling is the
 * pool, not this number, and the smaller one is the politer neighbour.
 */
const BATCH_WRITE_CONCURRENCY = 8;

export class FileSystemHashHandler implements ProtocolHandler {
    private logger: Logger;

    constructor(
        public readonly scheme: string,
        public readonly privileges: ProtocolScheme["privileges"],
        private readonly storageManager: StorageManager,
    ) {
        this.logger = new Logger("FileSystemHashHandler");
    }

    canHandle(url: URL): boolean {
        return url.protocol === this.scheme + ":" && url.hostname === "fs";
    }

    async handle(request: Request): Promise<ProtocolResponse> {
        const url = new URL(request.url);
        // First segment is the grant; anything after it is a path *inside* a directory grant
        // (`app://fs/{hash}/Hiyori.2048/texture_00.png`). Per-file grants have no remainder, and a
        // remainder against one of them simply fails the lookup below - as it should.
        const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        const separator = pathname.indexOf("/");
        const hash = separator === -1 ? pathname : pathname.slice(0, separator);
        const relativePath = separator === -1 ? "" : pathname.slice(separator + 1);

        // Get storage info for this hash
        const storageInfo = this.storageManager.get(hash);
        if (!storageInfo) {
            this.logger.error(`Hash not found: ${hash}`);
            return {
                statusCode: 404,
                headers: { "Content-Type": "text/plain" },
                data: "Hash not found: " + hash
            };
        }

        if (storageInfo.status !== 'ready') {
            this.logger.error(`Hash not ready: ${hash}, status: ${storageInfo.status}`);
            return {
                statusCode: 403,
                headers: { "Content-Type": "text/plain" },
                data: "Hash not ready for operations"
            };
        }

        try {
            if (request.method === 'GET') {
                if (storageInfo.operation !== "read") {
                    return this.methodNotAllowed("Hash is not valid for read operations");
                }
                if (storageInfo.directory) {
                    return await this.handleDirectoryRead(storageInfo, relativePath);
                }
                if (relativePath) {
                    // A per-file grant addressed as if it were a directory. 404 rather than serving
                    // the file: silently ignoring the path would make a broken sibling reference
                    // look like it resolved.
                    this.logger.error(`Hash is not a directory grant: ${hash}/${relativePath}`);
                    return {
                        statusCode: 404,
                        headers: { "Content-Type": "text/plain" },
                        data: "Not a directory grant: " + hash
                    };
                }
                return await this.handleRead(hash, storageInfo);
            } else if (request.method === 'PUT') {
                if (storageInfo.operation !== "write") {
                    return this.methodNotAllowed("Hash is not valid for write operations");
                }
                if (storageInfo.batch) {
                    return await this.handleBatchWrite(hash, request, storageInfo.batch);
                }
                return await this.handleWrite(hash, request, storageInfo);
            } else {
                return {
                    statusCode: 405,
                    headers: { "Content-Type": "text/plain" },
                    data: "Method not allowed"
                };
            }
        } catch (error) {
            this.logger.error(`Error handling hash request ${hash}:`, error);
            return {
                statusCode: 500,
                headers: { "Content-Type": "text/plain" },
                data: "Internal server error: " + (error instanceof Error ? error.message : String(error))
            };
        }
    }

    private methodNotAllowed(message: string): ProtocolResponse {
        return {
            statusCode: 405,
            headers: { "Content-Type": "text/plain" },
            data: message
        };
    }

    /**
     * Serve one file from inside a directory grant.
     *
     * Never consumes the grant: the whole point of a bundle is that many files are read through the
     * same root, and the caller cannot know in advance how many (a Live2D manifest names its motions
     * lazily). The grant is revoked when its owner window closes instead.
     *
     * The Content-Type matters here in a way it does not for per-file grants: these bytes are fetched
     * by the model runtime, which branches on it (JSON manifests vs. binary `.moc3`), so this path
     * reports the real MIME type rather than `application/octet-stream`.
     */
    private async handleDirectoryRead(storageInfo: FileStorageInfo, relativePath: string): Promise<ProtocolResponse> {
        const filePath = this.storageManager.resolveDirectoryGrantPath(storageInfo, relativePath);
        if (!filePath) {
            this.logger.error(`Rejected directory grant path: ${relativePath}`);
            return {
                statusCode: 403,
                headers: { "Content-Type": "text/plain" },
                data: "Path is outside the granted directory"
            };
        }

        const result = await Fs.readRaw(filePath);
        if (!result.ok) {
            const missing = result.error.code === FsRejectErrorCode.NOT_FOUND;
            this.logger.error(`Error reading bundle file: ${filePath} - ${result.error.message}`);
            return {
                statusCode: missing ? 404 : 500,
                headers: { "Content-Type": "text/plain" },
                data: missing ? "Not found" : `Failed to read file: ${result.error.message}`
            };
        }

        return {
            statusCode: 200,
            headers: {
                "Content-Type": getMimeType(filePath),
                // Same reasoning as a session grant: the hash is minted per resolve, so cached bytes
                // cannot outlive the record they belong to.
                "Cache-Control": "private, max-age=3600"
            },
            data: result.data
        };
    }

    private async handleRead(hash: string, storageInfo: FileStorageInfo): Promise<ProtocolResponse> {
        let result;
        if (storageInfo.raw) {
            result = await Fs.readRaw(storageInfo.path);
        } else {
            // The encodings Node cannot name (GBK, Shift_JIS, UTF-16 BE, a UTF-8 that keeps its
            // mark) are decoded here rather than by `Fs`, so iconv-lite stays out of the module the
            // packaged game runtime imports. See `src/main/utils/textCodec.ts`.
            result = await this.readDecodedText(storageInfo);
        }

        if (!result.ok) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "text/plain" },
                data: `Failed to read file: ${result.error.message}`
            };
        }

        const sessionLived = storageInfo.lifetime === "session";
        if (!sessionLived) {
            // One-shot grants are destroyed after the first successful read;
            // session grants stay valid until the owner window revokes them.
            this.storageManager.cleanup(hash);
        }

        const mimeType = getMimeType(storageInfo.path);
        return {
            statusCode: 200,
            headers: {
                "Content-Type": storageInfo.raw ? "application/octet-stream" : mimeType,
                // Session-lived grants back engine assets that get re-fetched on
                // scene changes: let the renderer's HTTP cache absorb repeats.
                // The hash URL is unique per grant (each re-resolve mints a new
                // one), so cached bytes cannot go stale across recompiles.
                ...(sessionLived ? {
                    "Cache-Control": "private, max-age=3600"
                } : {
                    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                })
            },
            data: result.data
        };
    }

    /**
     * Read `storageInfo.path` as text under the grant's encoding.
     *
     * Split out of {@link handleRead} because the two halves answer different questions: Node's own
     * `readFile(path, {encoding})` covers the encodings it names, and {@link decodeTextBytes} covers
     * the rest plus the byte-order-mark handling that neither Node nor the caller should be doing by
     * hand. The string this produces goes on the wire as UTF-8 (`new Response(string)`) and comes
     * back out of `response.text()` as UTF-8, so the grant's encoding describes the *file* only -
     * it never describes the transport.
     */
    private async readDecodedText(storageInfo: FileStorageInfo): Promise<FsRequestResult<string>> {
        const textEncoding = resolveTextEncodingId(storageInfo.encoding);
        if (!textEncoding) {
            return Fs.read(storageInfo.path, storageInfo.encoding as BufferEncoding | undefined);
        }
        const bytes = await Fs.readRaw(storageInfo.path);
        if (!bytes.ok) {
            return bytes;
        }
        return { ok: true, data: decodeTextBytes(bytes.data, textEncoding) };
    }

    /**
     * Write every file a batched grant names, from one framed body, and report each one.
     *
     * Two properties this owes its callers:
     *
     *  - **Nothing here decides where bytes go.** The paths, encodings and raw/text choices come from
     *    the grant, which was authorized path by path before it existed. The body carries only sizes,
     *    so a renderer that frames it wrongly mis-slices its own payloads and cannot address a file
     *    the grant does not already cover. A body whose payload count disagrees with the grant is
     *    rejected outright rather than zipped against what it does carry, because payload `i` landing
     *    in entry `i` is the entire binding.
     *  - **A partial batch is reportable.** Entries are attempted independently and every one gets an
     *    answer, in order, in a 200 response. Stopping at the first failure would leave the caller
     *    unable to say which files landed - and a debt-tracking writer that cannot say that has to
     *    re-owe all of them, which is the multi-file write this was built to make cheap.
     *
     * The grant is consumed once, at the end, however the individual writes went: it named this set
     * of files for this one request, and a partial failure is not a licence to try again unasked.
     *
     * Entries are written {@link BATCH_WRITE_CONCURRENCY} at a time rather than one after another,
     * and that is not a micro-optimisation. Each write is an atomic replace ending in an `fsync`,
     * which is *waiting*, not work: three hundred 2 KB files took ~1.6 s in a plain loop against
     * ~0.7 s for the same files written concurrently through separate grants, so a serial batch was
     * slower than the N-round-trip route it exists to replace. Nothing is shared between entries -
     * the grant refuses duplicate paths - so there is no ordering left to preserve.
     */
    private async handleBatchWrite(
        hash: string,
        request: Request,
        entries: readonly FileStorageBatchEntry[],
    ): Promise<ProtocolResponse> {
        const frame = decodeWriteBatchFrame(new Uint8Array(await request.arrayBuffer()), entries.length);
        if (!("payloads" in frame)) {
            this.logger.error(`Rejected batch write body: ${frame.message}`);
            return {
                statusCode: 400,
                headers: { "Content-Type": "text/plain" },
                data: frame.message,
            };
        }

        const results: FsRequestResult<void>[] = new Array(entries.length);
        let next = 0;
        const worker = async (): Promise<void> => {
            while (next < entries.length) {
                const index = next++;
                results[index] = await this.writeBatchEntry(entries[index], Buffer.from(frame.payloads[index]));
            }
        };
        await Promise.all(
            Array.from({ length: Math.min(BATCH_WRITE_CONCURRENCY, entries.length) }, worker),
        );

        this.storageManager.cleanup(hash);
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json" },
            data: JSON.stringify({ results }),
        };
    }

    /**
     * One file of a batch, with the directory check `allocateWrite` performs up front for a
     * single-path grant. It happens here instead so a missing directory costs its own entry and not
     * the whole batch.
     */
    private async writeBatchEntry(entry: FileStorageBatchEntry, payload: Buffer): Promise<FsRequestResult<void>> {
        const dirExists = await Fs.isDirExists(path.dirname(entry.path));
        if (!dirExists.ok) {
            return dirExists as FsRequestResult<void>;
        }
        if (!dirExists.data) {
            return {
                ok: false,
                error: { code: FsRejectErrorCode.NOT_FOUND, message: `Directory does not exist: ${path.dirname(entry.path)}` },
            };
        }

        if (entry.raw) {
            return Fs.writeRaw(entry.path, payload);
        }
        // Identical to the single-path branch below, and for the same reason: the wire is UTF-8
        // whatever the file's encoding is, and `entry.encoding` describes the file alone.
        const textContent = payload.toString("utf-8");
        const textEncoding = resolveTextEncodingId(entry.encoding);
        return textEncoding
            ? Fs.writeRaw(entry.path, encodeTextBytes(textContent, textEncoding))
            : Fs.write(entry.path, textContent, entry.encoding as BufferEncoding | undefined);
    }

    private async handleWrite(hash: string, request: Request, storageInfo: FileStorageInfo): Promise<ProtocolResponse> {
        try {
            const content = await request.arrayBuffer();
            const buffer = Buffer.from(content);

            let result;
            if (storageInfo.raw) {
                result = await Fs.writeRaw(storageInfo.path, buffer);
            } else {
                // The wire is always UTF-8 and has nothing to do with `storageInfo.encoding`: the
                // renderer PUTs a JS string as the fetch body, and a USVString body is UTF-8-encoded
                // by definition. `storageInfo.encoding` describes the *file*. Decoding the wire with
                // it - which this did - was a no-op for UTF-8 and would have silently mangled every
                // other encoding the moment one existed.
                const textContent = buffer.toString("utf-8");
                const textEncoding = resolveTextEncodingId(storageInfo.encoding);
                result = textEncoding
                    // `writeRaw`, not `write`: same atomic temp-file-and-rename core, but the bytes
                    // are ours rather than `Buffer.from(text, encoding)`'s.
                    ? await Fs.writeRaw(storageInfo.path, encodeTextBytes(textContent, textEncoding))
                    : await Fs.write(storageInfo.path, textContent, storageInfo.encoding as BufferEncoding | undefined);
            }

            if (!result.ok) {
                return {
                    statusCode: 500,
                    headers: { "Content-Type": "text/plain" },
                    data: `Failed to write file: ${result.error.message}`
                };
            }

            // Cleanup hash after successful write
            this.storageManager.cleanup(hash);

            return {
                statusCode: 200,
                headers: { "Content-Type": "text/plain" },
                data: "File written successfully"
            };
        } catch (error) {
            this.logger.error("Error writing file:", error);
            return {
                statusCode: 500,
                headers: { "Content-Type": "text/plain" },
                data: "Internal server error: " + (error instanceof Error ? error.message : String(error))
            };
        }
    }
} 