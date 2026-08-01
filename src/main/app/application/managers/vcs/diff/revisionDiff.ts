import type { DocumentChangeKind, DocumentDiffEntry } from "@shared/documents/diff";
import type { RevisionId, VcsRevisionDiffResult } from "@shared/types/vcs";
import {
    DIFF_PATH_LIMIT,
    DIFF_TOTAL_BYTE_BUDGET,
    diffDocumentBytes,
    DOCUMENT_DIFF_CHANGE_LIMIT,
    specForDocumentPath,
    unreadDocumentDiff,
} from "./documentDiff";

/**
 * What changed between two revisions, document by document.
 *
 * Orchestration only - the deciding is `documentDiff.ts`'s and the reading is the
 * caller's. The source is a port rather than a Lore session for the reason every other
 * policy module here takes one: this file must stay outside the static import graph of
 * the native binding (`pluggability.test.ts` enforces that), and the ordering below is
 * worth testing without a repository on disk.
 *
 * Two reads, in this order, and neither is negotiable:
 *
 *  1. **`changedPaths` first.** It is the cheap filter - the backend compares two trees
 *     without fetching a byte - and without it this would read every file in the project
 *     twice to discover that four of them differ.
 *  2. **`documentsAt` per side, batched.** One tree walk for the whole side. On a project
 *     with a remote the first read of a revision fetches fragments over the network
 *     (docs/version-control.md §6), so a per-path read would pay that latency once per
 *     document.
 *
 * The two sides are read **one after the other, never concurrently**: a session holds one
 * store handle, and re-entering the binding on it is not a contract it makes - the same
 * reason `getHistory` takes its per-revision metadata calls in turn.
 */

export interface RevisionDiffSource {
    /** Paths differing between two revisions. Repository-relative. */
    changedPaths(from: RevisionId, to: RevisionId): Promise<readonly string[]>;
    /**
     * Bytes for many paths at one revision, in one pass over its tree.
     *
     * `null` for a path the revision does not hold - an answer, not a failure, and the
     * one that tells an addition from a removal.
     */
    documentsAt(revision: RevisionId, paths: readonly string[]): Promise<ReadonlyMap<string, Buffer | null>>;
}

export interface RevisionDiffOptions {
    readonly from: RevisionId;
    readonly to: RevisionId;
    /** Changes per document. Defaults to {@link DOCUMENT_DIFF_CHANGE_LIMIT}. */
    readonly limit?: number;
    /** Where a document that came back at a lower tier than expected is reported. */
    readonly onDegrade?: (reason: string) => void;
}

export async function diffRevisions(
    source: RevisionDiffSource,
    options: RevisionDiffOptions,
): Promise<VcsRevisionDiffResult> {
    const { from, to } = options;
    const limit = options.limit ?? DOCUMENT_DIFF_CHANGE_LIMIT;
    // Sorted and de-duplicated here rather than trusted from the backend: the order of the
    // list is the order the budget is spent in, so an unstable one would make WHICH
    // documents get compared depend on tree-walk order.
    const paths = [...new Set(await source.changedPaths(from, to))].sort();

    if (paths.length > DIFF_PATH_LIMIT) {
        options.onDegrade?.(
            `${paths.length} paths differ between ${from} and ${to}, over the ${DIFF_PATH_LIMIT} path limit,`
            + " so they are listed without being read",
        );
        return {
            from,
            to,
            documents: paths.slice(0, DIFF_PATH_LIMIT).map((path) => unreadEntry(path)),
            pathCount: paths.length,
            complete: false,
            readFailure: null,
        };
    }

    let base: ReadonlyMap<string, Buffer | null>;
    let head: ReadonlyMap<string, Buffer | null>;
    try {
        base = await source.documentsAt(from, paths);
        head = await source.documentsAt(to, paths);
    } catch (error) {
        // Not a reason to answer nothing: the paths ARE the change, and an empty list here
        // would read as "these two versions are identical". A read can fail with the revision
        // perfectly intact - the measured case is content written by an online commit, which
        // the writing process cannot fetch back even though the tree still lists it
        // (docs/version-control.md §4.29).
        const readFailure = error instanceof Error ? error.message : String(error);
        options.onDegrade?.(`could not read the bytes of ${from}..${to}: ${readFailure}`);
        return {
            from,
            to,
            documents: paths.map((path) => unreadEntry(path)),
            pathCount: paths.length,
            complete: false,
            readFailure,
        };
    }

    const documents: DocumentDiffEntry[] = [];
    let spent = 0;
    let complete = true;
    for (const path of paths) {
        const before = base.get(path) ?? null;
        const after = head.get(path) ?? null;
        if (!before && !after) {
            // A directory, which the backend reports as a changed path in its own right.
            // Neither side holds bytes for it and there is nothing to say about it.
            continue;
        }

        const kind = presenceKind(before, after);
        const size = (before?.length ?? 0) + (after?.length ?? 0);
        if (spent + size > DIFF_TOTAL_BYTE_BUDGET) {
            complete = false;
            documents.push(unreadEntry(path, kind));
            continue;
        }
        spent += size;

        const spec = specForDocumentPath(path);
        documents.push({
            path,
            kind,
            ...(spec ? { documentKind: spec.kind } : {}),
            diff: diffDocumentBytes({ path, base: before, head: after, spec }, { limit, onDegrade: options.onDegrade }),
        });
    }

    return { from, to, documents, pathCount: documents.length, complete, readFailure: null };
}

/** Which side holds the document. A revision comparison has no other way to tell. */
function presenceKind(base: Buffer | null, head: Buffer | null): DocumentChangeKind {
    if (!base) return "added";
    if (!head) return "removed";
    return "changed";
}

/** A path that is known to have changed and was deliberately not read. See {@link unreadDocumentDiff}. */
function unreadEntry(path: string, kind: DocumentChangeKind = "changed"): DocumentDiffEntry {
    const spec = specForDocumentPath(path);
    return {
        path,
        kind,
        ...(spec ? { documentKind: spec.kind } : {}),
        diff: unreadDocumentDiff(kind),
    };
}
