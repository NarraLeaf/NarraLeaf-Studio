import { promises as fs } from "fs";
import { readFontCoverage } from "@shared/typography/fontCoverage";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { FsRejectErrorCode } from "@shared/types/os";
import { brotliDecompressSync, inflateSync } from "zlib";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The font seam: ask what a typeface can actually draw.
 *
 * One capability and it only reads. The parser is `@shared/typography/fontCoverage`, which is pure
 * and takes its decompressors as a parameter; this handler is the half that supplies them, and that
 * is the whole reason the question is answered here instead of in the renderer. WOFF2 wraps a font
 * in a Brotli stream, `DecompressionStream` has no Brotli, and Node does - so a `.woff2` in the
 * asset library is readable from main and unreadable from anywhere else in Studio.
 *
 * It also keeps the bytes where they are. A CJK typeface is twenty to thirty megabytes and the
 * callers - a lint sweep over every font in the project, and the Design panel - want a list of code
 * point ranges, not the file.
 */
export class FontCoverageProbeHandler extends IPCHandler<IPCEventType.fontProbeCoverage> {
    readonly name = IPCEventType.fontProbeCoverage;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { path }: IPCEvents[IPCEventType.fontProbeCoverage]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.fontProbeCoverage]["response"]>> {
        // The same gate every path-taking handler goes through. This one reads a whole file into
        // main and answers a summary of it, so a renderer that could name any path here would have
        // a narrow but real read primitive outside the project.
        if (!(await window.app.storageManager.isPathAllowed(window, path, "read"))) {
            return this.failed(
                new Error(`${FsRejectErrorCode.PERMISSION_DENIED}: file system access is not allowed for path: ${path}`),
            );
        }
        let bytes: Buffer;
        try {
            bytes = await fs.readFile(path);
        } catch {
            // A shard that is not there is not this handler's finding to make: `assets/unreadable`
            // already reports it, with the asset's name attached and once per asset rather than once
            // per question asked about one.
            return this.success({ result: { ok: false, reason: "malformed" } });
        }
        return this.success({
            result: readFontCoverage(new Uint8Array(bytes), {
                inflate: input => new Uint8Array(inflateSync(Buffer.from(input))),
                brotli: input => new Uint8Array(brotliDecompressSync(Buffer.from(input))),
            }),
        });
    }
}
