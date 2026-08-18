import { RendererError, throwException } from "@shared/utils/error";
import { DirEntry, findNlprojConfigFileName } from "@shared/utils/nlproj";
import { getInterface } from "@/lib/app/bridge";
import { clearMergeConflictReads, setMergeConflictReads } from "@/lib/app/mergeConflictReads";
import { freezeProjectWrites } from "@/lib/app/writeFreeze";
import { BaseFileSystemService } from "../services/core/FileSystem";

export const WorkspaceStartupErrorKind = {
  MissingProjectConfig: "missing-project-config"
} as const;

export type WorkspaceStartupErrorKind =
  (typeof WorkspaceStartupErrorKind)[keyof typeof WorkspaceStartupErrorKind];

export class WorkspaceStartupError extends RendererError {
  constructor(
    public readonly kind: WorkspaceStartupErrorKind,
    public readonly projectPath: string,
    message: string
  ) {
    super(message);
    this.name = "WorkspaceStartupError";
  }
}

export interface WorkspaceProjectPreflightIssue {
  kind: typeof WorkspaceStartupErrorKind.MissingProjectConfig;
}

export function isWorkspaceStartupError(error: Error): error is WorkspaceStartupError {
  return error instanceof WorkspaceStartupError;
}

export function getWorkspaceProjectPreflightIssue(
  entries: DirEntry[]
): WorkspaceProjectPreflightIssue | null {
  if (findNlprojConfigFileName(entries)) {
    return null;
  }

  return { kind: WorkspaceStartupErrorKind.MissingProjectConfig };
}

/**
 * Arrange for a project with an open merge to be openable at all.
 *
 * **A project mid-merge could not be opened before this existed**, and the failure was total: the
 * backend writes diff3 markers into every file it could not settle (docs §4.23), `editor/story/
 * index.json` is one of them and is parsed during startup, so the workspace stopped at "Failed to
 * parse JSON from ...". The failure screen offers Retry, the launcher and another project - none of
 * which lead to the merge - so the surface for finishing the merge was unreachable exactly when
 * there was a merge to finish. Reopening mid-merge is the case `readMergeState` was built for.
 *
 * Two things happen here, and they happen HERE because this is the last point before
 * `Service.initializeAll` - i.e. before anything has parsed a document or run a migration:
 *
 *  - the conflicted paths are read as the author's own side, so every document parses;
 *  - project data is FROZEN, because what the editors then hold is not what is on disk. A migration
 *    normalising a document, or one auto-save, would write pre-merge content over the merge's own
 *    result. The freeze is armed before the first read for the same reason `showRevision` arms it
 *    before the first read: afterwards is one timer too late.
 *
 * **Only when the merge actually left conflicts.** An automerge that settled everything leaves
 * nothing unparseable, and its result on disk is what the closing commit will record - freezing that
 * would take the project away from an author who has nothing to decide.
 *
 * **Never fatal.** Version control is optional (no native build on some hosts) and this runs on
 * every project open, so a backend that is absent, a repository that is not there, or a call that
 * fails all mean the same thing: open the project the ordinary way. A genuinely corrupt document in
 * a project with no merge therefore still fails exactly as it did before, which is the point - the
 * tolerance is scoped to paths a merge has named, and to nothing else.
 */
async function prepareForOpenMerge(projectPath: string): Promise<void> {
  // Anything left by a previous project in this window, and the default for every project that is
  // not mid-merge. Cleared first so an early return cannot leave one project's substitution
  // standing over another's files.
  clearMergeConflictReads();
  try {
    const availability = await getInterface().vcs.getAvailability();
    if (!availability.success || !availability.data.available) {
      return;
    }
    const state = await getInterface().vcs.getMergeState(projectPath);
    if (!state.success || !state.data.inProgress || state.data.conflicts.length === 0) {
      return;
    }
    setMergeConflictReads(projectPath, state.data.conflicts);
    freezeProjectWrites({ projectPath, reason: { kind: "merge" } });
  } catch {
    // See the note above: opening a project must not depend on version control answering.
    clearMergeConflictReads();
  }
}

export async function ensureWorkspaceProjectCanStart(projectPath: string): Promise<void> {
  const entries = throwException(await BaseFileSystemService.list(projectPath));
  const dirEntries = entries.map<DirEntry>((entry) => ({
    name: entry.name,
    ext: entry.ext,
    type: entry.type
  }));

  if (findNlprojConfigFileName(dirEntries)) {
    // After the folder is known to be a project and before any service reads a document.
    await prepareForOpenMerge(projectPath);
    return;
  }

  const issue = getWorkspaceProjectPreflightIssue(dirEntries);
  if (!issue) {
    return;
  }

  throw new WorkspaceStartupError(
    issue.kind,
    projectPath,
    "Selected folder is not a NarraLeaf project."
  );
}
