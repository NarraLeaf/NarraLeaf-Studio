import fs from "fs";
import path from "path";
import type { DocumentMergeDecision } from "@shared/documents/diff";
import { applyMergeDecisions, type DocumentMergeSideName } from "@shared/documents/mergeApply";
import {
  DocumentCorruptError,
  type AnyDocumentSpec,
  type DocumentParseContext
} from "@shared/documents/types";
import type { VcsMergeDocument, VcsMergeDocumentBlocker } from "@shared/types/vcs";
import { DIFF_PARSE_BYTE_CEILING, specForDocumentPath } from "./diff/documentDiff";

/**
 * The second tier of conflict resolution: settling one document one change at a time.
 *
 * **Everything it needs is already on disk.** A conflicted merge leaves `<path>~base`, `~mine` and
 * `~theirs` beside the file, each a complete and individually parseable copy of one side (docs
 * §4.23) - so the three inputs of a three-way merge are three files, and nothing here has to walk
 * the revision graph, ask the backend for a base, or read the conflicted file itself (which has
 * diff3 markers in it and is not valid JSON). That is also why this module touches no Lore at all:
 * it is `fs` plus the document registry, and the only reason it is reached through `backend.ts`
 * like the rest of `vcs/` is that `merge.ts` next door is the one that settles what it composes.
 *
 * **Reading and writing are one function each and they recompute rather than remember.** The
 * renderer is handed a decision list and hands back a side per decision; the decision list is
 * built again here from the same three files before anything is applied. `merge3` is contractually
 * pure and its inputs are files, so the two runs agree - and the alternative, letting a renderer
 * post the merged document back, would let a window write bytes neither side ever held.
 *
 * **Every refusal is a value, not a throw.** `no-spec`, `no-merge3`, `read-only`, `too-large`,
 * `too-many` and `unreadable` are all ordinary answers about ordinary files, and the surface has
 * to say which one it got: a document that falls back to tier one has to look different from one
 * whose per-change list is empty because the merge settled everything.
 *
 * **The write goes to the working tree and stops there.** Settling and recording belong to
 * `merge.ts` and `VcsManager.completeMerge`, which take the bytes this leaves behind with the
 * PLAIN `branch_merge_resolve` verb - measured to commit the working tree byte for byte (§4.25) -
 * and close the merge on offline globals (§4.29).
 */

/**
 * What the merge left beside a conflicted file. The same three names `merge.ts` copies from.
 *
 * Kept here rather than imported so this module does not pull in the one that loads the native
 * binding; they are three string constants and the pair is pinned by `merge.integration.test.ts`,
 * which asserts the on-disk names directly.
 */
const SIDECAR = { base: "~base", mine: "~mine", theirs: "~theirs" } as const;

/**
 * Most decisions one document's list will carry.
 *
 * Not a display budget: a decision carries both sides' whole values, so a translation library
 * where two people worked through a hundred keys each is already a large IPC message, and one
 * where they worked through ten thousand is a message nothing can draw and nobody can answer.
 *
 * **Past it the document falls back to tier one rather than being truncated**, and that asymmetry
 * with the diff lists is the point: a truncated change list is a lesser view of the same facts,
 * while a truncated decision list cannot be applied at all - the changes it left out would have to
 * be settled by something other than the author, which is the failure the whole tier exists to
 * avoid.
 */
export const MERGE_DECISION_LIMIT = 500;

/**
 * Read the three sides of one conflicted document and merge them.
 *
 * Repository-relative in, and every failure comes back as a {@link VcsMergeDocumentBlocker} - the
 * caller's next move is the same in all of them (draw the tier-one row and say why), and an
 * exception here would take the whole panel down over one file the author could still resolve
 * whole.
 */
