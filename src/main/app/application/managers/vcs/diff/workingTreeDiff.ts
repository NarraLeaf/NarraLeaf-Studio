import type { DocumentChangeKind, DocumentDiffEntry } from "@shared/documents/diff";
import type { RevisionId, VcsChangeKind, VcsStatus, VcsWorkingTreeDiffResult } from "@shared/types/vcs";
import { LABEL_MOVED, type ContentSide } from "./contentDiff";
import {
    DIFF_MOVE_CONFIRM_BYTE_CEILING,
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
 * **Renames are paired, and here that costs a read.** A rename arrives as a delete plus an add
 * (§4.18), and the two sides' identities are not comparable: the recorded side carries the
 * backend's own content address and nothing on disk has one. So where a comparison between two
 * REVISIONS settles a rename out of the tree walk for nothing, this one has to prove it from
 * the bytes. Three steps, each only reached by what the one before it left standing:
 *
 *  1. **Sizes.** Both sides state one without being opened, and two files of different lengths
 *     cannot hold the same bytes. A removal and an addition are candidates only at equal sizes;
 *     everything else is out before a byte is read, which is most of a tidy-up.
 *  2. **{@link DIFF_MOVE_CONFIRM_BYTE_CEILING}.** A candidate above it is left as it arrived.
 *  3. **The bytes.** Both sides are read in full and compared with `Buffer.equals`.
 *
 * **Nothing weaker than the whole file may confirm one.** Same size and a matching first
 * kilobyte is a cheap test that looks convincing, and when it is wrong it tells the author that
 * a file of theirs merely moved while its contents were in fact replaced. A few extra rows are
 * noise; that is a false statement about their work. So a candidate is either read in full or
 * reported exactly as it arrived, as one addition and one removal.
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

/** One status entry, flattened onto the document model but still knowing where it came from. */
interface WorkingFile {
    readonly path: string;
    readonly kind: DocumentChangeKind;
    /** The name the recorded side holds this file under. See where it is built. */
    readonly was: string;
    /**
     * The backend's own word, which {@link CHANGE_KINDS} has already flattened.
     *
     * Kept because the two words it collapses mean different things to rename pairing: a
     * `copied` file's source is still there, so the backend has already said this is not a move
     * and there is no removal for it to pair with. Reading it back out of `kind` is impossible.
     */
    readonly reported: VcsChangeKind;
}

export async function diffWorkingTree(
    source: WorkingTreeDiffSource,
    options: WorkingTreeDiffOptions = {},
): Promise<VcsWorkingTreeDiffResult> {
    const limit = options.limit ?? DOCUMENT_DIFF_CHANGE_LIMIT;
    const status = await source.status();
    const head = status.head;

    // Directories dropped: the backend reports them as changes in their own right (one new
    // folder with one file in it is two entries), and a directory has no bytes to compare.
    const files: WorkingFile[] = status.files
        .filter((file) => !file.directory)
        .map((file) => ({
            path: file.path,
            kind: CHANGE_KINDS[file.kind],
            // A rename arrives as delete + add rather than as a move (§4.18), so this is only
            // populated by the explicit move verbs - but where it IS set, the committed bytes
            // live under the old name and looking for them under the new one finds nothing.
            // The pairing below is the other road to a `moved` row and the two never meet: it
            // only ever looks at a `deleted` and an `added` entry, neither of which carries one.
            was: file.fromPath ?? file.path,
            reported: file.kind,
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

    // Renames are settled before anything else is planned, so a file that only moved is never
    // read a second time by the plan below - the same order `diffRevisions` takes.
    const pairing = head ? await pairRenames(source, head, files, recorded, working) : NOTHING_PAIRED;
    const paired = new Set([...pairing.moves.keys(), ...pairing.moves.values()]);

    const plan: string[] = [];
    // What the pairing already spent comes out of the same allowance, so one comparison reads
    // DIFF_TOTAL_BYTE_BUDGET whoever spends it. A candidate that failed to pair therefore leaves
    // less for the documents after it, which is the honest accounting: those bytes were read.
    let budget = DIFF_TOTAL_BYTE_BUDGET - pairing.spent;
    let complete = true;
    for (const file of files) {
        if (paired.has(file.path)) continue;
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
    // path would pay that once per document. Paths the pairing already pulled are left out of
    // it and taken from what it kept.
    const recordedPaths = files
        .filter((file) => planned.has(file.path) && file.kind !== "added" && !pairing.recorded.has(file.was))
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
        // The removal half of a rename; the pair is reported once, on the path it moved to.
        if (!pairing.moves.has(file.path) && paired.has(file.path)) {
            continue;
        }
        const spec = specForDocumentPath(file.path);
        const documentKind = spec ? { documentKind: spec.kind } : {};

        const movedFrom = pairing.moves.get(file.path);
        if (movedFrom !== undefined) {
            documents.push({
                path: file.path,
                kind: "moved",
                ...documentKind,
                diff: {
                    changes: [{ path: [], kind: "moved", label: { key: LABEL_MOVED, params: { from: movedFrom } } }],
                    complete: true,
                    total: 1,
                    tier: "opaque",
                },
            });
            continue;
        }

        if (planned.has(file.path)) {
            if (readFailure) {
                documents.push({ path: file.path, kind: file.kind, ...documentKind, diff: unreadDocumentDiff(file.kind) });
                continue;
            }
            const base = before ? pairing.recorded.get(file.was) ?? recordedBytes.get(file.was) ?? null : null;
            const bytes = after ? await bytesOnDisk(source, pairing, file.path) : null;
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

/** What one pass of rename pairing decided, and what it read on the way. */
interface RenamePairing {
    /** Added path -> the removed path holding the same bytes. */
    readonly moves: ReadonlyMap<string, string>;
    /** Bytes read while deciding, whether or not the candidate turned out to be a rename. */
    readonly spent: number;
    /** What was pulled, so the comparison after this does not pull any of it again. */
    readonly recorded: ReadonlyMap<string, Buffer | null>;
    readonly working: ReadonlyMap<string, Buffer | null>;
}

const NOTHING_PAIRED: RenamePairing = {
    moves: new Map(),
    spent: 0,
    recorded: new Map(),
    working: new Map(),
};

/**
 * Which removals and additions are the same file under two names.
 *
 * The three steps are set out at the top of this module. What is worth adding here is what each
 * one is allowed to conclude:
 *
 *  - **A size can only rule a pair OUT.** Two files of different lengths are certainly not the
 *    same bytes; two of the same length are nothing more than worth looking at. Every candidate
 *    that survives step one is still read.
 *  - **A `copied` entry is not a candidate.** The backend says a copy's source is still on disk,
 *    so there is no removal it could be paired with, and overriding that with a guess of our own
 *    would turn a copy into a move - the one reading under which the original is gone.
 *  - **Declining to pair is not an incomplete comparison.** A candidate over the ceiling, or one
 *    the budget ran out on, is reported as the addition and the removal it arrived as. Both rows
 *    are true; `complete` is about a document nobody could describe, which is a different claim.
 *
 * **Ambiguity is resolved by sorting, exactly as `pairMoves` does it.** Several files really can
 * hold identical bytes at one size, and nothing anywhere says which removal became which
 * addition. Both lists are walked in path order and paired greedily, and each removal is
 * consumed once - arbitrary, but the same arbitrary answer on every run, which is what stops a
 * change list from reshuffling between two looks at the same working tree. The comparisons are
 * quadratic within one size, the reads are not: every candidate is read once and the pairing is
 * `Buffer.equals` over what is already in memory.
 */
async function pairRenames(
    source: WorkingTreeDiffSource,
    head: RevisionId,
    files: readonly WorkingFile[],
    recorded: ReadonlyMap<string, RevisionEntry>,
    working: ReadonlyMap<string, { size: number } | null>,
): Promise<RenamePairing> {
    const removals = new Map<number, { path: string; was: string }[]>();
    const additions = new Map<number, string[]>();
    for (const file of files) {
        if (file.kind === "removed") {
            const entry = recorded.get(file.was);
            if (entry) {
                push(removals, entry.size, { path: file.path, was: file.was });
            }
        } else if (file.reported === "added") {
            const stat = working.get(file.path);
            if (stat) {
                push(additions, stat.size, file.path);
            }
        }
    }

    // Steps one and two, and after this line nothing is decided without reading. Ascending, so
    // a budget that runs out takes the most expensive groups rather than whichever ones the
    // status happened to name first.
    const candidates = [...removals.keys()]
        .filter((size) => additions.has(size) && size <= DIFF_MOVE_CONFIRM_BYTE_CEILING)
        .sort((a, b) => a - b);

    let spent = 0;
    const sizes: number[] = [];
    for (const size of candidates) {
        const cost = size * (removals.get(size)!.length + additions.get(size)!.length);
        if (spent + cost > DIFF_TOTAL_BYTE_BUDGET) continue;
        spent += cost;
        sizes.push(size);
    }
    if (sizes.length === 0) {
        return NOTHING_PAIRED;
    }

    let recordedBytes: ReadonlyMap<string, Buffer | null>;
    try {
        // One call for every candidate at once, for the same reason the plan's read is batched.
        recordedBytes = await source.readAt(head, sizes.flatMap((size) => removals.get(size)!.map((one) => one.was)));
    } catch {
        // Nothing can be paired, and that is all this failure means here: the comparison's own
        // read of the same revision is still to come and is where it gets reported (§4.29).
        return NOTHING_PAIRED;
    }

    const workingBytes = new Map<string, Buffer | null>();
    for (const size of sizes) {
        for (const path of additions.get(size)!) {
            workingBytes.set(path, await source.readWorking(path));
        }
    }

    const moves = new Map<string, string>();
    for (const size of sizes) {
        const pool = [...removals.get(size)!];
        for (const path of additions.get(size)!) {
            const bytes = workingBytes.get(path);
            if (!bytes) continue;
            const index = pool.findIndex((one) => recordedBytes.get(one.was)?.equals(bytes) === true);
            if (index < 0) continue;
            moves.set(path, pool[index].path);
            pool.splice(index, 1);
        }
    }
    return { moves, spent, recorded: recordedBytes, working: workingBytes };
}

function push<K, V>(into: Map<K, V[]>, key: K, value: V): void {
    const existing = into.get(key);
    if (existing) {
        existing.push(value);
    } else {
        into.set(key, [value]);
    }
}

/**
 * A working file's bytes, from the pairing if it already pulled them.
 *
 * `has` rather than a `??`, because the pairing records a file that vanished under it as `null`
 * and that is an answer - asking the disk again would only get the same one.
 */
async function bytesOnDisk(
    source: WorkingTreeDiffSource,
    pairing: RenamePairing,
    path: string,
): Promise<Buffer | null> {
    return pairing.working.has(path) ? pairing.working.get(path) ?? null : source.readWorking(path);
}

/**
 * One side as the content step sees it.
 *
 * The working side carries a size and no address - nothing on disk has one - so a working file
 * never satisfies {@link import("./contentDiff").probesMatch}, which is exactly right: a length
 * is not evidence, and {@link pairRenames} is the only thing here allowed to say two files hold
 * the same bytes, having read them both.
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
