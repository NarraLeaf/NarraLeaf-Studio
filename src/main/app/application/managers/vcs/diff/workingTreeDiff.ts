import type { DocumentChangeKind, DocumentDiffEntry } from "@shared/documents/diff";
import type { RevisionId, VcsChangeKind, VcsStatus, VcsWorkingTreeDiffResult } from "@shared/types/vcs";
import type { ContentSide } from "./contentDiff";
import {
    DIFF_PATH_LIMIT,
    DIFF_TOTAL_BYTE_BUDGET,
    diffDocumentBytes,
    diffDocumentContent,
    DOCUMENT_DIFF_CHANGE_LIMIT,
    planPathRead,
    specForDocumentPath,
    unreadDocumentDiff,
} from "./documentDiff";
import type { RevisionEntry } from "./revisionDiff";

/**
 * What the author has changed since the last version, document by document.
 *
 * The same list as {@link import("./revisionDiff").diffRevisions}, anchored differently: one
 * side is a revision and the other is the files on disk right now. That asymmetry is the whole
 * reason this result **must never be cached** - see {@link diffWorkingTree}.
 *
 * The status read that starts it is not a pure read. Discovering a new DIRECTORY records it
 * into the repository's staged state, after which removing that directory is reported as a
 * deletion for the rest of the session even though it was never committed
 * (docs/version-control.md §4.17). So this runs when someone asks for it and never on a timer -
 * the same rule the status handler already carries.
 *
 * **Sizes are settled before any bytes are.** Both sides can say how big a file is without
 * opening it - the recorded side from its tree walk, the working side from a `stat` - and that
 * is enough to decide which files are worth reading. Before this, a working tree holding a
 * freshly re-exported 200 MB video pulled both copies into the main process to report two
 * numbers that were already in hand.
 *
 * **Renames are not paired here, and cannot be.** A rename arrives as a delete plus an add
 * (§4.18); pairing them means proving the bytes are the same, and the two sides' identities are
 * not comparable - the recorded side carries the backend's own content address, and nothing on
 * disk has one. Proving it would mean reading both files in full, which is the cost this whole
 * module exists to avoid. A comparison between two REVISIONS has both addresses for free and
 * does pair them.
 */

export interface WorkingTreeDiffSource {
    /** What differs from the last commit. Scans, so see the note above. */
    status(): Promise<VcsStatus>;
    /**
     * Every file at one revision with its size and content address, from one walk of its tree.
     * Reads nothing.
     */
    entriesAt(revision: RevisionId): Promise<ReadonlyMap<string, RevisionEntry>>;
    /** Bytes for named paths at one revision; `null` where the revision does not hold the path. */
    readAt(revision: RevisionId, paths: readonly string[]): Promise<ReadonlyMap<string, Buffer | null>>;
    /**
     * The size of one working file, or `null` if it is not there.
     *
     * Null rather than a throw for a missing file, because a status entry can name a path that
     * has since been deleted: the scan and this read are separated by however long the author
     * took, and a race there must read as "removed", not as a failed diff.
     */
    statWorking(repositoryRelativePath: string): Promise<{ size: number } | null>;
    /** Bytes of one working file, or `null` if it is not there. Same reasoning as above. */
    readWorking(repositoryRelativePath: string): Promise<Buffer | null>;
}

export interface WorkingTreeDiffOptions {
    readonly limit?: number;
    readonly onDegrade?: (reason: string) => void;
}

/**
 * How Lore's five change kinds land on the document model's four.
 *
 * A copy is an addition as far as a diff is concerned - there is nothing on the other
 * side to compare against - and a move keeps its own kind because the bytes usually did
 * not change at all, which is the one thing worth saying about it.
 */
const CHANGE_KINDS: Readonly<Record<VcsChangeKind, DocumentChangeKind>> = {
    added: "added",
    modified: "changed",
    deleted: "removed",
    moved: "moved",
    copied: "added",
};

