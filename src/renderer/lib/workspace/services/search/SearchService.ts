import { Service } from "../Service";
import type { WorkspaceContext } from "../services";
import {
    indexEntries,
    querySearchIndex,
    type IndexedSearchEntry,
    type SearchGroupResult,
    type SearchIndexEntry,
    type SearchQueryOptions,
} from "./searchIndexModel";
import { dedupSearchEntries, type SearchInvalidation, type SearchSource } from "./searchSource";
import { SEARCH_SOURCES } from "./searchSources";

const REBUILD_DEBOUNCE_MS = 300;

/** A source, plus the slices it currently has and the subscription keeping them fresh. */
type SourceState = {
    source: SearchSource<any>;
    /** Ordered slice keys. Exactly one, with `key: undefined`, for an unpartitioned source. */
    slices: Array<{ sliceKey: string; key: unknown }>;
    unsubscribe: (() => void) | null;
};

function sliceKeyOf(source: SearchSource<any>, key: unknown): string {
    return `${source.id}#${String(key)}`;
}

/** Debounce/generation key for "the whole source", distinct from any of its slice keys. */
function sourceGuardKey(source: SearchSource<any>): string {
    return `${source.id}#*`;
}

/**
 * The search index, as machinery: slices, debouncing, folding, dedup, invalidation and querying,
 * with no knowledge of what any of it contains.
 *
 * Split out of {@link SearchService} so it can be driven with fake sources in a test - which is the
 * executable form of the whole point of the refactor: if a made-up source becomes searchable with no
 * change to this class, then a real one will too.
 *
 * Storage is deliberately asymmetric, because dedup and partitioning pull in opposite directions:
 *
 *  - a source **without** `dedupKey` keeps query-ready entries per slice, so a keystroke in one story
 *    re-folds that story and nothing else;
 *  - a source **with** `dedupKey` keeps raw entries per slice and one folded array for the source,
 *    because identity is judged across the whole source and a slice cannot be folded until its
 *    duplicates elsewhere are known.
 *
 * Both branches meet in {@link getFlatEntries}, which is the only thing the query path sees.
 */
export class SearchIndexEngine {
    private readonly states: SourceState[];

    /** Raw slice entries. Populated only for sources whose dedup pass spans slices. */
    private readonly rawSlices = new Map<string, SearchIndexEntry[]>();
    /** Query-ready entries per unit: one slice, or one whole source when the source dedups. */
    private readonly units = new Map<string, IndexedSearchEntry[]>();

    /**
     * All units concatenated, rebuilt lazily on first query after anything changes.
     *
     * Without this the concatenation ran per query - i.e. per keystroke - allocating a fresh array
     * of the entire index each time. Invalidation hangs off {@link emitChanged}, which every mutation
     * path already ends with (it is the same invariant the change listeners depend on).
     */
    private flatCache: IndexedSearchEntry[] | null = null;

    private readyPromise: Promise<void> | null = null;
    private started = false;
    private disposed = false;
    private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
    /**
     * Per-key rebuild generation. A rebuild that awaits (story documents load lazily) can be overtaken
     * by a newer invalidation of the same key; the stale one then wrote its older entries over the
     * newer ones. Bumping on start and re-checking after every await is what drops the loser.
     */
    private readonly generations = new Map<string, number>();
    private readonly changeListeners = new Set<() => void>();

    constructor(
        private readonly ctx: WorkspaceContext,
        sources: readonly SearchSource<any>[],
    ) {
        this.states = sources.map(source => ({ source, slices: [], unsubscribe: null }));
    }

    /**
     * Build every source once and attach the incremental subscriptions. Subsequent calls await the
     * same build.
     */
    public ensureReady(): Promise<void> {
        if (!this.readyPromise) {
            this.readyPromise = this.buildAll().catch(error => {
                // A failed build must not poison future attempts (e.g. a story library that would not read).
                this.readyPromise = null;
                throw error;
            });
        }
        return this.readyPromise;
    }

    /** True once the initial full build has completed and the sources are being watched. */
    public isReady(): boolean {
        return this.readyPromise !== null && this.started;
    }

    /** Query the current index. Empty query → empty result. Call {@link ensureReady} first. */
    public search(query: string, options?: SearchQueryOptions): SearchGroupResult[] {
        return querySearchIndex(this.getFlatEntries(), query, options);
    }

    /** Number of indexed entries (diagnostics, and "searching N items" UI states). */
    public size(): number {
        return this.getFlatEntries().length;
    }

    /**
     * Every indexed entry, uncapped and unranked.
     *
     * For the one caller {@link search} cannot serve: project replace has to plan over *all* the
     * blocks a query reaches, and `search` caps every group (20, or 500 expanded) because it feeds a
     * list that renders eagerly. A button that said "Replace all 20" over a query matching 340 lines
     * would be a number the author acts on and it would be wrong.
     *
     * The array is the engine's own; treat it as read-only.
     */
    public listEntries(): readonly IndexedSearchEntry[] {
        return this.getFlatEntries();
    }

