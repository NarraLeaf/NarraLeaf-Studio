import type { DocumentChangeKind, DocumentDiffEntry } from "@shared/documents/diff";
import type { RevisionId, VcsRevisionDiffResult } from "@shared/types/vcs";
import { contentClassOf } from "@shared/vcs/contentClass";
import { LABEL_MOVED, pairMoves, type ContentProbe, type ContentSide } from "./contentDiff";
import {
  classOfReadSides,
  DIFF_PATH_LIMIT,
  DIFF_TOTAL_BYTE_BUDGET,
  diffDocumentBytes,
  diffDocumentContent,
  DOCUMENT_DIFF_CHANGE_LIMIT,
  planPathRead,
  specForDocumentPath,
  unreadDocumentDiff
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
  readAt(
    revision: RevisionId,
    paths: readonly string[]
  ): Promise<ReadonlyMap<string, Buffer | null>>;
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
  options: RevisionDiffOptions
): Promise<VcsRevisionDiffResult> {
  const { from, to } = options;
  const limit = options.limit ?? DOCUMENT_DIFF_CHANGE_LIMIT;
  // Sorted and de-duplicated here rather than trusted from the backend: the order of the
  // list is the order the budget is spent in, so an unstable one would make WHICH
  // documents get compared depend on tree-walk order.
  const paths = [...new Set(await source.changedPaths(from, to))].sort();

  if (paths.length > DIFF_PATH_LIMIT) {
    options.onDegrade?.(
      `${paths.length} paths differ between ${from} and ${to}, over the ${DIFF_PATH_LIMIT} path limit,` +
        " so they are listed without being read"
    );
    return {
      from,
      to,
      documents: paths.slice(0, DIFF_PATH_LIMIT).map((path) => unreadEntry(path)),
      pathCount: paths.length,
      complete: false,
      readFailure: null
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
      documents: paths.map((path) => unreadEntry(path)),
      pathCount: paths.length,
      complete: false,
      readFailure
    };
  }

  // Renames are settled before anything is planned, so a file that only moved costs no read
  // on either side - which is the whole point of pairing them.
  const moves = pairMoves(
    presenceProbes(paths, baseEntries, headEntries),
    presenceProbes(paths, headEntries, baseEntries)
  );
  const paired = new Set([...moves.keys(), ...moves.values()]);
  const plan = planReads(
    paths.filter((path) => !paired.has(path)),
    baseEntries,
    headEntries
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

  for (const path of paths) {
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
          changes: [
            { path: [], kind: "moved", label: { key: LABEL_MOVED, params: { from: movedFrom } } }
          ],
          complete: true,
          total: 1,
          tier: "opaque"
        }
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
          { limit, onDegrade: options.onDegrade }
        )
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
        { limit, onDegrade: options.onDegrade }
      )
    });
  }

  return { from, to, documents, pathCount: documents.length, complete, readFailure };
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
  other: ReadonlyMap<string, RevisionEntry>
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
  headEntries: ReadonlyMap<string, RevisionEntry>
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

/** A path that is known to have changed and was deliberately not read. See {@link unreadDocumentDiff}. */
function unreadEntry(path: string, kind: DocumentChangeKind = "changed"): DocumentDiffEntry {
  const spec = specForDocumentPath(path);
  return {
    path,
    kind,
    ...(spec ? { documentKind: spec.kind } : {}),
    contentClass: contentClassOf(path),
    diff: unreadDocumentDiff(kind)
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