export async function diffWorkingTree(
    source: WorkingTreeDiffSource,
    options: WorkingTreeDiffOptions = {},
): Promise<VcsWorkingTreeDiffResult> {
    const limit = options.limit ?? DOCUMENT_DIFF_CHANGE_LIMIT;
    const status = await source.status();
    const head = status.head;

    // Directories dropped: the backend reports them as changes in their own right (one new
    // folder with one file in it is two entries), and a directory has no bytes to compare.
    const files = status.files
        .filter((file) => !file.directory)
        .map((file) => ({
            path: file.path,
            kind: CHANGE_KINDS[file.kind],
            // A rename arrives as delete + add rather than as a move (§4.18), so this is only
            // populated by the explicit move verbs - but where it IS set, the committed bytes
            // live under the old name and looking for them under the new one finds nothing.
            was: file.fromPath ?? file.path,
        }))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    if (files.length > DIFF_PATH_LIMIT) {
        options.onDegrade?.(
            `${files.length} files have changed, over the ${DIFF_PATH_LIMIT} path limit,`
            + " so they are listed without being read",
        );
        return {
            ...(head ? { head } : {}),
            documents: files.slice(0, DIFF_PATH_LIMIT).map((file) => unreadEntry(file.path, file.kind)),
            pathCount: files.length,
            complete: false,
            readFailure: null,
        };
    }

    const needsRecorded = files.some((file) => file.kind !== "added");
    let recorded: ReadonlyMap<string, RevisionEntry> = new Map();
    if (head && needsRecorded) {
        try {
            recorded = await source.entriesAt(head);
        } catch (error) {
            // The author's working tree is still readable, but with nothing to compare against
            // every change would look like an addition - which is a worse lie than saying the
            // recorded side could not be listed.
            const readFailure = messageOf(error);
            options.onDegrade?.(`could not list version ${head}: ${readFailure}`);
            return {
                head,
                documents: files.map((file) => unreadEntry(file.path, file.kind)),
                pathCount: files.length,
                complete: false,
                readFailure,
            };
        }
    }

    // One `stat` per file, in place of one read per file. This is the step that stops a
    // comparison touching a large asset at all.
    const working = new Map<string, { size: number } | null>();
    for (const file of files) {
        working.set(file.path, file.kind === "removed" ? null : await source.statWorking(file.path));
    }

    const plan: string[] = [];
    let budget = DIFF_TOTAL_BYTE_BUDGET;
    let complete = true;
    for (const file of files) {
        const before = file.kind === "added" ? undefined : recorded.get(file.was);
        const wanted = planPathRead(file.path, before?.size ?? 0, working.get(file.path)?.size ?? 0);
        if (wanted === 0) continue;
        if (wanted > budget) {
            complete = false;
            continue;
        }
        budget -= wanted;
        plan.push(file.path);
    }
    const planned = new Set(plan);

    // One batched read for the whole recorded side, before the per-file working reads: the
    // first read of a revision on a project with a remote goes to the network, and asking per
    // path would pay that once per document.
    const recordedPaths = files
        .filter((file) => planned.has(file.path) && file.kind !== "added")
        .map((file) => file.was);
    let recordedBytes: ReadonlyMap<string, Buffer | null> = new Map();
    let readFailure: string | null = null;
    if (head && recordedPaths.length > 0) {
        try {
            recordedBytes = await source.readAt(head, recordedPaths);
        } catch (error) {
            // The tree listed fine and only the blobs are unreachable - the measured case being
            // content written by an online commit, which the writing process cannot fetch back
            // (docs/version-control.md §4.29). The sizes are still true, so the files that
            // needed no bytes keep their proper rows and only the planned ones go unread.
            readFailure = messageOf(error);
            options.onDegrade?.(`could not read version ${head}: ${readFailure}`);
            complete = false;
        }
    }

    const documents: DocumentDiffEntry[] = [];
    for (const file of files) {
        const before = file.kind === "added" ? undefined : recorded.get(file.was);
        const after = working.get(file.path) ?? undefined;
        if (!before && !after) {
            // Deleted between the scan and this read, and never recorded either: there is
            // nothing on either side to describe.
            continue;
        }
        const spec = specForDocumentPath(file.path);
        const documentKind = spec ? { documentKind: spec.kind } : {};

        if (planned.has(file.path)) {
            if (readFailure) {
                documents.push({ path: file.path, kind: file.kind, ...documentKind, diff: unreadDocumentDiff(file.kind) });
                continue;
            }
            const base = before ? recordedBytes.get(file.was) ?? null : null;
            const bytes = after ? await source.readWorking(file.path) : null;
            if (!base && !bytes) {
                continue;
            }
            documents.push({
                path: file.path,
                kind: file.kind,
                ...documentKind,
                diff: diffDocumentBytes(
                    { path: file.path, base, head: bytes, spec },
                    { limit, onDegrade: options.onDegrade },
                ),
            });
            continue;
        }

        documents.push({
            path: file.path,
            kind: file.kind,
            ...documentKind,
            diff: diffDocumentContent(
                { path: file.path, base: sideOf(before), head: sideOf(after) },
                { limit, onDegrade: options.onDegrade },
            ),
        });
    }

    return {
        ...(head ? { head } : {}),
        documents,
        pathCount: documents.length,
        complete,
        readFailure,
    };
}

/**
 * One side as the content step sees it.
 *
 * The working side carries a size and no address - nothing on disk has one - so a working file
 * never satisfies {@link import("./contentDiff").probesMatch}, which is exactly right: this
 * module must not claim two files hold the same bytes on the strength of their lengths.
 */
function sideOf(entry: { size: number; hash?: string } | undefined): ContentSide | null {
    return entry ? { probe: { size: entry.size, ...(entry.hash ? { hash: entry.hash } : {}) } } : null;
}

function unreadEntry(path: string, kind: DocumentChangeKind): DocumentDiffEntry {
    const spec = specForDocumentPath(path);
    return {
        path,
        kind,
        ...(spec ? { documentKind: spec.kind } : {}),
        diff: unreadDocumentDiff(kind),
    };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
