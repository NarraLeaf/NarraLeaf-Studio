import { Service } from "../Service";
import { Services, WorkspaceContext } from "../services";
import { StoryService } from "../story/StoryService";
import { UIDocumentService } from "../ui-editor/UIDocumentService";
import { UIGraphService } from "../ui-editor/UIGraphService";
import { LocalBlueprintService } from "../ui-editor/LocalBlueprintService";
import { BlueprintNodeCatalogService } from "../ui-editor/BlueprintNodeCatalogService";
import { VoiceService } from "../voice/VoiceService";
import { CharacterService } from "../core/CharacterService";
import {
    buildReferenceIndex,
    extractBlueprintAssetReferences,
    extractCharacterAssetReferences,
    extractStoryAnimationAssetReferences,
    extractStoryAssetReferences,
    extractUIDocumentAssetReferences,
    extractVoiceAssetReferences,
    type AssetReference,
    type ReferenceScannableCharacter,
} from "./referenceModel";

const REBUILD_DEBOUNCE_MS = 300;

/**
 * Reference Service — the asset reverse-lookup index ("what uses this file?").
 *
 * Renderer-side for the same reason as `SearchService`: every document that can hold an asset id
 * already lives in this process complete with change events, so the index reflects *unsaved* edits.
 * A main-process index would answer "is this asset safe to delete" from whatever the debounced
 * savers last flushed — which is exactly when the answer is most likely to be stale and destructive.
 *
 * The index is six slices, each rebuilt from its own change event:
 *  - story (per story): `StoryService.onDocumentChanged` / `onLibraryChanged`
 *  - story animation (per animation): `StoryService.onAnimationsChanged`
 *  - blueprint: `UIGraphService.onGraphsChanged` (the blueprint document lives inside the graph doc)
 *  - ui: `UIDocumentService.onDocumentChanged`
 *  - voice (per locale): `VoiceService.onDocumentChanged`
 *  - character: `CharacterService.subscribe`
 *
 * This supersedes `AssetLockManager` as the answer to "is this referenced". The lock manager only
 * ever covered story blocks and character variants, so an image used solely from a widget or a
 * blueprint node reported as unused — the delete guard let it through without a warning.
 */
export class ReferenceService extends Service<ReferenceService> {
    private storyReferences = new Map<string, AssetReference[]>();
    private storyAnimationReferences = new Map<string, AssetReference[]>();
    private voiceReferences = new Map<string, AssetReference[]>();
    private blueprintReferences: AssetReference[] = [];
    private uiReferences: AssetReference[] = [];
    private characterReferences: AssetReference[] = [];

    /**
     * `assetId → references`, rebuilt lazily on first query after any slice changes.
     *
     * The panel queries per asset (and the delete guard queries per selected asset), so the
     * alternative — scanning the flattened list per lookup — is O(all references) per row rendered.
     */
    private indexCache: Map<string, AssetReference[]> | null = null;

