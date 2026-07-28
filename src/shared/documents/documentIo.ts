import {findCanonicalJsonDefect} from "./canonicalJson";
import {normalizeDocumentPath} from "./documentPath";
import {DocumentCorruptError, DocumentParseContext, DocumentSpec} from "./types";

/**
 * Reading and writing documents, without knowing what a filesystem is.
 *
 * The main process reaches disk through `@shared/utils/fs`, the renderer through an
 * IPC-backed `FileSystemService`, and a diff over a past revision reaches no disk at
 * all - it reads blobs out of Lore. All three need the same parse/quarantine
 * behaviour, so the behaviour is here and the reaching is a port.
 *
 * The invariant this module exists to hold:
 *
 *   `loadDocument` throws only for a broken spec or a failing storage. NOTHING about
 *   the contents of a file can make it throw - bad contents produce
 *   `{status: "corrupt"}`.
 *
 * The distinction is worth keeping sharp because the two need opposite handling. A
 * corrupt file is the author's data and has to be preserved, reported and survived; a
 * broken spec is our bug and has to be loud. Collapsing them in either direction
 * turns "one document is unreadable" into "the project will not open", which is the
 * failure this milestone exists to prevent.
 */

/**
 * Storage as this module needs it. Paths are project-relative with forward slashes;
 * resolving them against a project root is the adapter's job, which is also what
 * keeps quarantine unable to write outside the project.
 *
 * Implementations must create missing parent directories on `write` and `copy` -
 * quarantine writes into a directory that has never existed before, and a silently
 * failing copy would defeat the whole point of quarantining.
 */
export interface DocumentStorage {
    /** The file's text, or `null` if it does not exist. Any other failure throws. */
    read(path: string): Promise<string | null>;
    write(path: string, text: string): Promise<void>;
    /**
     * Byte-for-byte copy. Not read-then-write: a corrupt file may not be valid UTF-8
     * at all (a truncated write cuts a multi-byte sequence in half), and decoding it
     * to a string replaces those bytes with U+FFFD. The quarantined copy has to be
     * the bytes that were actually on disk, or it is worthless as evidence.
     */
    copy(fromPath: string, toPath: string): Promise<void>;
}

/**
 * Where unreadable documents are set aside. Under `.nlstudio/`, which the working-set
 * rules exclude from the repository, so a quarantined copy never becomes a commit.
 */
export const QUARANTINE_DIRECTORY = ".nlstudio/quarantine";

export type DocumentLoadResult<T> =
    | {
        readonly status: "loaded";
        readonly document: T;
        /**
         * Whether the bytes on disk are already exactly what saving this document
         * would write. False means either non-canonical bytes or an older schema
         * version, which is the same answer as far as the normalize-on-open pass is
         * concerned: this file needs rewriting before the first commit.
         */
        readonly normalized: boolean;
    }
    | {readonly status: "missing"}
    | {
        readonly status: "corrupt";
        readonly error: DocumentCorruptError;
        /** Where the original bytes were set aside, or `null` if that failed too. */
        readonly quarantinePath: string | null;
        /** Why quarantine failed. The document is still corrupt either way. */
        readonly quarantineFailure?: unknown;
    };

export interface LoadDocumentOptions {
    /** Injected so the quarantine directory a test asserts on is the one it chose. */
    now?: () => Date;
}

/**
 * Read, validate and migrate a document.
 *
 * The one thing this must never do is write to `path`. A parse failure is the moment
 * it is most tempting to fall back to a default and carry on, and doing so converts
 * "this file is unreadable" into "this file is gone" - the author loses work to a
 * recovery path rather than to the original fault. So: copy the bytes aside, report
 * the failure, and leave the file exactly as it was found.
 */
