import type { DocumentChangeKind, DocumentDiffEntry } from "@shared/documents/diff";
import {
    documentSetAt,
    documentSetPathsAmong,
    foldDocumentSetPaths,
    type DocumentSetLookup,
    type DocumentUnit,
} from "@shared/documents/documentSet";
import type { RevisionId, VcsRevisionDiffResult } from "@shared/types/vcs";
import { contentClassOf } from "@shared/vcs/contentClass";
import { LABEL_MOVED, pairMoves, type ContentProbe, type ContentSide } from "./contentDiff";
import {
    classOfReadSides,
    DIFF_TOTAL_BYTE_BUDGET,
    DIFF_UNIT_LIMIT,
    diffDocumentBytes,
    diffDocumentContent,
    diffDocumentSet,
    DOCUMENT_DIFF_CHANGE_LIMIT,
    DOCUMENT_SET_MEMBER_LIMIT,
    planPathRead,
    specForDocumentPath,
    unreadDocumentDiff,
    type DocumentSetSide,
} from "./documentDiff";

/**
 * What changed between two revisions, document by document.
 *
 * Orchestration only - the deciding is `documentDiff.ts`'s and the reading is the caller's.
 * The source is a port rather than a Lore session for the reason every other policy module
 * here takes one: this file must stay outside the static import graph of the native binding
 * (`pluggability.test.ts` enforces that), and the ordering below is worth testing without a
 * repository on disk.
 *
 * Three reads, in this order, and none is negotiable:
 *
 *  1. **`changedPaths` first.** It is the cheap filter - the backend compares two trees
 *     without fetching a byte - and without it this would read every file in the project
 *     twice to discover that four of them differ.
 *  2. **`entriesAt` per side.** One tree walk each, and **not one byte read**: every child
 *     event in the walk already carries the file's size and content address, so both of those
 *     were free all along. This is what decides which paths are worth reading at all.
 *  3. **`readAt` per side, batched, for those paths only.** The port's contract says it must
 *     not walk the tree again - it addresses the blobs the walk already named. On a project
 *     with a remote the first read of a revision fetches fragments over the network
 *     (docs/version-control.md §6), so a per-path walk would pay that latency twice over.
 *
 * The two sides are read **one after the other, never concurrently**: a session holds one
 * store handle, and re-entering the binding on it is not a contract it makes - the same
 * reason `getHistory` takes its per-revision metadata calls in turn.
 *
 * **What step 2 changed.** Before it, every changed path's bytes were pulled on both sides,
 * including a re-exported 200 MB video whose entire contribution to the change list was the
 * sentence "changed, 209715200 -> 209800000 bytes" - a sentence the tree walk had already
 * handed over for nothing. The byte budget was spent AFTER the read rather than deciding it.
 */

/** What a revision's tree says about one file, before anything is read. */
export interface RevisionEntry {
    readonly size: number;
    /** Content address. Two entries with the same one hold the same bytes. */
    readonly hash?: string;
}

export interface RevisionDiffSource {
    /** Paths differing between two revisions. Repository-relative. */
    changedPaths(from: RevisionId, to: RevisionId): Promise<readonly string[]>;
    /**
     * Every file at one revision with its size and content address, from one walk of its tree.
     *
     * **Reads nothing.** The implementation must be the tree walk and only the tree walk;
     * anything that touches a blob here defeats the whole arrangement.
     */
    entriesAt(revision: RevisionId): Promise<ReadonlyMap<string, RevisionEntry>>;
    /**
     * Bytes for named paths at one revision.
     *
     * `null` for a path the revision does not hold - an answer, not a failure. Must reuse the
     * walk {@link entriesAt} already did rather than performing another; see the note above.
     */
    readAt(revision: RevisionId, paths: readonly string[]): Promise<ReadonlyMap<string, Buffer | null>>;
}

export interface RevisionDiffOptions {
    readonly from: RevisionId;
    readonly to: RevisionId;
    /** Changes per document. Defaults to {@link DOCUMENT_DIFF_CHANGE_LIMIT}. */
    readonly limit?: number;
    /** Where a document that came back at a lower tier than expected is reported. */
    readonly onDegrade?: (reason: string) => void;
    /**
     * Which paths belong to a document that is stored as several files.
     *
     * A port, defaulting to the registry Studio uses - which claims nothing today, so a
     * comparison behaves exactly as it did before. It is injectable because the layer must be
     * provable without registering a real set, and registering one is the change that must not
     * land before the story is actually chunked.
     */
    readonly sets?: DocumentSetLookup;
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
    // Before anything is read, and before the budget is spent: the fold is path arithmetic, and
    // a comparison that folded afterwards would already have paid for what folding avoids.
    const units = foldDocumentSetPaths(paths, options.sets ?? documentSetAt);

