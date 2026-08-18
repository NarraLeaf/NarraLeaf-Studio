import type { DocumentStorage } from "./documentIo";
import { normalizeDocumentPath } from "./documentPath";

/**
 * Where the documents the editors are showing come from.
 *
 * The workspace is a view of ONE version of the project: normally the working tree, and
 * while the author is browsing history, a revision. Everything downstream - the eight
 * document services, their migrations, their "this file does not exist yet" branches -
 * is the same code either way. That is the whole reason history can be rendered by the
 * real editors instead of by eight bespoke diff views, and
 * it only holds if there is exactly one seam between "read a document" and "read a
 * file". This is that seam.
 *
 * Read-only by construction. {@link DocumentStorage} is the read/write port a service
 * uses to own its own file; a source answers "what did this path contain at this
 * version", and a revision has no answer to `write` that is not a lie. Writes while a
 * revision is shown are refused at the write boundary (`@/lib/app/writeFreeze`), not
 * here - see that module for why the guarantee cannot live in the callers.
 */

/** Which version of the project a {@link DocumentSource} answers for. */
export type DocumentOrigin =
  /** The files on disk. What every caller means unless it says otherwise. */
  | { readonly kind: "working-tree" }
  /** A past revision, read out of the repository. `revision` is a revision id. */
  | { readonly kind: "revision"; readonly revision: string };

export interface DocumentSource {
  readonly origin: DocumentOrigin;

  /**
   * The document's text at this source, or `null` when it does not exist there.
   *
   * `null` is an ANSWER. A document added after the revision being shown, a locale
   * whose file was never created - both have to reach the service's "missing, use
   * defaults" branch, the same one project open uses. Anything else - a repository
   * that cannot be reached, a store that will not open - throws, because handing back
   * an empty document for those is how an author's file gets replaced by a default.
   */
  read(path: string): Promise<string | null>;

  /**
   * Fetch what is about to be read, in as few round trips as the source can manage.
   *
   * Not an optimisation to be skipped: the first read of a revision on a project with
   * a remote goes to the network (docs/version-control.md §6), and nine document
   * services reading one path at a time would pay that latency nine times over while
   * the workspace sits empty. Awaitable so a caller can show progress.
   *
   * With no `paths`, the source prewarms whatever it considers its documents. A source
   * that cannot batch may do nothing at all - it is a hint, and correctness never
   * depends on it having run.
   */
  prewarm(paths?: readonly string[]): Promise<void>;
}

/**
 * The working tree as a source, over any {@link DocumentStorage}.
 *
 * A thin adapter rather than a class of its own because the working tree already has an
 * implementation of "read this project-relative path" per process - the renderer's
 * `RendererDocumentStorage` and the main process's `documentStorage` - and a second one
 * would be a second answer to what a project path resolves to.
 */
export function createWorkingTreeDocumentSource(storage: DocumentStorage): DocumentSource {
  return {
    origin: { kind: "working-tree" },
    read: (path) => storage.read(normalizeDocumentPath(path)),
    // The disk is already local. Prewarming would read every document twice.
    prewarm: async () => undefined
  };
}

/**
 * A source backed by an in-memory map, for tests and for a source that has already read
 * everything it is going to.
 *
 * Keys are normalised on the way in, so a caller may seed with either separator.
 */
export function createMapDocumentSource(
  origin: DocumentOrigin,
  documents: Iterable<readonly [string, string | null]>
): DocumentSource {
  const byPath = new Map<string, string | null>();
  for (const [path, text] of documents) {
    byPath.set(normalizeDocumentPath(path), text);
  }
  return {
    origin,
    read: async (path) => byPath.get(normalizeDocumentPath(path)) ?? null,
    prewarm: async () => undefined
  };
}