export async function loadDocument<T>(
    spec: DocumentSpec<T>,
    storage: DocumentStorage,
    path: string,
    options: LoadDocumentOptions = {},
): Promise<DocumentLoadResult<T>> {
    const documentPath = normalizeDocumentPath(path);

    // An I/O failure propagates rather than being reported as corruption: a locked or
    // unreadable file still has its contents, and quarantining it is neither possible
    // nor desirable.
    const raw = await storage.read(documentPath);
    if (raw === null) {
        return {status: "missing"};
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw) as unknown;
    } catch (error) {
        return await quarantine(storage, documentPath, new DocumentCorruptError({
            kind: spec.kind,
            path: documentPath,
            reason: `not valid JSON: ${messageOf(error)}`,
            text: raw,
            cause: error,
        }), options);
    }

    // Before the spec sees it: are these bytes even representable? `JSON.parse` accepts
    // more than it can give back - `1e400` becomes `Infinity`, which then has no way out
    // - and without this gate such a value reaches `serialize` below and throws from the
    // one function that must never throw on contents. Checking `parsed` rather than the
    // parsed-and-migrated document is what keeps the two failure kinds apart: everything
    // rejected here came off the disk, so anything `serialize` rejects afterwards was
    // introduced by the spec and is a bug worth propagating.
    const defect = findCanonicalJsonDefect(parsed);
    if (defect) {
        return await quarantine(storage, documentPath, new DocumentCorruptError({
            kind: spec.kind,
            path: documentPath,
            reason: `holds a value that cannot survive a JSON round trip: ${defect.message}`,
            text: raw,
            cause: defect,
        }), options);
    }

    let document: T;
    try {
        document = spec.parse(parsed, createParseContext(spec, documentPath, raw));
    } catch (error) {
        const corrupt = error instanceof DocumentCorruptError
            ? error
            : new DocumentCorruptError({
                kind: spec.kind,
                path: documentPath,
                reason: messageOf(error),
                text: raw,
                cause: error,
            });
        return await quarantine(storage, documentPath, corrupt, options);
    }

    // Deliberately not guarded, and safe to leave unguarded only because of the gate
    // above: the bytes are known encodable, so a throw here means `parse` produced
    // something they did not contain. That is a broken spec - the document could never
    // be saved again - and it has to be loud rather than filed as corruption.
    return {status: "loaded", document, normalized: spec.serialize(document) === raw};
}

/**
 * Write a document in its canonical form.
 *
 * Serialisation happens before the write is attempted, so a document the encoder
 * rejects cannot half-replace a good file on disk. (The atomicity of the write itself
 * belongs to the storage adapter - see `Fs.write`.)
 */
export async function saveDocument<T>(
    spec: DocumentSpec<T>,
    storage: DocumentStorage,
    path: string,
    document: T,
): Promise<void> {
    const documentPath = normalizeDocumentPath(path);
    const text = spec.serialize(document);
    await storage.write(documentPath, text);
}

/** `.nlstudio/quarantine/<timestamp>/<original path>`. */
export function quarantinePathFor(relativePath: string, at: Date): string {
    return `${QUARANTINE_DIRECTORY}/${quarantineStamp(at)}/${normalizeDocumentPath(relativePath)}`;
}

function quarantineStamp(at: Date): string {
    const time = at.getTime();
    if (Number.isNaN(time)) {
        throw new Error("Cannot quarantine a document with an invalid timestamp.");
    }
    // `:` is illegal in a Windows filename and `.` before the directory separator reads
    // as an extension, so the ISO form is punctuated with dashes only. Still sorts
    // lexicographically, which is what makes an old quarantine directory easy to find.
    return at.toISOString().replace(/[:.]/g, "-");
}

async function quarantine<T>(
    storage: DocumentStorage,
    path: string,
    error: DocumentCorruptError,
    options: LoadDocumentOptions,
): Promise<DocumentLoadResult<T>> {
    const now = options.now ?? (() => new Date());
    let quarantinePath: string;
    try {
        quarantinePath = quarantinePathFor(path, now());
    } catch (failure) {
        return {status: "corrupt", error, quarantinePath: null, quarantineFailure: failure};
    }

    try {
        await storage.copy(path, quarantinePath);
    } catch (failure) {
        // A failed copy must not swallow the corruption report: the author still needs
        // to be told their document cannot be read, even if we could not preserve it.
        return {status: "corrupt", error, quarantinePath: null, quarantineFailure: failure};
    }

    return {status: "corrupt", error, quarantinePath};
}

function createParseContext<T>(spec: DocumentSpec<T>, path: string, text: string): DocumentParseContext {
    return {
        path,
        corrupt(reason: string, options?: {cause?: unknown}): never {
            throw new DocumentCorruptError({kind: spec.kind, path, reason, text, cause: options?.cause});
        },
    };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
