import type { DocumentSource } from "@shared/documents/documentSource";
import { versionedProjectRelativePath } from "./writeFreeze";

/**
 * The latch that decides WHICH VERSION of the project the renderer reads.
 *
 * The mirror image of `writeFreeze`, and here for the same reason. That module's argument
 * is written out in full there: the workspace has ~24 modules, four dock regions, a
 * command palette and global keybindings, so a guarantee of the form "every reader
 * remembers to consult a flag" is a guarantee that one of them does not. On the write
 * side the cost of a miss is data loss; on the read side it is an editor showing TODAY's
 * bytes inside a view labelled as a past revision - the author reading history that is
 * partly not history, with nothing to tell them which parts.
 *
 * Two things made a per-service parameter insufficient rather than merely verbose:
 *
 *  - **Documents load lazily, long after the reload.** `StoryService.loadStory` reads a
 *    story document the first time a tab asks for it. A source threaded through the
 *    reload would cover the stories that happened to be open and silently serve the
 *    working tree for every one opened afterwards.
 *  - **Nine services, three of them on the shared `DocumentStorage` port and six
 *    reaching `FileSystemService` directly.** One seam exists already; six more would
 *    have had to be invented, and each is a place to forget.
 *
 * So the gate is here, at the read boundary (`BaseFileSystemService`), keyed by the same
 * `isVersioned` predicate the freeze uses. `.nlstudio/` (panel layout, plugins,
 * quarantine), `editor/cache/` and `dist/` therefore keep reading the disk while a
 * revision is shown - which is the point: the editor's own state is not the author's
 * project, and a version view whose panel layout came out of a revision would look
 * broken.
 *
 * **Text only, and never binary.** `readRaw` is deliberately not redirected: a source
 * answers strings, and the paths that go through `readRaw` are the author's assets -
 * megabytes of art that would have to cross IPC base64-encoded to redraw a thumbnail.
 * A revision view therefore shows historical DOCUMENTS with today's asset bytes, which
 * is a known and stated limit rather than an oversight.
 *
 * **Module-level and never persisted**, exactly like the freeze latch: the read paths it
 * guards are static and reached from entry points that have no workspace, and a source
 * that survived a reload would be a project quietly showing an old version with no
 * visible cause.
 */

type ActiveSource = { projectPath: string; source: DocumentSource; depth: number };

let active: ActiveSource | null = null;

/**
 * Read project data from `source` instead of from disk, until the returned release.
 *
 * Re-entrant on the same source, because two callers legitimately want it at once: a
 * revision view holds one for as long as the author is looking at the revision, and the
 * reload it starts holds one for the duration of its pass. Only the last release lifts
 * it.
 *
 * A working-tree source is accepted and installs NOTHING. That is not a special case for
 * tidiness: the working tree's implementation of "read this path" is the very filesystem
 * service that consults this latch, so installing it would make every read recurse until
 * the stack ran out.
 */
export function pushProjectDocumentSource(projectPath: string, source: DocumentSource): () => void {
  if (source.origin.kind === "working-tree") {
    return () => undefined;
  }
  if (active && active.projectPath === projectPath && active.source === source) {
    active.depth += 1;
  } else {
    // A window is one project (see the multi-project window model), so a source naming
    // a different project is one left behind by a project that has already closed.
    active = { projectPath, source, depth: 1 };
  }
  let released = false;
  return () => {
    if (released || !active) {
      return;
    }
    released = true;
    active.depth -= 1;
    if (active.depth <= 0) {
      active = null;
    }
  };
}

/** Read project data from disk again, whatever depth the source was held at. */
export function clearProjectDocumentSource(): void {
  active = null;
}

/**
 * The source the renderer is reading project data from, or null when it reads the disk.
 *
 * Exposed so a caller can ask WHICH version is on screen - the version rail's label, and
 * the reload's console line - not so a reader can decide for itself whether to consult
 * it. Readers go through {@link readProjectDataFromSource}.
 */
export function getProjectDocumentSource(): DocumentSource | null {
  return active?.source ?? null;
}

/**
 * The gate. Answers `{text}` when `absolutePath` is versioned project data that a source
 * is standing in for - `text: null` meaning "not present at that version" - and `null`
 * when the caller should read the disk as usual.
 *
 * A source that throws is not caught here. A repository that cannot be reached must not
 * look like a project full of missing files: the load path's own error handling is what
 * turns it into a named failure the author can see (`WorkspaceReloadService` collects it
 * per participant), and swallowing it would hand every service a default document.
 */
export async function readProjectDataFromSource(
  absolutePath: string
): Promise<{ text: string | null } | null> {
  const current = active;
  if (!current) {
    return null;
  }
  const relative = versionedProjectRelativePath(current.projectPath, absolutePath);
  if (relative === null) {
    return null;
  }
  return { text: await current.source.read(relative) };
}
