import type { DocumentChangeKind, DocumentDiffEntry } from "@shared/documents/diff";
import type { RevisionId, VcsChangeKind, VcsStatus, VcsWorkingTreeDiffResult } from "@shared/types/vcs";
import {
    DIFF_PATH_LIMIT,
    DIFF_TOTAL_BYTE_BUDGET,
    diffDocumentBytes,
    DOCUMENT_DIFF_CHANGE_LIMIT,
    specForDocumentPath,
    unreadDocumentDiff,
} from "./documentDiff";

/**
 * What the author has changed since the last version, document by document.
 *
 * The same list as {@link diffRevisions}, anchored differently: one side is a revision
 * and the other is the files on disk right now. That asymmetry is the whole reason this
 * result **must never be cached** - see {@link diffWorkingTree}.
 *
 * The status read that starts it is not a pure read. Discovering a new DIRECTORY records
 * it into the repository's staged state, after which removing that directory is reported
 * as a deletion for the rest of the session even though it was never committed
 * (docs/version-control.md §4.17). So this runs when someone asks for it and never on a
 * timer - the same rule the status handler already carries.
 */

export interface WorkingTreeDiffSource {
    /** What differs from the last commit. Scans, so see the note above. */
    status(): Promise<VcsStatus>;
    /** Bytes for many paths at one revision; `null` where the revision does not hold the path. */
    documentsAt(revision: RevisionId, paths: readonly string[]): Promise<ReadonlyMap<string, Buffer | null>>;
    /**
     * Bytes of one file in the working tree, or `null` if it is not there.
     *
     * Null rather than a throw for a missing file, because a status entry can name a path
     * that has since been deleted: the scan and this read are separated by however long
     * the author took, and a race there must read as "removed", not as a failed diff.
     */
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

    // One batched read for the whole recorded side, before the per-file working reads: the
    // first read of a revision on a project with a remote goes to the network, and asking
    // per path would pay that once per document.
    const recordedPaths = files.filter((file) => file.kind !== "added").map((file) => file.was);
    let recorded: ReadonlyMap<string, Buffer | null> = new Map();
    let readFailure: string | null = null;
    if (head && recordedPaths.length > 0) {
        try {
            recorded = await source.documentsAt(head, recordedPaths);
        } catch (error) {
            // The author's working tree is still readable, but with nothing to compare against
            // every change would look like an addition - which is a worse lie than saying the
            // recorded side could not be read. Reachable with the revision intact: content
            // written by an online commit cannot be fetched back by the process that wrote it
            // (docs/version-control.md §4.29).
            readFailure = error instanceof Error ? error.message : String(error);
            options.onDegrade?.(`could not read version ${head}: ${readFailure}`);
            return {
                head,
                documents: files.map((file) => unreadEntry(file.path, file.kind)),
                pathCount: files.length,
                complete: false,
                readFailure,
            };
        }
    }

    const documents: DocumentDiffEntry[] = [];
    let spent = 0;
    let complete = true;
    for (const file of files) {
        if (spent >= DIFF_TOTAL_BYTE_BUDGET) {
            // Unlike a revision comparison, this side has not been read yet - so the budget
            // stops the reading too, not only the parsing.
            complete = false;
            documents.push(unreadEntry(file.path, file.kind));
            continue;
        }

        const base = file.kind === "added" ? null : recorded.get(file.was) ?? null;
        const working = file.kind === "removed" ? null : await source.readWorking(file.path);
        if (!base && !working) {
            // Deleted between the scan and this read, and never recorded either: there is
            // nothing on either side to describe.
            continue;
        }

        spent += (base?.length ?? 0) + (working?.length ?? 0);
        const spec = specForDocumentPath(file.path);
        documents.push({
            path: file.path,
            kind: file.kind,
            ...(spec ? { documentKind: spec.kind } : {}),
            diff: diffDocumentBytes(
                { path: file.path, base, head: working, spec },
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

function unreadEntry(path: string, kind: DocumentChangeKind): DocumentDiffEntry {
    const spec = specForDocumentPath(path);
    return {
        path,
        kind,
        ...(spec ? { documentKind: spec.kind } : {}),
        diff: unreadDocumentDiff(kind),
    };
}
