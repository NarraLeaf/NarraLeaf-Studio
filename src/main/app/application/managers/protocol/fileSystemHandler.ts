import { Logger } from "@shared/utils/logger";
import path from "path";
import { fileURLToPath } from "url";
import { AssetResolved, AssetResolver, ProtocolHandler, ProtocolResponse, ProtocolRule, ProtocolScheme } from "./types";
import { Fs, getMimeType } from "@shared/utils/fs";
import { normalizePath } from "@shared/utils/string";
import { FsRejectErrorCode, FsRequestResult } from "@shared/types/os";
import { decodeTextBytes, encodeTextBytes, resolveTextEncodingId } from "../../../../utils/textCodec";
import { FileStorageInfo, StorageManager } from "../storageManager";

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