export async function readMergeDocument(
  root: string,
  relativePath: string
): Promise<VcsMergeDocument> {
  const composed = composeMerge(root, relativePath);
  if (composed.blocked !== undefined) {
    return {
      path: relativePath,
      decisions: [],
      conflicts: 0,
      blocked: composed.blocked,
      ...(composed.detail ? { detail: composed.detail } : {})
    };
  }

  const { spec, merge } = composed;
  const decisions = merge.decisions as DocumentMergeDecision[];
  if (decisions.length > MERGE_DECISION_LIMIT) {
    return {
      path: relativePath,
      documentKind: spec.kind,
      decisions: [],
      conflicts: 0,
      blocked: "too-many",
      detail: `${decisions.length} changes, over the ${MERGE_DECISION_LIMIT} this can settle one at a time`
    };
  }

  // **The serialize probe, and it is the honest half of constraint one.** `assetsMetadataSpec`
  // implements `merge3` and refuses to `serialize` - deliberately, because `AssetsService` still
  // owns writing that shard and the asset services still assign `undefined` where the canonical
  // encoder requires an absent key. So its per-change result could be composed and never
  // written. Probing rather than listing the specs that can write means a spec becomes
  // resolvable the day its own migration lands, with nothing here to remember to update - and
  // the reason reaches the author as words rather than as a control that is quietly missing.
  try {
    spec.serialize(merge.document);
  } catch (error) {
    return {
      path: relativePath,
      documentKind: spec.kind,
      decisions: [],
      conflicts: 0,
      blocked: "read-only",
      detail: messageOf(error)
    };
  }

  return {
    path: relativePath,
    documentKind: spec.kind,
    decisions,
    conflicts: merge.conflicts
  };
}

/**
 * Compose the author's answers into the working tree, and stop.
 *
 * Nothing is settled or recorded here - `VcsManager.completeMerge` does both, in the one queued
 * act that also flushes the renderer's pending saves first. **The order is not negotiable**: the
 * conflicted paths are being read out of their `~mine` copies while the merge is open (§4.33), so
 * an auto-save landing after this would put the author's pre-merge document straight back over the
 * bytes this just wrote.
 *
 * Throws, unlike {@link readMergeDocument}: by the time this runs the author has pressed the
 * button, and a document that cannot be composed must stop the merge with a sentence naming it
 * rather than be quietly left holding base.
 */
export async function resolveDocumentChanges(
  root: string,
  relativePath: string,
  choices: Readonly<Record<string, DocumentMergeSideName>>
): Promise<void> {
  const composed = composeMerge(root, relativePath);
  if (composed.blocked !== undefined) {
    throw new Error(
      `${relativePath} cannot be settled change by change (${composed.blocked}` +
        `${composed.detail ? `: ${composed.detail}` : ""}).`
    );
  }

  const { spec, merge } = composed;
  const settled = applyMergeDecisions(relativePath, merge.document, merge.decisions, choices);
  // A plain write, for the reason `merge.ts` gives for its plain copy: the operation as a whole
  // spans several files and is not atomic anyway, and the merge's own three copies are still on
  // disk beside this one until the commit removes them.
  fs.writeFileSync(absoluteWithin(root, relativePath), spec.serialize(settled), "utf-8");
}

interface ComposedMerge {
  readonly document: unknown;
  readonly decisions: readonly DocumentMergeDecision[];
  readonly conflicts: number;
}

type Composed =
  | { spec: AnyDocumentSpec; merge: ComposedMerge; blocked?: undefined }
  | { blocked: VcsMergeDocumentBlocker; detail?: string };

/**
 * The shared half: find the spec, read the three copies, parse them, merge.
 *
 * `~base` is optional and its absence is add/add rather than an empty document - which is the
 * distinction `mergeKeyed` refuses to blur, because without a base "the other side does not have
 * this key" and "the other side removed it" are the same observation.
 */
