import { Logger } from "@shared/utils/logger";
import path from "path";
import { fileURLToPath } from "url";
import { AssetResolved, AssetResolver, ProtocolHandler, ProtocolResponse, ProtocolRule, ProtocolScheme } from "./types";
import { Fs, getMimeType } from "@shared/utils/fs";
import { normalizePath } from "@shared/utils/string";
import { FsRejectErrorCode } from "@shared/types/os";
import { StorageManager } from "../storageManager";

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

        try {
            const { data, mimeType } = await this.readFile(filePath);

            return {
                statusCode: 200,
                headers: {
                    "Content-Type": mimeType,
                    ...((this.noCache || resolved.noCache) ? {
                        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                        "Pragma": "no-cache",
                        "Expires": "0"
                    } : {
                        "Cache-Control": "public, max-age=180, immutable"
                    })
                },
                data: data
            } as ProtocolResponse;
        } catch (error) {
            this.logger.error(`Error reading file: ${filePath} - ${error}`);
            return {
                statusCode: 500,
                headers: {},
                data: undefined
            };
        }
    }

    public formatFileUrl(requested: string): string {
        const url = new URL(requested);
        return `file://${normalizePath(path.join(this.getBaseDir(), url.pathname))}`;
    }

    private async readFile(filePath: string): Promise<{ data: Buffer; mimeType: string }> {
        const data = await Fs.readRaw(filePath);
        const mimeType = getMimeType(filePath);

        if (!data.ok) {
            throw new Error(data.error.message);
        }

        return {
            data: data.data,
            mimeType,
        };
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
        const hash = url.pathname.slice(1); // Remove leading slash

        // Get storage info for this hash
        const storageInfo = this.storageManager.get(hash);
        if (!storageInfo) {
            this.logger.error(`Hash not found: ${hash}`);
            return {
                statusCode: 404,
                headers: { "Content-Type": "text/plain" },
                data: "Hash not found"
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
                // Handle file read
                return await this.handleRead(hash, storageInfo);
            } else if (request.method === 'PUT') {
                // Handle file write
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
                data: "Internal server error"
            };
        }
    }

    private async handleRead(hash: string, storageInfo: any): Promise<ProtocolResponse> {
        let result;
        if (storageInfo.raw) {
            result = await Fs.readRaw(storageInfo.path);
        } else {
            result = await Fs.read(storageInfo.path, storageInfo.encoding);
        }

        if (!result.ok) {
            return {
                statusCode: 500,
                headers: { "Content-Type": "text/plain" },
                data: `Failed to read file: ${result.error.message}`
            };
        }

        // Cleanup hash after successful read
        this.storageManager.cleanup(hash);

        const mimeType = getMimeType(storageInfo.path);
        return {
            statusCode: 200,
            headers: {
                "Content-Type": storageInfo.raw ? "application/octet-stream" : mimeType,
                "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
                "Pragma": "no-cache",
                "Expires": "0"
            },
            data: result.data
        };
    }

    private async handleWrite(hash: string, request: Request, storageInfo: any): Promise<ProtocolResponse> {
        try {
            const content = await request.arrayBuffer();
            const buffer = Buffer.from(content);

            let result;
            if (storageInfo.raw) {
                result = await Fs.writeRaw(storageInfo.path, buffer);
            } else {
                const textContent = buffer.toString(storageInfo.encoding || 'utf-8');
                result = await Fs.write(storageInfo.path, textContent, storageInfo.encoding);
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
                data: "Internal server error"
            };
        }
    }
} 