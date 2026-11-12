import os from "os";
import path from "path";
import { BrowserWindow, session } from "electron";
import { pathToFileURL } from "url";
import { unpatchedFsPromises as fs } from "../../../../../utils/unpatchedFs";
import { DOCX_PARTS, isXlsxPart, readDocxParagraphs, readXlsxSheets, type OfficeReadResult } from "@shared/manuscript/officeRead";
import { IPCMessageType } from "@shared/types/ipc";
import { IPCEventType, IPCEvents, RequestStatus } from "@shared/types/ipcEvents";
import { FsRejectErrorCode } from "@shared/types/os";
import { parseZipIndex, readEntryBytes } from "../../../../../buildWorker/mobile/zipModel";
import { BufferZipOutput, writeZip } from "../../../../../buildWorker/mobile/zipWriter";
import { AppWindow } from "../appWindow";
import { IPCHandler } from "./IPCHandler";

/**
 * The script document seam: read a Word document or spreadsheet for an import, and write the two
 * readable-script formats an export produces. The renderer does all the parsing and typesetting
 * (pure modules, unit tested); main supplies the three things only it has - zlib, a zip writer, and
 * Chromium's PDF printer.
 */

/** Larger than any script; small enough that a mislabelled video is refused before it is read. */
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
/** What the XML parts of one document may inflate to, all together. */
const MAX_EXTRACTED_BYTES = 128 * 1024 * 1024;

function denied(path: string): Error {
    return new Error(`${FsRejectErrorCode.PERMISSION_DENIED}: file system access is not allowed for path: ${path}`);
}

/** The text parts of a docx or xlsx, or why there are none. Exported for the tests. */
export function readOfficeArchive(bytes: Buffer): OfficeReadResult {
    if (bytes.length > MAX_ARCHIVE_BYTES) {
        return { ok: false, reason: "tooLarge" };
    }
    let index: ReturnType<typeof parseZipIndex>;
    try {
        index = parseZipIndex(bytes);
    } catch {
        return { ok: false, reason: "notOffice" };
    }
    const names = new Set(index.entries.map(entry => entry.name));
    const kind = names.has("word/document.xml") ? "docx" : names.has("xl/workbook.xml") ? "xlsx" : null;
    if (!kind) {
        return { ok: false, reason: "notOffice" };
    }
    const wanted = (name: string) => (kind === "docx" ? (DOCX_PARTS as readonly string[]).includes(name) : isXlsxPart(name));
    const parts: Record<string, string> = {};
    let extracted = 0;
    try {
        for (const entry of index.entries) {
            if (!wanted(entry.name)) {
                continue;
            }
            extracted += entry.uncompressedSize;
            if (extracted > MAX_EXTRACTED_BYTES) {
                return { ok: false, reason: "tooLarge" };
            }
            parts[entry.name] = readEntryBytes(bytes, entry).toString("utf-8");
        }
        return kind === "docx"
            ? { ok: true, kind, paragraphs: readDocxParagraphs(parts) }
            : { ok: true, kind, sheets: readXlsxSheets(parts) };
    } catch {
        return { ok: false, reason: "unreadable" };
    }
}

export class ManuscriptReadOfficeHandler extends IPCHandler<IPCEventType.manuscriptReadOffice> {
    readonly name = IPCEventType.manuscriptReadOffice;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { path: filePath }: IPCEvents[IPCEventType.manuscriptReadOffice]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.manuscriptReadOffice]["response"]>> {
        if (!(await window.app.storageManager.isPathAllowed(window, filePath, "read"))) {
            return this.failed(denied(filePath));
        }
        let bytes: Buffer;
        try {
            const stat = await fs.stat(filePath);
            if (stat.size > MAX_ARCHIVE_BYTES) {
                return this.success({ result: { ok: false, reason: "tooLarge" } });
            }
            bytes = await fs.readFile(filePath);
        } catch {
            return this.success({ result: { ok: false, reason: "unreadable" } });
        }
        return this.success({ result: readOfficeArchive(bytes) });
    }
}

/** The bytes of a .docx made of these parts. Exported for the tests. */
export async function zipDocxParts(parts: readonly { name: string; content: string }[]): Promise<Buffer> {
    const output = new BufferZipOutput();
    await writeZip(
        output,
        parts.map(part => ({ name: part.name, source: { kind: "buffer" as const, data: Buffer.from(part.content, "utf-8") }, method: "deflate" as const })),
        { mtime: new Date(), allowZip64: false },
    );
    return output.toBuffer();
}

export class ManuscriptWriteDocxHandler extends IPCHandler<IPCEventType.manuscriptWriteDocx> {
    readonly name = IPCEventType.manuscriptWriteDocx;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { path: filePath, parts }: IPCEvents[IPCEventType.manuscriptWriteDocx]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.manuscriptWriteDocx]["response"]>> {
        if (!(await window.app.storageManager.isPathAllowed(window, filePath, "write"))) {
            return this.failed(denied(filePath));
        }
        try {
            await fs.writeFile(filePath, await zipDocxParts(parts));
            return this.success({});
        } catch (error) {
            return this.failed(error);
        }
    }
}

const PRINT_PARTITION = "manuscript-print";

export class ManuscriptPrintPdfHandler extends IPCHandler<IPCEventType.manuscriptPrintPdf> {
    readonly name = IPCEventType.manuscriptPrintPdf;
    readonly type = IPCMessageType.request;

    public async handle(
        window: AppWindow,
        { path: filePath, html, footerHtml }: IPCEvents[IPCEventType.manuscriptPrintPdf]["data"],
    ): Promise<RequestStatus<IPCEvents[IPCEventType.manuscriptPrintPdf]["response"]>> {
        if (!(await window.app.storageManager.isPathAllowed(window, filePath, "write"))) {
            return this.failed(denied(filePath));
        }
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "nls-manuscript-"));
        const pagePath = path.join(directory, "script.html");
        const pageUrl = pathToFileURL(pagePath).href;
        let printer: BrowserWindow | null = null;
        try {
            await fs.writeFile(pagePath, html, "utf-8");
            // The page is the author's own story text, but it is still text: scripts are off and the
            // window's session answers nothing except the one file it was given.
            const printSession = session.fromPartition(PRINT_PARTITION);
            printSession.webRequest.onBeforeRequest((details, callback) => {
                callback({ cancel: details.url !== pageUrl });
            });
            printer = new BrowserWindow({
                show: false,
                width: 794,
                height: 1123,
                webPreferences: {
                    javascript: false,
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false,
                    webSecurity: true,
                    session: printSession,
                    spellcheck: false,
                },
            });
            printer.webContents.on("will-navigate", event => event.preventDefault());
            printer.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
            await printer.loadURL(pageUrl);
            const pdf = await printer.webContents.printToPDF({
                pageSize: "A4",
                printBackground: true,
                preferCSSPageSize: true,
                displayHeaderFooter: true,
                headerTemplate: "<span></span>",
                footerTemplate: footerHtml,
            });
            await fs.writeFile(filePath, pdf);
            return this.success({});
        } catch (error) {
            return this.failed(error);
        } finally {
            if (printer && !printer.isDestroyed()) {
                printer.destroy();
            }
            await fs.rm(directory, { recursive: true, force: true }).catch(() => undefined);
        }
    }
}