    if (units.length > DIFF_UNIT_LIMIT) {
        options.onDegrade?.(
            `${units.length} documents differ between ${from} and ${to}, over the ${DIFF_UNIT_LIMIT}`
            + " document limit, so they are listed without being read",
        );
        return {
            from,
            to,
            documents: units.slice(0, DIFF_UNIT_LIMIT).map((unit) => unreadEntry(unit.path, "changed", unit)),
            pathCount: units.length,
            complete: false,
            readFailure: null,
        };
    }

    let baseEntries: ReadonlyMap<string, RevisionEntry>;
    let headEntries: ReadonlyMap<string, RevisionEntry>;
    try {
        baseEntries = await source.entriesAt(from);
        headEntries = await source.entriesAt(to);
    } catch (error) {
        // The walk itself failing means nothing at all is known about either side - not even
        // the sizes - so every path is reported as changed and uninspected. An empty list here
        // would read as "these two versions are identical".
        const readFailure = messageOf(error);
        options.onDegrade?.(`could not list the files of ${from}..${to}: ${readFailure}`);
        return {
            from,
            to,
            documents: units.map((unit) => unreadEntry(unit.path, "changed", unit)),
            pathCount: units.length,
            complete: false,
            readFailure,
        };
    }

    // A set's files are settled against the two TREES, not against the changed list: the document
    // is read whole or not at all, so the scenes nobody touched are part of this comparison too.
    // The listing is already in memory from the two walks, so this costs no read.
    const listing = new Set([...baseEntries.keys(), ...headEntries.keys()]);
    const setFiles = new Map<string, readonly string[]>();
    for (const unit of units) {
        if (unit.kind === "set") {
            setFiles.set(unit.path, documentSetPathsAmong(unit.spec, unit.key, listing));
        }
    }

    // Renames are settled before anything is planned, so a file that only moved costs no read
    // on either side - which is the whole point of pairing them. **Only over standalone files:** a
    // member that moved inside its own set is a change to that document, and pairing it would put
    // a per-file "moved" row beside the one row the set is entitled to.
    const filePaths = units.filter((unit) => unit.kind === "file").map((unit) => unit.path);
    const moves = pairMoves(
        presenceProbes(filePaths, baseEntries, headEntries),
        presenceProbes(filePaths, headEntries, baseEntries),
    );
    const paired = new Set([...moves.keys(), ...moves.values()]);
    const plan = planReads(
        [
            ...filePaths.filter((path) => !paired.has(path)),
            ...[...setFiles.values()].filter((files) => files.length <= DOCUMENT_SET_MEMBER_LIMIT).flat(),
        ],
        baseEntries,
        headEntries,
    );
    const planned = new Set(plan.read);

    let base: ReadonlyMap<string, Buffer | null> = new Map();
    let head: ReadonlyMap<string, Buffer | null> = new Map();
    let readFailure: string | null = null;
    if (plan.read.length > 0) {
        try {
            base = await source.readAt(from, plan.read);
            head = await source.readAt(to, plan.read);
        } catch (error) {
            // The tree is intact and only the blobs are unreachable - the measured case being
            // content written by an online commit, which the writing process cannot fetch back
            // even though the walk still lists it (docs/version-control.md §4.29). The sizes
            // and addresses in hand are still true, so the paths that needed no bytes are still
            // described properly and only the ones that needed them are reported as unread.
            readFailure = messageOf(error);
            options.onDegrade?.(`could not read the bytes of ${from}..${to}: ${readFailure}`);
        }
    }

    const documents: DocumentDiffEntry[] = [];
    const complete = plan.complete && !readFailure;

