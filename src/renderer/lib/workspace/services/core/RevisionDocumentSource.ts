import type { DocumentOrigin, DocumentSource } from "@shared/documents/documentSource";
import { normalizeDocumentPath } from "@shared/documents/documentPath";
import type { RevisionId } from "@shared/types/vcs";

/**
 * A revision's documents, batched.
 *
 * `null` for a path means the revision does not contain it. Anything that went wrong
 * throws - see {@link DocumentSource.read} for why the two must not be collapsed.
 */
export interface RevisionDocumentReader {
  readRevisionDocuments(
    revision: RevisionId,
    paths?: readonly string[]
  ): Promise<Map<string, string | null>>;
}

/**
 * Paths whose absence a whole-revision prewarm can be trusted on.
 *
 * The prewarm reads every document at the revision, and "every document" has to mean
 * something: the tree also holds the author's assets, and base64ing 400MB of art across
 * IPC to answer "what did this scene look like?" is not a trade worth making. So it asks
 * for the JSON, and a JSON path the prewarm did not return is genuinely absent. Anything
 * else falls back to a targeted read rather than being reported missing on the strength
 * of a filter it was never covered by.
 */
const PREWARM_COVERS = (path: string): boolean => path.toLowerCase().endsWith(".json");

/**
 * One past revision, as a source the editors read through.
 *
 * Caching is not an optimisation here, it is what makes the reload affordable: the first
 * read of a revision on a project with a remote fetches fragments over the network
 * (docs/version-control.md §6), and nine document services plus every editor tab that
 * remounts afterwards would each pay that. So {@link prewarm} reads the revision's
 * documents in ONE round trip and everything after it is a map lookup.
 *
 * Immutable by nature, which is what makes the cache safe to hold for as long as the
 * author is looking at the revision: a revision cannot change under it. The instance is
 * discarded when they leave.
 */
export class RevisionDocumentSource implements DocumentSource {
  public readonly origin: DocumentOrigin;
  private readonly cache = new Map<string, string | null>();
  /** In flight or done, so two callers cannot both start the network read. */
  private prewarming: Promise<void> | null = null;
  private prewarmedAll = false;

  public constructor(
    private readonly revision: RevisionId,
    private readonly reader: RevisionDocumentReader,
    private readonly covers: (path: string) => boolean = PREWARM_COVERS
  ) {
    this.origin = { kind: "revision", revision };
  }

  public async read(path: string): Promise<string | null> {
    const key = normalizeDocumentPath(path);
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    if (this.prewarmedAll && this.covers(key)) {
      // The prewarm enumerated the revision's tree, so a document it did not report
      // is absent there. Confirming that with a round trip would mean a tree walk per
      // document added since the revision - and every project has some.
      return null;
    }
    const read = await this.reader.readRevisionDocuments(this.revision, [key]);
    const text = read.get(key) ?? null;
    this.cache.set(key, text);
    return text;
  }

  /**
   * With no `paths`, read every document at the revision in one call, and remember that
   * the answer was exhaustive. With `paths`, read the ones not already held.
   */
  public async prewarm(paths?: readonly string[]): Promise<void> {
    if (paths) {
      const missing = paths.map(normalizeDocumentPath).filter((path) => !this.cache.has(path));
      if (missing.length === 0) {
        return;
      }
      this.absorb(await this.reader.readRevisionDocuments(this.revision, missing), missing);
      return;
    }
    if (this.prewarmedAll) {
      return;
    }
    // Shared rather than guarded by a boolean: two callers arriving together (the view
    // and the reload it starts) must not both go to the network, and the second wants
    // the answer the first is already waiting for.
    this.prewarming ??= this.readEverything();
    try {
      await this.prewarming;
    } finally {
      // Cleared on the settled view, so a failed prewarm is retried rather than
      // remembered as the answer for the rest of the view.
      this.prewarming = null;
    }
  }

  private async readEverything(): Promise<void> {
    const read = await this.reader.readRevisionDocuments(this.revision);
    this.absorb(read, []);
    this.prewarmedAll = true;
  }

  /**
   * Take a batch into the cache, including the negatives: a path that was asked for and
   * came back absent is an answer worth keeping, or every service that reads a document
   * added after this revision re-asks the backend for it.
   */
  private absorb(read: Map<string, string | null>, requested: readonly string[]): void {
    for (const [path, text] of read) {
      this.cache.set(normalizeDocumentPath(path), text);
    }
    for (const path of requested) {
      if (!this.cache.has(path)) {
        this.cache.set(path, null);
      }
    }
  }
}
