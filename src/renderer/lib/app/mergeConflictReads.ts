import { versionedProjectRelativePath } from "./writeFreeze";

/**
 * While a merge is open, a conflicted document reads as the author's own side of it.
 *
 * **The problem this exists for is that a project mid-merge could not be opened at all.** The
 * backend writes diff3 markers into every file it could not settle (docs/version-control.md §4.23),
 * so `editor/story/index.json` stops being valid JSON - and the story index is parsed while the
 * workspace is starting up. The workspace therefore failed to initialise with `Failed to parse JSON
 * from .../editor/story/index.json`, and the failure screen offers Retry, the launcher and another
 * project. **None of those lead to the merge**, so the moment there was something to resolve, the
 * surface for resolving it was unreachable. Reopening mid-merge is not an edge case; it is the case
 * the whole sidecar-based `readMergeState` exists to serve.
 *
 * The principle it is fixed by: **a document that is unparseable
 * because a merge is open is not corrupt**, and quarantining it - filing it away under a name that
 * says it is broken - would be recording a good file as a bad one. An open merge is knowable before
 * any document is parsed: `readMergeState` needs only the status header and a walk for sidecars.
 *
 * So the substitution: for the conflicted paths, and ONLY those, a read answers with the merge's own
 * copy of the author's side (`<path>~mine`, byte-identical to what they last committed, §4.23). The
 * workspace opens on a project that is coherent, that is theirs, and that is frozen - see
 * `workspaceProjectPreflight`, which installs this and the freeze together, before a single service
 * has parsed anything.
 *
 * **Why this is not a `DocumentSource`.** That latch is the right shape for "the workspace is
 * showing another version" and it is what a revision preview uses - but a source stands in for the
 * WHOLE project (`readProjectDataFromSource` redirects every versioned path once one is installed),
 * and here all but a handful of paths must still be read from disk, because the automerged result is
 * on disk and is exactly what the merge is about to record. A source could only express that by
 * reading the disk itself, which is the recursion `createWorkingTreeDocumentSource` warns about.
 * `DocumentOrigin` also has no member for this state, and claiming `revision` would put a version
 * label on a workspace that is showing no revision. This is the same single boundary
 * (`BaseFileSystemService.read`), consulted in the same place, for a case that latch cannot hold.
 *
 * **Module-level and never persisted**, exactly like the freeze and the source latches: the read
 * path it guards is static and is reached from entry points that have no workspace, and a
 * substitution that survived would be a project quietly showing pre-merge documents with no cause a
 * reader could see.
 */

/** What the backend calls its copy of the side the conflict markers label `ours`. See §4.31. */
const MINE_SIDECAR_SUFFIX = "~mine";

type ActiveSubstitution = {
  projectPath: string;
  /** Repository-relative, forward slashes - the spelling `versionedProjectRelativePath` answers. */
  paths: ReadonlySet<string>;
};

let active: ActiveSubstitution | null = null;

/**
 * Read these conflicted paths as the author's own side until {@link clearMergeConflictReads}.
 *
 * Installed only when a merge left conflicts behind. A merge whose automerge settled everything
 * leaves nothing unparseable, so it gets no substitution and the workspace reads the disk - which
 * is the merge result, and is what the commit that closes it will record.
 */
export function setMergeConflictReads(projectPath: string, relativePaths: readonly string[]): void {
  if (relativePaths.length === 0) {
    active = null;
    return;
  }
  active = { projectPath, paths: new Set(relativePaths.map(normalize)) };
}

/**
 * Read the disk again.
 *
 * **Must run before the workspace re-reads its documents after a merge is finished or abandoned**,
 * and the ordering is not cosmetic: the commit deletes the sidecars, so a reload that still had this
 * installed would ask for files that are gone and every conflicted document would arrive as absent -
 * the author's resolved work replaced by defaults, one save away from being written.
 */
export function clearMergeConflictReads(): void {
  active = null;
}

/** Whether anything is being substituted. For a surface that wants to say so, not for a reader. */
export function hasMergeConflictReads(): boolean {
  return active !== null;
}

/**
 * The path to read instead of `absolutePath`, or null to read what was asked for.
 *
 * Null for every path outside the substitution, which is nearly all of them - including everything
 * outside the versioned working set, since `versionedProjectRelativePath` answers null there.
 */
export function mergeConflictReadPath(absolutePath: string): string | null {
  const current = active;
  if (!current) {
    return null;
  }
  const relative = versionedProjectRelativePath(current.projectPath, absolutePath);
  if (relative === null || !current.paths.has(normalize(relative))) {
    return null;
  }
  // The sidecar is beside the file, so appending the suffix to the ABSOLUTE path is the whole
  // mapping - and it lands outside the substituted set, so the read of it does not recurse.
  return `${absolutePath}${MINE_SIDECAR_SUFFIX}`;
}

function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}