    for (const unit of units) {
        if (unit.kind === "set") {
            const files = setFiles.get(unit.path) ?? [];
            if (files.length === 0) {
                // Neither tree holds a single file of it, which is the set-shaped version of the
                // directory case below: the backend reports a changed directory in its own right,
                // and a path that matched a member pattern without being a file is not a document.
                continue;
            }
            documents.push(setEntry({
                unit,
                files,
                baseEntries,
                headEntries,
                planned,
                base,
                head,
                readFailure,
                limit,
                onDegrade: options.onDegrade,
            }));
            continue;
        }

        const path = unit.path;
        const before = baseEntries.get(path);
        const after = headEntries.get(path);
        if (!before && !after) {
            // A directory, which the backend reports as a changed path in its own right.
            // Neither side holds bytes for it and there is nothing to say about it.
            continue;
        }
        // The removal half of a rename; the pair is reported once, on the path it moved to.
        if (moves.has(path) === false && paired.has(path)) {
            continue;
        }

        const kind = presenceKind(before, after);
        const spec = specForDocumentPath(path);
        const documentKind = spec ? { documentKind: spec.kind } : {};
        // The name is all this side has until bytes arrive: a revision tree has no ranged fetch,
        // so nothing here can sniff a header the way the working-tree comparison does. Refined
        // below for the paths that were read whole anyway.
        const named = { contentClass: contentClassOf(path) };

        const movedFrom = moves.get(path);
        if (movedFrom !== undefined) {
            documents.push({
                path,
                kind: "moved",
                ...documentKind,
                ...named,
                diff: {
                    changes: [{ path: [], kind: "moved", label: { key: LABEL_MOVED, params: { from: movedFrom } } }],
                    complete: true,
                    total: 1,
                    tier: "opaque",
                },
            });
            continue;
        }

        if (planned.has(path)) {
            if (readFailure) {
                documents.push({ path, kind, ...documentKind, ...named, diff: unreadDocumentDiff(kind) });
                continue;
            }
            const beforeBytes = base.get(path) ?? null;
            const afterBytes = head.get(path) ?? null;
            if (!beforeBytes && !afterBytes) {
                continue;
            }
            documents.push({
                path,
                kind,
                ...documentKind,
                // The one place this side can do better than the name, and the place it matters:
                // Studio's content store gives its files no extension at all.
                contentClass: classOfReadSides(path, afterBytes, beforeBytes),
                diff: diffDocumentBytes(
                    { path, base: beforeBytes, head: afterBytes, spec },
                    { limit, onDegrade: options.onDegrade },
                ),
            });
            continue;
        }

        documents.push({
            path,
            kind,
            ...documentKind,
            ...named,
            diff: diffDocumentContent(
                { path, base: sideOf(before), head: sideOf(after) },
                { limit, onDegrade: options.onDegrade },
            ),
        });
    }

    return { from, to, documents, pathCount: documents.length, complete, readFailure };
}

interface SetEntryRequest {
    readonly unit: Extract<DocumentUnit, { kind: "set" }>;
    /** Every file of the set that either tree holds - what has to be read to assemble it. */
    readonly files: readonly string[];
    readonly baseEntries: ReadonlyMap<string, RevisionEntry>;
    readonly headEntries: ReadonlyMap<string, RevisionEntry>;
    readonly planned: ReadonlySet<string>;
    readonly base: ReadonlyMap<string, Buffer | null>;
    readonly head: ReadonlyMap<string, Buffer | null>;
    readonly readFailure: string | null;
    readonly limit: number;
    readonly onDegrade?: (reason: string) => void;
}

/**
 * One row for one document that is stored as several files.
 *
 * **All or nothing, and that is the design rather than a shortcut.** A set's `diff` is a
 * whole-document function, so a set with one member missing from the read cannot be compared at a
 * lesser tier - it can only be compared with a member silently absent, which would report the
 * author's scene as deleted. So every reason the read fell short lands on the same answer: one row
 * saying the document changed and was not inspected, with the reason in `onDegrade`.
 */
function setEntry(request: SetEntryRequest): DocumentDiffEntry {
    const { unit, files } = request;
    const kind = presenceKind(request.baseEntries.get(unit.path), request.headEntries.get(unit.path));
    const common = {
        path: unit.path,
        kind,
        documentKind: unit.spec.kind,
        // The changed files this one row stands for, so a surface can say how many there were
        // rather than implying the document is one file.
        members: unit.paths,
        contentClass: contentClassOf(unit.path),
    };

    if (files.length > DOCUMENT_SET_MEMBER_LIMIT) {
        request.onDegrade?.(
            `${unit.path} is one document made of ${files.length} files, over the ${DOCUMENT_SET_MEMBER_LIMIT}`
            + " a comparison will assemble, so it is listed without being read",
        );
        return { ...common, diff: unreadDocumentDiff(kind) };
    }
    if (request.readFailure) {
        return { ...common, diff: unreadDocumentDiff(kind) };
    }
    const unplanned = files.filter((path) => !request.planned.has(path));
    if (unplanned.length > 0) {
        request.onDegrade?.(
            `${unit.path} could not be assembled because ${unplanned.length} of its ${files.length} files`
            + " were outside the read budget, so it is listed without being read",
        );
        return { ...common, diff: unreadDocumentDiff(kind) };
    }

    return {
        ...common,
        diff: diffDocumentSet(
            {
                path: unit.path,
                spec: unit.spec,
                key: unit.key,
                base: setSide(files, request.base),
                head: setSide(files, request.head),
            },
            { limit: request.limit, onDegrade: request.onDegrade },
        ),
    };
}

