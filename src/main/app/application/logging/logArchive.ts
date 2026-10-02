import { promises as fs } from "fs";
import path from "path";
import { BufferZipOutput, writeZip } from "../../../buildWorker/mobile/zipWriter";
import { formatEnvironmentSection, type DiagnosticsEnvironment } from "./diagnosticsBundle";

/**
 * Everything Studio has logged, gathered into one zip for Help > Export Logs.
 *
 * The diagnostics bundle (`diagnosticsBundle.ts`) is a single readable file built around one
 * failure, with only the tail of the main log. This is the other request: "send us all of it". So
 * nothing here is trimmed to a tail unless a file is far past any size a log reaches by itself, and
 * the archive keeps each source as its own file under a folder naming where it came from:
 *
 * - `studio/` - every file in `<userData>/logs`: `main.log` and its rotated generations.
 * - `workspace/` - what the asking window holds only in memory (its Console channels, its own
 *   console buffer), formatted by the renderer and handed over as text.
 * - `project/` - the logs a Preview or a test run of the window's own project wrote inside
 *   `.nlstudio`, and the record of the last build.
 *
 * Collection never throws. A source that is missing or unreadable is listed in `environment.txt`
 * instead, because an export someone asked for after something went wrong must not be the next
 * thing that fails.
 */

/** A file headed for the archive: its entry name and its bytes. */
export type LogArchiveFile = { name: string; data: Buffer };

/** A text file the renderer formatted from state only it holds. */
export type RendererLogFile = { name: string; content: string };

export interface LogArchiveSources {
    /** `<userData>/logs`. */
    logsDir: string;
    /** The asking window's project, or null for a window that has none. */
    projectPath: string | null;
    environment: DiagnosticsEnvironment;
    rendererFiles: readonly RendererLogFile[];
}

/**
 * Larger than any log reaches by itself (`main.log` rotates at 5MB, a game's at 1MB), so in practice
 * every file travels whole. A file past it is something else that happens to sit in the folder, and
 * only its end is kept.
 */
export const MAX_ARCHIVED_FILE_BYTES = 32 * 1024 * 1024;

/** How many files a renderer may contribute, and how large each one may be. */
export const MAX_RENDERER_FILES = 64;
export const MAX_RENDERER_FILE_CHARS = 16 * 1024 * 1024;

/** The game runs that write a log inside the project, by the folder `.nlstudio` keeps them in. */
const PROJECT_RUN_FOLDERS = ["preview", "test"] as const;

/**
 * Reduce a renderer-proposed name to one plain file name.
 *
 * The renderer never chooses where in the archive a file lands: it only names a file, and main puts
 * it under `workspace/`. So separators, `..`, and anything outside a conservative set are removed
 * rather than interpreted. Returns null when nothing usable is left.
 */
export function sanitizeRendererFileName(candidate: string): string | null {
    const base = candidate.split(/[\\/]/).pop() ?? "";
    const kept = base.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 96);
    if (!kept) {
        return null;
    }
    const lower = kept.toLowerCase();
    return lower.endsWith(".log") || lower.endsWith(".txt") || lower.endsWith(".json")
        ? kept
        : `${kept}.log`;
}

/** `name.log`, then `name-2.log`, `name-3.log` ... until one is free. */
function uniqueName(name: string, taken: Set<string>): string {
    if (!taken.has(name)) {
        return name;
    }
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let index = 2;
    while (taken.has(`${stem}-${index}${extension}`)) {
        index += 1;
    }
    return `${stem}-${index}${extension}`;
}

type ReadOutcome = { data: Buffer; note?: string } | { error: string };

/** A whole file, or its last {@link MAX_ARCHIVED_FILE_BYTES} with a note saying so. */
async function readCapped(filePath: string): Promise<ReadOutcome> {
    let handle;
    try {
        handle = await fs.open(filePath, "r");
    } catch (error) {
        return { error: (error as Error).message };
    }
    try {
        const { size } = await handle.stat();
        const length = Math.min(size, MAX_ARCHIVED_FILE_BYTES);
        const buffer = Buffer.alloc(length);
        // A log can grow between the stat and the read; reading what was there at the stat is enough.
        const { bytesRead } = await handle.read(buffer, 0, length, size - length);
        const data = bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
        return size > MAX_ARCHIVED_FILE_BYTES
            ? { data, note: `last ${length} of ${size} bytes` }
            : { data };
    } catch (error) {
        return { error: (error as Error).message };
    } finally {
        await handle.close().catch(() => undefined);
    }
}

