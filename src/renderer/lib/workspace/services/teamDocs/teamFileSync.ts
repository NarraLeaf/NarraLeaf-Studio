import {
    ASSET_CONTENT_ROOT,
    isProjectDocumentPath,
    isTeamFilePath,
    isWholeFilePath,
    type TeamFileContent,
} from "@shared/authority/project";

/**
 * The files of a team project that have no finer operations, kept in step with the server whole.
 *
 * Every document the server applies operations to travels as those operations. Everything else the
 * project keeps - the project file, story animations, the save schema, presets, whatever a later
 * Studio adds - is written by its editor exactly as in a personal project, and this notices the
 * write and sends the file whole (`put-file`), stamped with the seq this window stood at. Somebody
 * who wrote the same file after that gets their version kept and this one refused, which is
 * reported with the author's bytes so nothing is lost. A file somebody else put arrives as an
 * effect and is written here, and the editors re-read it.
 *
 * Offline it is the same thing with a longer gap: every file of the project - the documents too -
 * is compared on reconnecting with what it was when the connection went, and what changed is sent
 * whole with the seq it was based on. (Stories never travel whole: their rows are replayed.)
 *
 * This module is the bookkeeping - what this window and the server last agreed each file was, and
 * what differs - over ports, so it runs in a test without a disk.
 */

/** What a window needs from the world to keep files in step. Paths are project-relative. */
export type TeamFilePorts = {
    /**
     * Every file on disk under the project that `scope` admits: `whole` is the files that only
     * travel whole; `all` adds the documents and the asset files (for an offline replay).
     */
    list(scope: "whole" | "all"): Promise<string[]>;
    read(path: string): Promise<Uint8Array | null>;
    write(path: string, bytes: Uint8Array): Promise<void>;
    remove(path: string): Promise<void>;
    /** Put everything the editors owe the disk on it, so a re-read loses nothing. */
    flush(): Promise<void>;
    /** Every editor re-reads what it owns from disk. */
    reload(): Promise<void>;
    /** SHA-256, lowercase hex. */
    digest(bytes: Uint8Array): Promise<string>;
    /** Send a file's bytes up to the server's blob store. Null when it would not take them. */
    offer(path: string, bytes: Uint8Array): Promise<{ transferId: string; digest: string; size: number } | null>;
    /** Bring a file's bytes down from the server's blob store. Null when they cannot be had. */
    collect(path: string, transfer: { transferId: string; digest: string; size: number }): Promise<Uint8Array | null>;
    /** Be told of every write this window makes to a project file. */
    observe(listener: (path: string) => void): () => void;
};

/** A file's content as the server holds or sends it, decoded; null for no file. */
export type TeamFileBytes = Uint8Array | null;

/** One file whose content differs from what this window and the server last agreed. */
export type TeamFileChange = { path: string; bytes: TeamFileBytes };

/** An asset file's entry in a manifest: content-addressed, so being there is all there is to know. */
export const PRESENT = "*";

/** The largest text a file travels inline as; larger, or binary past {@link INLINE_BINARY}, goes as a transfer. */
const INLINE_TEXT = 64 * 1024;
const INLINE_BINARY = 48 * 1024;

/** Whether a path is one of the asset library's content files. */
export function isAssetContentPath(path: string): boolean {
    return path.startsWith(`${ASSET_CONTENT_ROOT}/`);
}

/** Whether an offline replay sends a path whole: any shared file but the stories (rows) and the comments. */
export function isReplayedWhole(path: string): boolean {
    return isTeamFilePath(path);
}

/**
 * Read every file `scope` admits and answer its digest, by path. Asset content files answer
 * {@link PRESENT} without being read: their name is their digest.
 */
export async function manifestOf(ports: TeamFilePorts, scope: "whole" | "all"): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    for (const path of await ports.list(scope)) {
        if (scope === "whole" ? !isWholeFilePath(path) : !isReplayedWhole(path)) continue;
        if (isAssetContentPath(path)) {
            out.set(path, PRESENT);
            continue;
        }
        const bytes = await ports.read(path);
        if (bytes !== null) out.set(path, await ports.digest(bytes));
    }
    return out;
}

/**
 * What differs between `reference` (what was agreed) and the disk now: files written, made, or
 * removed. A removed asset file is not a change - asset files go when nothing names them, which the
 * asset records say - and neither is an unchanged one.
 */
export async function changesSince(
    ports: TeamFilePorts,
    reference: ReadonlyMap<string, string>,
    scope: "whole" | "all",
): Promise<TeamFileChange[]> {
    const now = await manifestOf(ports, scope);
    const changes: TeamFileChange[] = [];
    for (const [path, digest] of now) {
        if (reference.get(path) === digest) continue;
        if (digest === PRESENT && reference.has(path)) continue;
        changes.push({ path, bytes: await ports.read(path) });
    }
    for (const path of reference.keys()) {
        if (now.has(path) || isAssetContentPath(path)) continue;
        if (scope === "whole" && !isWholeFilePath(path)) continue;
        changes.push({ path, bytes: null });
    }
    return changes;
}

/**
 * How a file's bytes travel: inline as text when they are text and small, inline as base64 when
 * small, otherwise up to the blob store first. A document always travels as text (the server
 * checks it the way reading it does). Null when the blob store would not take the bytes.
 */
export async function contentFor(ports: TeamFilePorts, path: string, bytes: TeamFileBytes): Promise<TeamFileContent | null | "unsendable"> {
    if (bytes === null) return null;
    const text = decodeText(bytes);
    if (isProjectDocumentPath(path)) {
        return text === null ? "unsendable" : { encoding: "utf8", data: text };
    }
    if (text !== null && bytes.length <= INLINE_TEXT) return { encoding: "utf8", data: text };
    if (bytes.length <= INLINE_BINARY) return { encoding: "base64", data: encodeBase64(bytes) };
    const offered = await ports.offer(path, bytes);
    return offered === null ? "unsendable" : { blob: offered };
}

/** The bytes a file's content stands for, collecting a transfer when it names one. */
export async function bytesOf(ports: TeamFilePorts, path: string, content: TeamFileContent | null): Promise<TeamFileBytes | "unavailable"> {
    if (content === null) return null;
    if ("blob" in content) return (await ports.collect(path, content.blob)) ?? "unavailable";
    return content.encoding === "utf8" ? new TextEncoder().encode(content.data) : decodeBase64(content.data);
}

function decodeText(bytes: Uint8Array): string | null {
    if (bytes.includes(0)) return null;
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
}

export function encodeBase64(bytes: Uint8Array): string {
    let binary = "";
    for (let index = 0; index < bytes.length; index += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary);
}

export function decodeBase64(text: string): Uint8Array {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}
