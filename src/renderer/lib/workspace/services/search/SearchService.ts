import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { StoryService } from "../story/StoryService";
import { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { BlueprintNodeCatalogService } from "../ui-editor/BlueprintNodeCatalogService";
import { LocalizationService } from "../localization/LocalizationService";
import { AssetsService } from "../core/AssetsService";
import {
    extractAssetEntries,
    extractBlueprintEntries,
    extractLocalizationKeyEntries,
    extractStoryEntries,
    querySearchIndex,
    type SearchGroupResult,
    type SearchIndexEntry,
} from "./searchIndexModel";

const REBUILD_DEBOUNCE_MS = 300;

/**
 * Search Service — the global project search index.
 *
 * Renderer-side by design: every searchable document (story documents, the blueprint document,
 * the named-key registry) already lives in this process's services, complete with change events,
 * so the index reads them directly and always reflects *unsaved* editing state. A main-process
 * index would only ever see what the debounced savers last flushed to disk.
 *
 * The index is three slices, each rebuilt independently from its own change event:
 *  - story slice (per story): `StoryService.onDocumentChanged` / `onLibraryChanged`
 *  - blueprint slice: `UIGraphService.onGraphsChanged` (the blueprint document lives inside the
 *    graph document, so its mutations surface there)
 *  - named-key slice: `LocalizationService.onKeysChanged`
 *
 * Rebuilds are debounced per slice — change events fire per keystroke during editing, and a slice
 * rebuild is a full re-extraction (cheap at VN scale, but not per-keystroke cheap).
 *
 * The full build is lazy: {@link ensureReady} loads every story document once on first use, so
 * project startup does not pay for search nobody has opened yet.
 */
export class SearchService extends Service<SearchService> {
    private storyEntries = new Map<string, SearchIndexEntry[]>();
    private blueprintEntries: SearchIndexEntry[] = [];
    private keyEntries: SearchIndexEntry[] = [];
    private assetEntries: SearchIndexEntry[] = [];

    private readyPromise: Promise<void> | null = null;
    private unsubs: Array<() => void> = [];
    private rebuildTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly changeListeners = new Set<() => void>();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        await depend([
            ctx.services.get<StoryService>(Services.Story),
            ctx.services.get<UIGraphService>(Services.UIGraph),
            ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint),
            ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog),
            ctx.services.get<LocalizationService>(Services.Localization),
            ctx.services.get<AssetsService>(Services.Assets),
        ]);
    }

    /**
     * Build the full index once (loading every story document) and attach the incremental
     * subscriptions. Subsequent calls await the same build. Safe to call eagerly from UI mounts.
     */
    public ensureReady(): Promise<void> {
        if (!this.readyPromise) {
            this.readyPromise = this.buildAll().catch(error => {
                // A failed build must not poison future attempts (e.g. one unreadable story file).
                this.readyPromise = null;
                throw error;
            });
        }
        return this.readyPromise;
    }

    /** True once the initial full build has been kicked off (used for "building…" UI states). */
    public isReady(): boolean {
        return this.readyPromise !== null && this.unsubs.length > 0;
    }

    /** Query the current index. Empty query → empty result. Call {@link ensureReady} first. */
    public search(query: string, options?: { maxPerGroup?: number }): SearchGroupResult[] {
        const entries: SearchIndexEntry[] = [];
        for (const slice of this.storyEntries.values()) {
            entries.push(...slice);
        }
        entries.push(...this.blueprintEntries, ...this.keyEntries, ...this.assetEntries);
        return querySearchIndex(entries, query, options);
    }

    /** Notifies whenever any slice rebuilds (so open result lists can refresh). */
    public onIndexChanged(listener: () => void): () => void {
        this.changeListeners.add(listener);
        return () => {
            this.changeListeners.delete(listener);
        };
    }

    public override dispose(_ctx: WorkspaceContext): void {
        for (const unsub of this.unsubs) {
            unsub();
        }
        this.unsubs = [];
        for (const timer of this.rebuildTimers.values()) {
            clearTimeout(timer);
        }
        this.rebuildTimers.clear();
        this.storyEntries.clear();
        this.blueprintEntries = [];
        this.keyEntries = [];
        this.assetEntries = [];
        this.readyPromise = null;
        this.changeListeners.clear();
    }

    // ---------------------------------------------------------------------
    // Build + incremental rebuilds
    // ---------------------------------------------------------------------

    private async buildAll(): Promise<void> {
        const ctx = this.getContext();
        const storyService = ctx.services.get<StoryService>(Services.Story);
        const localizationService = ctx.services.get<LocalizationService>(Services.Localization);

        // Stories load lazily elsewhere; search needs all of them once.
        await storyService.loadLibrary();
        const entries = storyService.listStories();
        await Promise.all(
            entries.map(async entry => {
                try {
                    const document = await storyService.loadStory(entry.id);
                    this.storyEntries.set(entry.id, extractStoryEntries(document));
                } catch (error) {
                    console.warn(`[SearchService] Failed to index story ${entry.id}:`, error);
                }
            }),
        );

        try {
            const keysDocument = await localizationService.loadKeys();
            this.keyEntries = extractLocalizationKeyEntries(keysDocument);
        } catch (error) {
            console.warn("[SearchService] Failed to index localization keys:", error);
        }

        this.rebuildBlueprintSlice();
        this.rebuildAssetSlice();
        this.subscribe();
        this.emitChanged();
    }

    private subscribe(): void {
        if (this.unsubs.length > 0) {
            return;
        }
        const ctx = this.getContext();
        const storyService = ctx.services.get<StoryService>(Services.Story);
        const graphService = ctx.services.get<UIGraphService>(Services.UIGraph);
        const localizationService = ctx.services.get<LocalizationService>(Services.Localization);

        this.unsubs.push(
            storyService.onDocumentChanged(({ storyId }) => {
                this.scheduleRebuild(`story:${storyId}`, () => this.rebuildStorySlice(storyId));
            }),
            storyService.onLibraryChanged(() => {
                // Adds, deletes, and renames all land here; renames must refresh the context lines
                // baked into every entry, so resync the whole story slice set.
                this.scheduleRebuild("story-library", () => this.resyncStoryLibrary());
            }),
            graphService.onGraphsChanged(() => {
                this.scheduleRebuild("blueprint", () => {
                    this.rebuildBlueprintSlice();
                    this.emitChanged();
                });
            }),
            localizationService.onKeysChanged(document => {
                this.keyEntries = extractLocalizationKeyEntries(document);
                this.emitChanged();
            }),
        );

        // Asset imports, renames, tag edits ("updated"), deletions, and group moves all funnel
        // through these three events.
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        const assetEvents = assetsService.getEvents();
        const scheduleAssetRebuild = () =>
            this.scheduleRebuild("assets", () => {
                this.rebuildAssetSlice();
                this.emitChanged();
            });
        this.unsubs.push(
            assetEvents.on("updated", scheduleAssetRebuild),
            assetEvents.on("deleted", scheduleAssetRebuild),
            assetEvents.on("groupsUpdated", scheduleAssetRebuild),
        );
    }

    private scheduleRebuild(key: string, action: () => void): void {
        const existing = this.rebuildTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }
        this.rebuildTimers.set(
            key,
            setTimeout(() => {
                this.rebuildTimers.delete(key);
                action();
            }, REBUILD_DEBOUNCE_MS),
        );
    }

    private rebuildStorySlice(storyId: string): void {
        const storyService = this.getContext().services.get<StoryService>(Services.Story);
        try {
            const document = storyService.getStoryDocument(storyId);
            this.storyEntries.set(storyId, extractStoryEntries(document));
            this.emitChanged();
        } catch {
            // Story vanished between the event and the rebuild; the library resync removes it.
            this.storyEntries.delete(storyId);
            this.emitChanged();
        }
    }

    private async resyncStoryLibrary(): Promise<void> {
        const storyService = this.getContext().services.get<StoryService>(Services.Story);
        const liveIds = new Set(storyService.listStories().map(entry => entry.id));

        for (const storyId of [...this.storyEntries.keys()]) {
            if (!liveIds.has(storyId)) {
                this.storyEntries.delete(storyId);
            }
        }
        for (const storyId of liveIds) {
            try {
                const document = await storyService.loadStory(storyId);
                this.storyEntries.set(storyId, extractStoryEntries(document));
            } catch (error) {
                console.warn(`[SearchService] Failed to index story ${storyId}:`, error);
            }
        }
        this.emitChanged();
    }

    private rebuildBlueprintSlice(): void {
        const ctx = this.getContext();
        const blueprintService = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const catalog = ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);

        try {
            const document = blueprintService.getBlueprintDocument();
            this.blueprintEntries = extractBlueprintEntries(document, type => {
                try {
                    return catalog.resolveCatalogEntry(type).displayName;
                } catch {
                    return undefined;
                }
            });
        } catch (error) {
            console.warn("[SearchService] Failed to index blueprints:", error);
            this.blueprintEntries = [];
        }
    }

    private rebuildAssetSlice(): void {
        const assetsService = this.getContext().services.get<AssetsService>(Services.Assets);
        try {
            const assets = Object.values(assetsService.getAssets()).flatMap(byId => Object.values(byId));
            this.assetEntries = extractAssetEntries(assets);
        } catch (error) {
            console.warn("[SearchService] Failed to index assets:", error);
            this.assetEntries = [];
        }
    }

    private emitChanged(): void {
        for (const listener of this.changeListeners) {
            listener();
        }
    }
}