/** The regular files directly inside `dir`, sorted, or an error message when it cannot be listed. */
async function listFiles(dir: string): Promise<string[] | { error: string }> {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        return entries
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .sort((a, b) => a.localeCompare(b));
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return { error: code === "ENOENT" ? "not present" : (error as Error).message };
    }
}

/**
 * Gather every file the archive will hold, `environment.txt` first.
 *
 * Exported apart from {@link encodeLogArchive} so the selection can be tested on a temporary folder
 * without unpacking a zip.
 */
export async function collectLogArchiveFiles(sources: LogArchiveSources): Promise<LogArchiveFile[]> {
    const files: LogArchiveFile[] = [];
    const taken = new Set<string>();
    const contents: string[] = [];
    const absent: string[] = [];

    const add = (name: string, data: Buffer, origin: string, note?: string) => {
        const unique = uniqueName(name, taken);
        taken.add(unique);
        files.push({ name: unique, data });
        contents.push(`${unique}  <-  ${origin}${note ? ` (${note})` : ""}`);
    };

    const addFolder = async (dir: string, prefix: string) => {
        const listed = await listFiles(dir);
        if (!Array.isArray(listed)) {
            absent.push(`${dir}: ${listed.error}`);
            return;
        }
        for (const fileName of listed) {
            const filePath = path.join(dir, fileName);
            const read = await readCapped(filePath);
            if ("error" in read) {
                absent.push(`${filePath}: ${read.error}`);
                continue;
            }
            add(`${prefix}/${fileName}`, read.data, filePath, read.note);
        }
    };

    await addFolder(sources.logsDir, "studio");

    for (const file of sources.rendererFiles.slice(0, MAX_RENDERER_FILES)) {
        const name = sanitizeRendererFileName(file.name);
        if (!name || typeof file.content !== "string") {
            continue;
        }
        const content = file.content.length > MAX_RENDERER_FILE_CHARS
            ? file.content.slice(file.content.length - MAX_RENDERER_FILE_CHARS)
            : file.content;
        add(`workspace/${name}`, Buffer.from(content, "utf8"), "this window");
    }

    if (sources.projectPath) {
        const nlstudio = path.join(sources.projectPath, ".nlstudio");
        for (const run of PROJECT_RUN_FOLDERS) {
            await addFolder(path.join(nlstudio, run, "userData", "logs"), `project/${run}`);
        }
        const lastRunPath = path.join(nlstudio, "build", "last-run.json");
        const lastRun = await readCapped(lastRunPath);
        if ("error" in lastRun) {
            absent.push(`${lastRunPath}: ${(lastRun.error.includes("ENOENT") ? "not present" : lastRun.error)}`);
        } else {
            add("project/build/last-run.json", lastRun.data, lastRunPath, lastRun.note);
        }
    }

    const environment = [
        formatEnvironmentSection(sources.environment),
        `Project: ${sources.projectPath ?? "<none>"}`,
        "",
        "--- Contents ---",
        ...(contents.length > 0 ? contents : ["<none>"]),
        "",
        "--- Not included ---",
        ...(absent.length > 0 ? absent : ["<none>"]),
        "",
    ].join("\n");

    return [{ name: "environment.txt", data: Buffer.from(environment, "utf8") }, ...files];
}

/** Pack the files into one zip, every entry stamped with `mtime`. */
export async function encodeLogArchive(files: readonly LogArchiveFile[], mtime: Date): Promise<Buffer> {
    const output = new BufferZipOutput();
    await writeZip(
        output,
        files.map(file => ({ name: file.name, source: { kind: "buffer" as const, data: file.data } })),
        { mtime, allowZip64: true },
    );
    return output.toBuffer();
}