    private readyPromise: Promise<void> | null = null;
    private unsubs: Array<() => void> = [];
    /**
     * Debounced slice rebuilds, keyed by slice. The action is held alongside its timer so
     * {@link flushPendingRebuilds} can run it early — a guard that reads through this index cannot
     * afford to see a 300ms-old answer.
     */
    private rebuildTimers = new Map<string, { timer: ReturnType<typeof setTimeout>; action: () => void | Promise<void> }>();
    private readonly changeListeners = new Set<() => void>();

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        await depend([
            ctx.services.get<StoryService>(Services.Story),
            ctx.services.get<UIDocumentService>(Services.UIDocument),
            ctx.services.get<UIGraphService>(Services.UIGraph),
            ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint),
            ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog),
            ctx.services.get<VoiceService>(Services.Voice),
            ctx.services.get<CharacterService>(Services.Character),
        ]);
    }

    /**
     * Build the full index once (loading every story and voice document) and attach the incremental
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

    /** True once the initial full build has completed and subscriptions are live. */
    public isReady(): boolean {
        return this.readyPromise !== null && this.unsubs.length > 0;
    }

    /**
     * Every reference to `assetId`, dormant ones included. Empty when the asset is unused — call
     * {@link ensureReady} first, or an unbuilt index reports everything as unused.
     */
    public getReferences(assetId: string): AssetReference[] {
        return this.getIndex().get(assetId) ?? [];
    }

    /** Whether anything references `assetId`. Cheaper than {@link getReferences} for guards. */
    public isReferenced(assetId: string): boolean {
        return this.getIndex().has(assetId);
    }

    /** Bulk lookup for multi-select delete guards — one index pass instead of one per asset. */
    public getReferencesForAll(assetIds: readonly string[]): Map<string, AssetReference[]> {
        const index = this.getIndex();
        const result = new Map<string, AssetReference[]>();
        for (const assetId of assetIds) {
            const references = index.get(assetId);
            if (references?.length) {
                result.set(assetId, references);
            }
        }
        return result;
    }

    /** Every asset id that has at least one reference (drives "unused asset" views). */
    public getReferencedAssetIds(): Set<string> {
        return new Set(this.getIndex().keys());
    }

    private getIndex(): Map<string, AssetReference[]> {
        if (!this.indexCache) {
            const all: AssetReference[] = [];
            for (const slice of this.storyReferences.values()) {
                all.push(...slice);
            }
            for (const slice of this.storyAnimationReferences.values()) {
                all.push(...slice);
            }
            for (const slice of this.voiceReferences.values()) {
                all.push(...slice);
            }
            all.push(...this.blueprintReferences, ...this.uiReferences, ...this.characterReferences);
            this.indexCache = buildReferenceIndex(all);
        }
        return this.indexCache;
    }

    /** Notifies whenever any slice rebuilds (so open reference lists can refresh). */
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
        for (const { timer } of this.rebuildTimers.values()) {
            clearTimeout(timer);
        }
        this.rebuildTimers.clear();
        this.storyReferences.clear();
        this.storyAnimationReferences.clear();
        this.voiceReferences.clear();
        this.blueprintReferences = [];
        this.uiReferences = [];
        this.characterReferences = [];
        this.indexCache = null;
        this.readyPromise = null;
        this.changeListeners.clear();
    }

    // ---------------------------------------------------------------------
    // Build + incremental rebuilds
    // ---------------------------------------------------------------------

    private async buildAll(): Promise<void> {
        const ctx = this.getContext();
        const storyService = ctx.services.get<StoryService>(Services.Story);
        const voiceService = ctx.services.get<VoiceService>(Services.Voice);

        // Stories load lazily elsewhere; a reverse lookup needs all of them or it under-reports.
        await storyService.loadLibrary();
        await Promise.all(
            storyService.listStories().map(async entry => {
                try {
                    const document = await storyService.loadStory(entry.id);
                    this.storyReferences.set(entry.id, extractStoryAssetReferences(document, entry.name));
                } catch (error) {
                    console.warn(`[ReferenceService] Failed to scan story ${entry.id}:`, error);
                }
            }),
        );

        await this.resyncStoryAnimations();

        // Voice documents are lazy per locale — an unopened language would otherwise contribute no
        // references, and its takes would look deletable.
        await Promise.all(
            voiceService.getConfiguration().voicedLocales.map(async locale => {
                try {
                    const document = await voiceService.loadDocument(locale.code);
                    this.voiceReferences.set(locale.code, extractVoiceAssetReferences(document));
                } catch (error) {
                    console.warn(`[ReferenceService] Failed to scan voice locale ${locale.code}:`, error);
                }
            }),
        );

        this.rebuildBlueprintSlice();
        this.rebuildUISlice();
        this.rebuildCharacterSlice();
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
        const uiDocumentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
        const voiceService = ctx.services.get<VoiceService>(Services.Voice);
        const characterService = ctx.services.get<CharacterService>(Services.Character);

        this.unsubs.push(
            storyService.onDocumentChanged(({ storyId }) => {
                this.scheduleRebuild(`story:${storyId}`, () => this.rebuildStorySlice(storyId));
            }),
            storyService.onLibraryChanged(() => {
                // Adds, deletes and renames all land here; renames change the story name baked into
                // every reference's detail line, so resync the whole slice set.
                this.scheduleRebuild("story-library", () => this.resyncStoryLibrary());
            }),
            storyService.onAnimationsChanged(() => {
                this.scheduleRebuild("story-animations", async () => {
                    await this.resyncStoryAnimations();
                    this.emitChanged();
                });
            }),
            graphService.onGraphsChanged(() => {
                this.scheduleRebuild("blueprint", () => {
                    this.rebuildBlueprintSlice();
                    this.emitChanged();
                });
            }),
            uiDocumentService.onDocumentChanged(() => {
                this.scheduleRebuild("ui", () => {
                    this.rebuildUISlice();
                    this.emitChanged();
                });
            }),
            voiceService.onDocumentChanged(({ locale, document }) => {
                this.scheduleRebuild(`voice:${locale}`, () => {
                    this.voiceReferences.set(locale, extractVoiceAssetReferences(document));
                    this.emitChanged();
                });
            }),
            characterService.subscribe(() => {
                this.scheduleRebuild("character", () => {
                    this.rebuildCharacterSlice();
                    this.emitChanged();
                });
            }),
        );
    }

    private scheduleRebuild(key: string, action: () => void | Promise<void>): void {
        const existing = this.rebuildTimers.get(key);
        if (existing) {
            clearTimeout(existing.timer);
        }
        this.rebuildTimers.set(key, {
            action,
            timer: setTimeout(() => {
                this.rebuildTimers.delete(key);
                action();
            }, REBUILD_DEBOUNCE_MS),
        });
    }

    /**
     * Run every debounced rebuild now instead of waiting out its timer.
     *
     * Staleness is harmless where the index only feeds a readout, but the delete guard decides
     * whether an asset is safe to remove: an author who drops an image into a scene and deletes it
     * from the browser a moment later would otherwise be told it is unused, and lose it.
     *
     * Awaited, because two slices (story library, story animations) reload documents from disk to
     * rebuild. Kicking those off and returning would flush the timer without flushing the staleness.
     */
    public async flushPendingRebuilds(): Promise<void> {
        if (this.rebuildTimers.size === 0) {
            return;
        }
        const pending = [...this.rebuildTimers.values()];
        this.rebuildTimers.clear();
        await Promise.all(pending.map(({ timer, action }) => {
            clearTimeout(timer);
            return action();
        }));
    }

    private rebuildStorySlice(storyId: string): void {
        const storyService = this.getContext().services.get<StoryService>(Services.Story);
        try {
            const document = storyService.getStoryDocument(storyId);
            const name = storyService.listStories().find(entry => entry.id === storyId)?.name ?? storyId;
            this.storyReferences.set(storyId, extractStoryAssetReferences(document, name));
        } catch {
            // Story vanished between the event and the rebuild; the library resync removes it.
            this.storyReferences.delete(storyId);
        }
        this.emitChanged();
    }

    private async resyncStoryLibrary(): Promise<void> {
        const storyService = this.getContext().services.get<StoryService>(Services.Story);
        const entries = storyService.listStories();
        const liveIds = new Set(entries.map(entry => entry.id));

        for (const storyId of [...this.storyReferences.keys()]) {
            if (!liveIds.has(storyId)) {
                this.storyReferences.delete(storyId);
            }
        }
        for (const entry of entries) {
            try {
                const document = await storyService.loadStory(entry.id);
                this.storyReferences.set(entry.id, extractStoryAssetReferences(document, entry.name));
            } catch (error) {
                console.warn(`[ReferenceService] Failed to scan story ${entry.id}:`, error);
            }
        }
        this.emitChanged();
    }

    /**
     * Animation documents are lazy like stories: the index lists them, the bodies load on demand.
     * A reverse lookup has to open all of them, or an animation the author has not visited this
     * session contributes nothing and its preview images look deletable.
     */
    private async resyncStoryAnimations(): Promise<void> {
        const storyService = this.getContext().services.get<StoryService>(Services.Story);
        const entries = storyService.listAnimationAssets();
        const liveIds = new Set(entries.map(entry => entry.id));

        for (const animationId of [...this.storyAnimationReferences.keys()]) {
            if (!liveIds.has(animationId)) {
                this.storyAnimationReferences.delete(animationId);
            }
        }
        await Promise.all(
            entries.map(async entry => {
                try {
                    const animation = await storyService.loadAnimationAsset(entry.id);
                    this.storyAnimationReferences.set(entry.id, extractStoryAnimationAssetReferences(animation));
                } catch (error) {
                    console.warn(`[ReferenceService] Failed to scan animation ${entry.id}:`, error);
                }
            }),
        );
    }

    private rebuildBlueprintSlice(): void {
        const ctx = this.getContext();
        const blueprintService = ctx.services.get<LocalBlueprintService>(Services.LocalBlueprint);
        const catalog = ctx.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);

        try {
            const document = blueprintService.getBlueprintDocument();
            this.blueprintReferences = extractBlueprintAssetReferences(document, type => {
                try {
                    return catalog.resolveCatalogEntry(type).displayName;
                } catch {
                    return undefined;
                }
            });
        } catch (error) {
            console.warn("[ReferenceService] Failed to scan blueprints:", error);
            this.blueprintReferences = [];
        }
    }

    private rebuildUISlice(): void {
        const uiDocumentService = this.getContext().services.get<UIDocumentService>(Services.UIDocument);
        try {
            this.uiReferences = extractUIDocumentAssetReferences(uiDocumentService.getDocument());
        } catch (error) {
            console.warn("[ReferenceService] Failed to scan the UI document:", error);
            this.uiReferences = [];
        }
    }

    private rebuildCharacterSlice(): void {
        const characterService = this.getContext().services.get<CharacterService>(Services.Character);
        try {
            const characters: ReferenceScannableCharacter[] = characterService.listCharacter().map(character => ({
                id: character.profile.getId(),
                name: character.profile.getName(),
                thumbnailAssetId: character.profile.getThumbnail(),
                forms: character.profile.appearance.getForms().map(form => ({
                    name: form.name,
                    // Variant slots embed the whole `Asset`; the id sits one level deeper.
                    variantAssetIds: Object.fromEntries(
                        Object.entries(form.variantAssets).map(([variantName, variantData]) => [
                            variantName,
                            variantData?.data?.id ?? null,
                        ]),
                    ),
                })),
            }));
            this.characterReferences = extractCharacterAssetReferences(characters);
        } catch (error) {
            console.warn("[ReferenceService] Failed to scan characters:", error);
            this.characterReferences = [];
        }
    }

    /**
     * Announce a slice rebuild. Every mutation path ends here, so this is also where the grouped
     * view is dropped — see {@link indexCache}.
     */
    private emitChanged(): void {
        this.indexCache = null;
        for (const listener of this.changeListeners) {
            listener();
        }
    }
}
