import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { StoryService } from "../story/StoryService";
import { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { BlueprintNodeCatalogService } from "../ui-editor/BlueprintNodeCatalogService";
import { LocalizationService } from "../localization/LocalizationService";
import { AssetsService } from "../core/AssetsService";
import { CharacterService } from "../core/CharacterService";
import { VariableRegistryService } from "../variables/VariableRegistryService";
import { translate } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { parseBlueprintOwnerKey } from "./blueprintOwnerKey";
import {
    extractAssetEntries,
    extractBlueprintEntries,
    extractCharacterEntries,
    extractLocalizationKeyEntries,
    extractStoryEntries,
    extractSurfaceEntries,
    indexEntries,
    querySearchIndex,
    type IndexedSearchEntry,
    type SearchGroupResult,
    type SearchQueryOptions,
} from "./searchIndexModel";

const REBUILD_DEBOUNCE_MS = 300;

/**
 * Search Service - the global project search index.
 *
 * Renderer-side by design: every searchable document (story documents, the blueprint document,
 * the named-key registry) already lives in this process's services, complete with change events,
 * so the index reads them directly and always reflects *unsaved* editing state. A main-process
 * index would only ever see what the debounced savers last flushed to disk.
 *
 * The index is a set of slices, each rebuilt independently from its own change event:
 *  - story slice (per story): `StoryService.onDocumentChanged` / `onLibraryChanged`
 *  - blueprint slice: `UIGraphService.onGraphsChanged` (the blueprint document lives inside the
 *    graph document, so its mutations surface there)
 *  - named-key slice: `LocalizationService.onKeysChanged`
 *  - asset slice: the assets service's `updated`/`deleted`/`groupsUpdated` events
 *  - character slice: `CharacterService.subscribe`
 *  - surface slice: `UIDocumentService.onDocumentChanged`
 *
 * The last three carry *entities*, not content, and they are indexed here rather than left to quick
 * open because this index backs the one search box the author actually types into.
 *
 * Rebuilds are debounced per slice - change events fire per keystroke during editing, and a slice
 * rebuild is a full re-extraction (cheap at VN scale, but not per-keystroke cheap).
 *
 * The full build is lazy: {@link ensureReady} loads every story document once on first use, so
 * project startup does not pay for search nobody has opened yet.
 */
export class SearchService extends Service<SearchService> {
    private storyEntries = new Map<string, IndexedSearchEntry[]>();
    private blueprintEntries: IndexedSearchEntry[] = [];
    private keyEntries: IndexedSearchEntry[] = [];
    private assetEntries: IndexedSearchEntry[] = [];
    private characterEntries: IndexedSearchEntry[] = [];
    private surfaceEntries: IndexedSearchEntry[] = [];

    /**
     * All slices concatenated, rebuilt lazily on first query after a slice changes.
     *
     * Without this the concatenation ran per query - i.e. per keystroke - allocating a fresh array
     * of the entire index each time. Invalidation hangs off {@link emitChanged}, which every slice
     * mutation already ends with (it is the same invariant the change listeners depend on).
     */
    private flatCache: IndexedSearchEntry[] | null = null;

    private readyPromise: Promise<void> | null = null;
    private unsubs: Array<() => void> = [];
    private rebuildTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private readonly changeListeners = new Set<() => void>();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        await depend([
            ctx.services.get<StoryService>(Services.Story),
            ctx.services.get<UIGraphService>(Services.UIGraph),
            ctx.services.get<UIDocumentService>(Services.UIDocument),
            ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint),
            ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog),
            ctx.services.get<LocalizationService>(Services.Localization),
            ctx.services.get<AssetsService>(Services.Assets),
            ctx.services.get<CharacterService>(Services.Character),
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
    public search(query: string, options?: SearchQueryOptions): SearchGroupResult[] {
        return querySearchIndex(this.getFlatEntries(), query, options);
    }

    /** Number of indexed entries (diagnostics, and "searching N items" UI states). */
    public size(): number {
        return this.getFlatEntries().length;
    }

    private getFlatEntries(): IndexedSearchEntry[] {
        if (!this.flatCache) {
            const entries: IndexedSearchEntry[] = [];
            for (const slice of this.storyEntries.values()) {
                entries.push(...slice);
            }
            entries.push(
                ...this.blueprintEntries,
                ...this.keyEntries,
                ...this.assetEntries,
                ...this.characterEntries,
                ...this.surfaceEntries,
            );
            this.flatCache = entries;
        }
        return this.flatCache;
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
        this.characterEntries = [];
        this.surfaceEntries = [];
        this.flatCache = null;
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
                    this.storyEntries.set(entry.id, indexEntries(extractStoryEntries(document)));
                } catch (error) {
                    console.warn(`[SearchService] Failed to index story ${entry.id}:`, error);
                }
            }),
        );

        try {
            const keysDocument = await localizationService.loadKeys();
            this.keyEntries = indexEntries(extractLocalizationKeyEntries(keysDocument));
        } catch (error) {
            console.warn("[SearchService] Failed to index localization keys:", error);
        }

        this.rebuildBlueprintSlice();
        this.rebuildAssetSlice();
        this.rebuildCharacterSlice();
        this.rebuildSurfaceSlice();
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
        const registryService = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);

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
            // The registry is a separate document from the blueprint graphs, so a rename made in the
            // variables panel changes nothing a graph event would report - and the index went on
            // offering the old name until the author happened to edit a graph.
            registryService.onRegistryChanged(() => {
                this.scheduleRebuild("blueprint", () => {
                    this.rebuildBlueprintSlice();
                    this.emitChanged();
                });
            }),
            localizationService.onKeysChanged(document => {
                this.keyEntries = indexEntries(extractLocalizationKeyEntries(document));
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

        // Entity slices. Both fire per edit (a rename is a keystroke at a time), hence the debounce
        // every other slice already goes through.
        const characterService = ctx.services.get<CharacterService>(Services.Character);
        const uiDocumentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
        this.unsubs.push(
            characterService.subscribe(() =>
                this.scheduleRebuild("characters", () => {
                    this.rebuildCharacterSlice();
                    this.emitChanged();
                }),
            ),
            uiDocumentService.onDocumentChanged(() =>
                this.scheduleRebuild("surfaces", () => {
                    this.rebuildSurfaceSlice();
                    this.emitChanged();
                }),
            ),
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
            this.storyEntries.set(storyId, indexEntries(extractStoryEntries(document)));
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
                this.storyEntries.set(storyId, indexEntries(extractStoryEntries(document)));
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
        const registryService = ctx.services.get<VariableRegistryService>(Services.VariableRegistry);

        try {
            const document = blueprintService.getBlueprintDocument();
            this.blueprintEntries = indexEntries(
                extractBlueprintEntries(document, {
                    resolveNodeLabel: type => {
                        try {
                            return catalog.resolveCatalogEntry(type).displayName;
                        } catch {
                            return undefined;
                        }
                    },
                    resolveOwnerLabel: ownerKey => this.resolveBlueprintOwnerLabel(ownerKey),
                    // Both scopes: `listPersistentVariables()` left every registry-declared SAVED
                    // variable out of the index, so an author could not find one by name anywhere in
                    // Studio. See `BlueprintExtractionOptions.registryVariables` for why story
                    // declaration rows are not merged in here.
                    registryVariables: registryService.listEntries(),
                    labels: {
                        unnamedEvent: translate("blueprint.memberTree.unnamedEvent" as TranslationKey),
                        unnamedFunction: translate("blueprint.memberTree.unnamedFunction" as TranslationKey),
                    },
                }),
            );
        } catch (error) {
            console.warn("[SearchService] Failed to index blueprints:", error);
            this.blueprintEntries = [];
        }
    }

    /**
     * Name the surface/element a blueprint hangs on, so a node hit can say where it lives.
     *
     * Blueprints are named after the thing they belong to ("Image", "Button"), which reads as no
     * provenance at all once a project has more than one screen - the owner is the part that
     * actually locates it.
     */
    private resolveBlueprintOwnerLabel(ownerKey: string): string | undefined {
        const owner = parseBlueprintOwnerKey(ownerKey);
        if (!owner) {
            return undefined;
        }
        if (owner.ownerKind === "globalMain") {
            return translate("blueprint.owner.global" as TranslationKey);
        }
        if (owner.ownerKind === "storyAction") {
            return translate("blueprint.owner.storyAction" as TranslationKey);
        }
        let document;
        try {
            document = this.getContext().services.get<UIDocumentService>(Services.UIDocument).getDocument();
        } catch {
            return undefined;
        }
        const parts: string[] = [];
        if (owner.surfaceId) {
            const surface = document.surfaces.find(candidate => candidate.id === owner.surfaceId);
            if (surface?.name) {
                parts.push(surface.name);
            }
        }
        if (owner.componentId) {
            const component = (document.components ?? []).find(candidate => candidate.id === owner.componentId);
            if (component?.name) {
                parts.push(component.name);
            }
        }
        if (owner.elementId) {
            const element = document.elements[owner.elementId];
            const name = element?.name || element?.type;
            if (name) {
                parts.push(name);
            }
        }
        return parts.length > 0 ? parts.join(" › ") : undefined;
    }

    private rebuildCharacterSlice(): void {
        const characterService = this.getContext().services.get<CharacterService>(Services.Character);
        try {
            const groups = characterService.listGroups();
            const groupNameById = new Map(groups.map(group => [group.id, group.name]));
            this.characterEntries = indexEntries(
                extractCharacterEntries(
                    characterService.listCharacter().map(character => {
                        const profile = character.profile.getProfile();
                        const groupId = character.profile.getGroupId();
                        return {
                            id: profile.id,
                            name: profile.name,
                            groupName: groupId ? groupNameById.get(groupId) : undefined,
                            aux: profile.description || undefined,
                        };
                    }),
                ),
            );
        } catch (error) {
            console.warn("[SearchService] Failed to index characters:", error);
            this.characterEntries = [];
        }
    }

    private rebuildSurfaceSlice(): void {
        const uiDocumentService = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        try {
            this.surfaceEntries = indexEntries(
                extractSurfaceEntries(
                    uiDocumentService.getDocument().surfaces.map(surface => ({
                        id: surface.id,
                        name: surface.name,
                        kindLabel: translate(
                            (surface.kind === "stageSurface"
                                ? "uiEditor.surfaceKind.gameUi"
                                : "uiEditor.surfaceKind.page") as TranslationKey,
                        ),
                    })),
                ),
            );
        } catch {
            // The UI document loads lazily; an unbuilt one just means no surfaces to list yet.
            this.surfaceEntries = [];
        }
    }

    private rebuildAssetSlice(): void {
        const assetsService = this.getContext().services.get<AssetsService>(Services.Assets);
        try {
            const assets = Object.values(assetsService.getAssets()).flatMap(byId => Object.values(byId));
            this.assetEntries = indexEntries(extractAssetEntries(assets));
        } catch (error) {
            console.warn("[SearchService] Failed to index assets:", error);
            this.assetEntries = [];
        }
    }

    /**
     * Announce a slice rebuild. Every mutation path ends here, so this is also where the
     * concatenated view is dropped - see {@link flatCache}.
     */
    private emitChanged(): void {
        this.flatCache = null;
        for (const listener of this.changeListeners) {
            listener();
        }
    }
}