    /** Notifies whenever any slice rebuilds (so open result lists can refresh). */
    public onIndexChanged(listener: () => void): () => void {
        this.changeListeners.add(listener);
        return () => {
            this.changeListeners.delete(listener);
        };
    }

    public dispose(): void {
        this.disposed = true;
        for (const state of this.states) {
            state.unsubscribe?.();
            state.unsubscribe = null;
            state.slices = [];
        }
        for (const timer of this.timers.values()) {
            clearTimeout(timer);
        }
        this.timers.clear();
        this.generations.clear();
        this.rawSlices.clear();
        this.units.clear();
        this.flatCache = null;
        this.readyPromise = null;
        this.started = false;
        this.changeListeners.clear();
    }

    // ---------------------------------------------------------------------
    // Build + incremental rebuilds
    // ---------------------------------------------------------------------

    private async buildAll(): Promise<void> {
        // In parallel: the slowest source (stories, one file each) should not be waiting on the
        // localization key document, and neither has anything to say to the other.
        await Promise.all(this.states.map(state => this.syncSource(state, false)));
        if (this.disposed) {
            return;
        }
        for (const state of this.states) {
            this.watchSource(state);
        }
        this.started = true;
        this.emitChanged();
    }

    /**
     * Re-partition a source and rebuild every slice it now has, dropping the ones it no longer does.
     *
     * A `partition` that throws propagates: a source that cannot say what it contains has not produced
     * an empty index, it has produced no answer, and the retry belongs to {@link ensureReady}. An
     * `extract` that throws is isolated per slice - see {@link extractSlice}.
     */
    private async syncSource(state: SourceState, emit: boolean): Promise<void> {
        const guardKey = sourceGuardKey(state.source);
        const generation = this.nextGeneration(guardKey);

        const keys = state.source.partition ? [...(await state.source.partition(this.ctx))] : [undefined];
        if (!this.isCurrent(guardKey, generation)) {
            return;
        }

        const slices = keys.map(key => ({ sliceKey: sliceKeyOf(state.source, key), key }));
        const live = new Set(slices.map(slice => slice.sliceKey));
        for (const { sliceKey } of state.slices) {
            if (!live.has(sliceKey)) {
                this.forgetSlice(sliceKey);
            }
        }
        state.slices = slices;

        // Every generation is bumped synchronously here, before any extraction resolves, so a slice
        // rebuild scheduled after this call still wins.
        const pending = slices.map(slice => ({
            slice,
            generation: this.nextGeneration(slice.sliceKey),
            entries: this.extractSlice(state, slice.key, slice.sliceKey),
        }));
        const extracted = await Promise.all(
            pending.map(async item => ({ ...item, entries: await item.entries })),
        );
        if (!this.isCurrent(guardKey, generation)) {
            return;
        }
        for (const item of extracted) {
            if (this.isCurrent(item.slice.sliceKey, item.generation)) {
                this.store(state, item.slice.sliceKey, item.entries);
            }
        }
        this.recomputeDedup(state);
        if (emit) {
            this.emitChanged();
        }
    }

    /** Rebuild exactly one slice of one source. */
    private async rebuildSlice(state: SourceState, key: unknown): Promise<void> {
        const sliceKey = sliceKeyOf(state.source, key);
        const generation = this.nextGeneration(sliceKey);
        const entries = await this.extractSlice(state, key, sliceKey);
        if (!this.isCurrent(sliceKey, generation)) {
            return;
        }
        if (!state.slices.some(slice => slice.sliceKey === sliceKey)) {
            // A slice the last partition had not seen - a story created a moment ago. The library
            // event that follows will confirm it; showing it now costs nothing.
            state.slices.push({ sliceKey, key });
        }
        this.store(state, sliceKey, entries);
        this.recomputeDedup(state);
        this.emitChanged();
    }

    /** One slice's entries. A throwing source logs and yields nothing, taking nothing else with it. */
    private async extractSlice(state: SourceState, key: unknown, sliceKey: string): Promise<SearchIndexEntry[]> {
        try {
            return await state.source.extract(this.ctx, key);
        } catch (error) {
            console.warn(`[SearchService] Failed to index ${sliceKey}:`, error);
            return [];
        }
    }

    private store(state: SourceState, sliceKey: string, entries: SearchIndexEntry[]): void {
        if (state.source.dedupKey) {
            this.rawSlices.set(sliceKey, entries);
        } else {
            this.units.set(sliceKey, indexEntries(entries));
        }
    }

    /** Collapse and fold a dedup source's slices into its single query-ready unit. A no-op otherwise. */
    private recomputeDedup(state: SourceState): void {
        const dedupKey = state.source.dedupKey;
        if (!dedupKey) {
            return;
        }
        const raw: SearchIndexEntry[] = [];
        for (const { sliceKey } of state.slices) {
            const slice = this.rawSlices.get(sliceKey);
            if (slice) {
                raw.push(...slice);
            }
        }
        this.units.set(state.source.id, indexEntries(dedupSearchEntries(raw, dedupKey)));
    }

    private forgetSlice(sliceKey: string): void {
        this.rawSlices.delete(sliceKey);
        this.units.delete(sliceKey);
        this.generations.delete(sliceKey);
        const timer = this.timers.get(sliceKey);
        if (timer) {
            clearTimeout(timer);
            this.timers.delete(sliceKey);
        }
    }