function composeMerge(root: string, relativePath: string): Composed {
  const spec = specForDocumentPath(relativePath);
  if (!spec) {
    return { blocked: "no-spec" };
  }
  if (!spec.merge3) {
    return { blocked: "no-merge3" };
  }

  let absolute: string;
  try {
    absolute = absoluteWithin(root, relativePath);
  } catch (error) {
    return { blocked: "unreadable", detail: messageOf(error) };
  }

  const mine = readSide(`${absolute}${SIDECAR.mine}`);
  const theirs = readSide(`${absolute}${SIDECAR.theirs}`);
  if (!mine || !theirs) {
    // Both are written by the same merge, so one without the other means something removed it
    // - and the path only reached here because `findConflictedPaths` saw both.
    return {
      blocked: "unreadable",
      detail: `the merge's copy of ${mine ? "their" : "your"} side is missing`
    };
  }
  const base = readSide(`${absolute}${SIDECAR.base}`);

  for (const bytes of [base, mine, theirs]) {
    if (bytes && bytes.length > DIFF_PARSE_BYTE_CEILING) {
      return { blocked: "too-large", detail: `${bytes.length} bytes` };
    }
  }

  const parsedMine = parseSide(spec, relativePath, mine);
  if (!parsedMine.ok) return { blocked: "unreadable", detail: parsedMine.reason };
  const parsedTheirs = parseSide(spec, relativePath, theirs);
  if (!parsedTheirs.ok) return { blocked: "unreadable", detail: parsedTheirs.reason };
  // A `~base` that exists and cannot be parsed is NOT downgraded to add/add: that would turn an
  // unreadable ancestor into "the two sides share nothing", which reads every key one side lacks
  // as an addition rather than as a removal - silently, and in the author's favour every time.
  const parsedBase = base ? parseSide(spec, relativePath, base) : undefined;
  if (parsedBase && !parsedBase.ok) return { blocked: "unreadable", detail: parsedBase.reason };

  try {
    // Guarded even though `merge3` is contractually pure and non-throwing, for the reason
    // `documentDiff.trySpecDiff` is: this runs over documents that came out of a repository,
    // so the shapes a current Studio would never produce are exactly the ones it meets.
    const merge = spec.merge3(parsedBase?.document, parsedMine.document, parsedTheirs.document);
    if (!merge || !Array.isArray(merge.decisions)) {
      return { blocked: "unreadable", detail: `the ${spec.kind} spec returned no usable merge` };
    }
    return { spec, merge };
  } catch (error) {
    return {
      blocked: "unreadable",
      detail: `the ${spec.kind} spec threw while merging: ${messageOf(error)}`
    };
  }
}

/** Absolute, and inside the repository. Same guard `repositoryPath` applies (docs §4.16). */
function absoluteWithin(root: string, relativePath: string): string {
  const absolute = path.resolve(root, relativePath);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes the repository: ${relativePath}`);
  }
  return absolute;
}

/** One side's bytes, or null when the merge did not leave that side here. */
function readSide(file: string): Buffer | null {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

type ParsedSide = { ok: true; document: unknown } | { ok: false; reason: string };

/**
 * Parse one side, without `loadDocument`'s quarantine.
 *
 * These bytes are the merge's own copy of a recorded side, so filing them as corrupt would file a
 * good file as bad - the same reason `documentDiff.tryParse` avoids it for a revision's blobs.
 */
function parseSide(spec: AnyDocumentSpec, relativePath: string, bytes: Buffer): ParsedSide {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf-8"));
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${messageOf(error)}` };
  }
  try {
    return { ok: true, document: spec.parse(raw, parseContextFor(spec, relativePath, bytes)) };
  } catch (error) {
    return { ok: false, reason: messageOf(error) };
  }
}

function parseContextFor(
  spec: AnyDocumentSpec,
  relativePath: string,
  bytes: Buffer
): DocumentParseContext {
  return {
    path: relativePath,
    corrupt(reason: string, options?: { cause?: unknown }): never {
      throw new DocumentCorruptError({
        kind: spec.kind,
        path: relativePath,
        reason,
        text: bytes.toString("utf-8"),
        cause: options?.cause
      });
    }
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
