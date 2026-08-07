import type { Services, WorkspaceContext } from "../services";
import type { SearchGroup, SearchIndexEntry } from "./searchIndexModel";

/**
 * The contract between the search index and "a kind of thing that can be found".
 *
 * The point of this file is a single acceptance criterion: **making a new kind of thing searchable
 * must be one new descriptor file plus one line in `searchSources.ts`.** Before it, the six kinds
 * were six private fields on `SearchService`, and each of them was spelled out seven times over -
 * a field, a branch of the full build, a subscription, a `rebuildXSlice` method, a term of the flat
 * concatenation, a reset in `dispose`, and the extractor. A descriptor answers all seven in one
 * place, so `SearchService` can stop knowing what a story or an asset is.
 *
 * A source answers four questions, and the service answers everything else (debouncing, ordering,
 * folding, error isolation, cache invalidation):
 *
 *  - what does it split into? (`partition`, omitted for a source that is one slice)
 *  - what is in one slice? (`extract`)
 *  - when does a slice go stale? (`watch`)
 *  - which of its entries are indistinguishable? (`dedupKey`, omitted when none ever are)
 */
export interface SearchInvalidation<K = void> {
    /**
     * Rebuild one slice. The debounce is per slice, so a burst of edits to one story never delays
     * the rebuild of another.
     */
    invalidate(key: K): void;
    /**
     * Re-partition and rebuild the whole source. This is the event for "the set of slices changed" -
     * and also for "something outside a slice changed the content of every slice", which is why a
     * story *rename* uses it: the story name is baked into the context line of every entry in it.
     */
    invalidateAll(): void;
}

export interface SearchSource<K = void> {
    /** Stable id. Also the slice key prefix and the rebuild-debounce key. */
    id: string;
    /**
     * Result groups this source can produce. Declared rather than derived because it is the answer to
     * "who produces `variable` entries?" without reading six extractors - `variable` comes from two
     * sources, and that is exactly the sort of fact a per-source field makes checkable.
     */
    groups: readonly SearchGroup[];
    /**
     * Workspace services this source reads, so `SearchService` can order initialization without
     * importing a single one of them. Without this the service would be back to naming eight concrete
     * service classes, which is the dependency the refactor exists to remove.
     */
    dependsOn?: readonly Services[];
    /**
     * Partitioned sources produce one slice per key (stories: one slice per story id).
     * Omit for a single-slice source.
     *
     * A throw here fails the build (and `ensureReady` will retry on the next call), because a source
     * that cannot say what it contains has not produced an empty index - it has produced no answer.
     */
    partition?: (ctx: WorkspaceContext) => readonly K[] | Promise<readonly K[]>;
    /**
     * Entries for one slice. May be async (story documents load lazily).
     *
     * A throw here is isolated: it logs and yields an empty slice. One unreadable story, or a UI
     * document nobody has built yet, must not take the rest of the index with it.
     */
    extract: (ctx: WorkspaceContext, key: K) => SearchIndexEntry[] | Promise<SearchIndexEntry[]>;
    /**
     * Attach change subscriptions. Return an unsubscribe.
     * `invalidate(key)` rebuilds one slice; `invalidateAll()` re-partitions and rebuilds the source.
     */
    watch: (ctx: WorkspaceContext, signal: SearchInvalidation<K>) => () => void;
    /**
     * Collapse indistinguishable entries into one carrying `count`. Return null for an entry that
     * must never be collapsed. Omit the function entirely when a source never dedups.
     *
     * Applied across the **whole source**, not per slice. Per-slice would be the wrong seam and was
     * the original bug's shape: sibling event layers are commonly all named "Layer 1" and sibling
     * widgets all named "Image", so anything narrower than the source still lets rows through that
     * are identical on screen. Two rows survive as two exactly when a person could tell them apart.
     */
    dedupKey?: (entry: SearchIndexEntry) => string | null;
}

/**
 * Collapse entries that a source declares indistinguishable, in place.
 *
 * Three properties the callers depend on:
 *
 *  - **order preserving** - a survivor keeps the position of the *first* of its duplicates, and
 *    entries that never collide keep their relative order untouched. Group ranking is stable-sorted,
 *    so entry order is what breaks score ties, and a reordering here would silently re-rank results.
 *  - **first wins** - the survivor keeps the first entry's `id` and `target`. The jump goes to the
 *    first of the collapsed things, which is all a picker could have offered anyway.
 *  - **no mutation** - a survivor that collects a count is replaced by a copy, so an extractor's
 *    output array is never written through.
 */
export function dedupSearchEntries(
    entries: readonly SearchIndexEntry[],
    dedupKey: (entry: SearchIndexEntry) => string | null,
): SearchIndexEntry[] {
    const out: SearchIndexEntry[] = [];
    const positionByKey = new Map<string, number>();
    for (const entry of entries) {
        const key = dedupKey(entry);
        if (key === null) {
            out.push(entry);
            continue;
        }
        const position = positionByKey.get(key);
        if (position === undefined) {
            positionByKey.set(key, out.length);
            out.push(entry);
            continue;
        }
        const survivor = out[position];
        out[position] = { ...survivor, count: (survivor.count ?? 1) + 1 };
    }
    return out;
}