    private watchSource(state: SourceState): void {
        if (state.unsubscribe) {
            return;
        }
        const signal: SearchInvalidation<any> = {
            invalidate: key => {
                const sliceKey = sliceKeyOf(state.source, key);
                this.schedule(sliceKey, () => {
                    void this.rebuildSlice(state, key).catch(error => {
                        console.warn(`[SearchService] Failed to rebuild ${sliceKey}:`, error);
                    });
                });
            },
            invalidateAll: () => {
                this.schedule(sourceGuardKey(state.source), () => {
                    void this.syncSource(state, true).catch(error => {
                        console.warn(`[SearchService] Failed to rebuild ${state.source.id}:`, error);
                    });
                });
            },
        };
        state.unsubscribe = state.source.watch(this.ctx, signal);
    }

    /**
     * Coalesce rebuilds of one key. Change events fire per keystroke during editing, and a rebuild is
     * a full re-extraction of its slice (cheap at VN scale, but not per-keystroke cheap).
     */
    private schedule(key: string, action: () => void): void {
        if (this.disposed) {
            return;
        }
        const existing = this.timers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.timers.set(
            key,
            setTimeout(() => {
                this.timers.delete(key);
                action();
            }, REBUILD_DEBOUNCE_MS),
        );
    }

    private nextGeneration(key: string): number {
        const next = (this.generations.get(key) ?? 0) + 1;
        this.generations.set(key, next);
        return next;
    }

    private isCurrent(key: string, generation: number): boolean {
        return !this.disposed && this.generations.get(key) === generation;
    }

    private getFlatEntries(): IndexedSearchEntry[] {
        if (!this.flatCache) {
            const entries: IndexedSearchEntry[] = [];
            for (const state of this.states) {
                if (state.source.dedupKey) {
                    const unit = this.units.get(state.source.id);
                    if (unit) {
                        entries.push(...unit);
                    }
                    continue;
                }
                for (const { sliceKey } of state.slices) {
                    const unit = this.units.get(sliceKey);
                    if (unit) {
                        entries.push(...unit);
                    }
                }
            }
            this.flatCache = entries;
        }
        return this.flatCache;
    }

    /**
     * Announce a rebuild. Every mutation path ends here, so this is also where the concatenated view
     * is dropped - see {@link flatCache}.
     */
    private emitChanged(): void {
        this.flatCache = null;
        for (const listener of this.changeListeners) {
            listener();
        }
    }
}

/**
 * Search Service - the global project search index.
 *
 * Renderer-side by design: every searchable document (story documents, the blueprint document,
 * the named-key registry) already lives in this process's services, complete with change events,
 * so the index reads them directly and always reflects *unsaved* editing state. A main-process
 * index would only ever see what the debounced savers last flushed to disk.
 *
 * What is searchable is not decided here. Each kind of thing declares itself as a
 * {@link SearchSource} under `sources/`, and `searchSources.ts` lists them; this class is the
 * machinery that partitions, extracts, debounces, folds, dedups and queries, and it names none of
 * them. That is the whole shape of the file: adding a searchable kind must not be an edit to the
 * search service.
 *
 * The full build is lazy: {@link ensureReady} loads every story document once on first use, so
 * project startup does not pay for search nobody has opened yet.
 */
export class SearchService extends Service<SearchService> {
    private engine: SearchIndexEngine | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        // The sources say which services they read; this class does not import a single one of them.
        const dependencies = [...new Set(SEARCH_SOURCES.flatMap(source => source.dependsOn ?? []))];
        await depend(dependencies.map(id => ctx.services.get<Service>(id)));
        this.engine = new SearchIndexEngine(ctx, SEARCH_SOURCES);
    }

    /**
     * Build the full index once (loading every story document) and attach the incremental
     * subscriptions. Subsequent calls await the same build. Safe to call eagerly from UI mounts.
     */
    public ensureReady(): Promise<void> {
        if (!this.engine) {
            return Promise.reject(new Error("Search index used before the service was initialized"));
        }
        return this.engine.ensureReady();
    }

    /** True once the initial full build has completed (used for "building…" UI states). */
    public isReady(): boolean {
        return this.engine?.isReady() ?? false;
    }

    /** Query the current index. Empty query → empty result. Call {@link ensureReady} first. */
    public search(query: string, options?: SearchQueryOptions): SearchGroupResult[] {
        return this.engine?.search(query, options) ?? [];
    }

    /** Number of indexed entries (diagnostics, and "searching N items" UI states). */
    public size(): number {
        return this.engine?.size() ?? 0;
    }

    /** Every indexed entry, uncapped - see {@link SearchIndexEngine.listEntries}. */
    public listEntries(): readonly IndexedSearchEntry[] {
        return this.engine?.listEntries() ?? [];
    }

    /** Notifies whenever any slice rebuilds (so open result lists can refresh). */
    public onIndexChanged(listener: () => void): () => void {
        return this.engine?.onIndexChanged(listener) ?? (() => {});
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.engine?.dispose();
        this.engine = null;
    }
}