/** One side's files, from the bytes that were read. Null when that side holds none of them. */
function setSide(files: readonly string[], bytes: ReadonlyMap<string, Buffer | null>): DocumentSetSide | null {
    const parts = new Map<string, Buffer>();
    for (const path of files) {
        const buffer = bytes.get(path);
        if (buffer) {
            parts.set(path, buffer);
        }
    }
    return parts.size > 0 ? { parts } : null;
}

/**
 * Probes for the paths `entries` holds and `other` does not.
 *
 * Called twice with the two sides swapped, which is how the removals and the additions are
 * built from one definition rather than two mirrored loops.
 */
function presenceProbes(
    paths: readonly string[],
    entries: ReadonlyMap<string, RevisionEntry>,
    other: ReadonlyMap<string, RevisionEntry>,
): Map<string, ContentProbe> {
    const out = new Map<string, ContentProbe>();
    for (const path of paths) {
        const entry = entries.get(path);
        if (entry && !other.has(path)) {
            out.set(path, probeOf(entry));
        }
    }
    return out;
}

/** One side as the content step sees it: what the tree said, and no bytes. */
function sideOf(entry: RevisionEntry | undefined): ContentSide | null {
    return entry ? { probe: probeOf(entry) } : null;
}

interface ReadPlan {
    /** Paths whose bytes are worth pulling, in the order the budget was spent on them. */
    readonly read: string[];
    /** False when the byte budget stopped the plan short of everything it wanted. */
    readonly complete: boolean;
}

/**
 * Decide which paths get their bytes pulled, before a single one is.
 *
 * This is where {@link DIFF_TOTAL_BYTE_BUDGET} is now spent: against the sizes the tree walk
 * reported, rather than against buffers that are already in memory by the time anyone counts
 * them. A budget enforced after the read never prevented the read.
 */
function planReads(
    paths: readonly string[],
    baseEntries: ReadonlyMap<string, RevisionEntry>,
    headEntries: ReadonlyMap<string, RevisionEntry>,
): ReadPlan {
    const read: string[] = [];
    let budget = DIFF_TOTAL_BYTE_BUDGET;
    let complete = true;

    for (const path of paths) {
        const before = baseEntries.get(path);
        const after = headEntries.get(path);
        if (!before && !after) {
            continue;
        }
        const wanted = planPathRead(path, before?.size ?? 0, after?.size ?? 0);
        if (wanted === 0) {
            continue;
        }
        if (wanted > budget) {
            complete = false;
            continue;
        }
        budget -= wanted;
        read.push(path);
    }
    return { read, complete };
}

function probeOf(entry: RevisionEntry): ContentProbe {
    return { size: entry.size, ...(entry.hash ? { hash: entry.hash } : {}) };
}

/** Which side holds the document. A revision comparison has no other way to tell. */
function presenceKind(base: unknown, head: unknown): DocumentChangeKind {
    if (!base) return "added";
    if (!head) return "removed";
    return "changed";
}

/**
 * A document that is known to have changed and was deliberately not read. See
 * {@link unreadDocumentDiff}.
 *
 * `unit` is passed where the caller has already folded, which is also the only way this can name
 * the document's kind for a set: nothing has been read, so the manifest path is all there is, and
 * the fold is what turned it into a document.
 */
function unreadEntry(path: string, kind: DocumentChangeKind = "changed", unit?: DocumentUnit): DocumentDiffEntry {
    const spec = unit?.kind === "set" ? unit.spec : specForDocumentPath(path);
    return {
        path,
        kind,
        ...(spec ? { documentKind: spec.kind } : {}),
        ...(unit?.kind === "set" ? { members: unit.paths } : {}),
        contentClass: contentClassOf(path),
        diff: unreadDocumentDiff(kind),
    };
}

function messageOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
