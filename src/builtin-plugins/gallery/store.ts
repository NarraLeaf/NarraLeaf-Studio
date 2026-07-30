/**
 * The editing store behind the Gallery panel and editor tab.
 *
 * One observable copy of the catalog, mutated through named operations that all
 * funnel into `commit`: normalize, notify subscribers, notify the blueprint
 * inspector that its dynamic dropdowns changed, then persist. Persisting last
 * keeps the UI responsive; normalizing first means the store never holds a shape
 * the runtime would reject.
 */

import type { Asset, BlueprintInspectorParamSelectOption, PluginApp } from "narraleaf-studio/plugin";
import {
    DEFAULT_LOCKED_NAME_MASK,
    GALLERY_STORE_NAMESPACE,
    GALLERY_STORE_VERSION,
    createArtworkId,
    createGroupId,
    createVariantId,
    normalizeGalleryStore,
    type GalleryArtwork,
    type GalleryEntryKind,
    type GalleryGroup,
    type GalleryScenePayload,
    type GallerySettings,
    type GalleryStoreData,
    type GalleryVariant,
} from "./catalog";

export type GalleryStore = ReturnType<typeof createGalleryStore>;

/** What a newly created entry of each kind is called before the author renames it. */
const DEFAULT_ENTRY_NAME: Record<GalleryEntryKind, string> = {
    cg: "Artwork",
    scene: "Recollection",
    music: "Album",
    voice: "Voice Set",
};

const EMPTY_STORE: GalleryStoreData = {
    version: GALLERY_STORE_VERSION,
    groups: [],
    items: [],
    settings: { lockedImageAssetId: null, lockedNameMask: DEFAULT_LOCKED_NAME_MASK },
};

/** Move `id` so it sits immediately before `beforeId`, or last when that is null. */
function reorder<T extends { id: string }>(list: T[], id: string, beforeId: string | null): T[] {
    const from = list.findIndex(entry => entry.id === id);
    if (from < 0 || id === beforeId) {
        return list;
    }
    const next = [...list];
    const [moved] = next.splice(from, 1);
    const to = beforeId === null ? next.length : next.findIndex(entry => entry.id === beforeId);
    next.splice(to < 0 ? next.length : to, 0, moved!);
    return next;
}

export function createGalleryStore(app: PluginApp) {
    let data: GalleryStoreData = EMPTY_STORE;
    const listeners = new Set<() => void>();

    const notify = () => {
        for (const listener of listeners) {
            listener();
        }
        app.services.blueprintNodes.notifyDynamicSelectOptionsChanged();
    };

    const commit = async (next: Partial<GalleryStoreData>) => {
        data = normalizeGalleryStore({ ...data, ...next });
        notify();
        await app.services.storage.writeJson<GalleryStoreData>(GALLERY_STORE_NAMESPACE, data);
    };

    const commitItems = (items: GalleryArtwork[]) => commit({ items });

    const patchArtwork = (
        artworkId: string,
        patch: (artwork: GalleryArtwork) => GalleryArtwork,
    ) => commitItems(data.items.map(artwork => (
        artwork.id === artworkId
            ? { ...patch(artwork), updatedAt: Date.now() }
            : artwork
    )));

    const newArtwork = (
        name: string,
        groupId: string | null,
        variants: GalleryVariant[],
        kind: GalleryEntryKind = "cg",
    ): GalleryArtwork => {
        const now = Date.now();
        return {
            id: createArtworkId(),
            name,
            kind,
            description: "",
            groupId,
            variants,
            coverVariantId: null,
            lockedImageAssetId: null,
            hidden: false,
            createdAt: now,
            updatedAt: now,
        };
    };

    const variantFromAsset = (artworkId: string, asset: Asset, fallbackName: string): GalleryVariant => ({
        id: createVariantId(artworkId),
        name: asset.name || fallbackName,
        imageAssetId: asset.id,
        imageAssetName: asset.name,
    });

    /** A track or a loose voice clip: audio-backed, named after the file. */
    const variantFromAudio = (artworkId: string, asset: Asset, fallbackName: string): GalleryVariant => ({
        id: createVariantId(artworkId),
        name: stripExtension(asset.name) || fallbackName,
        imageAssetId: null,
        audioAssetId: asset.id,
        audioAssetName: asset.name,
    });

    return {
        async load() {
            data = normalizeGalleryStore(
                await app.services.storage.readJson<GalleryStoreData>(GALLERY_STORE_NAMESPACE),
            );
            notify();
        },
        getData: () => data,
        getItems: () => data.items,
        getGroups: () => data.groups,
        getSettings: () => data.settings,

        /** Artwork options for the node inspector's Artwork picker. */
        getArtworkOptions: (): BlueprintInspectorParamSelectOption[] =>
            data.items.map(artwork => ({
                value: artwork.id,
                label: artwork.name || artwork.id,
            })),
        /**
         * Variant options for every artwork at once. The inspector narrows them
         * to the selected artwork through dynamicOptionsFilter on this meta.
         */
        getVariantOptions: (): BlueprintInspectorParamSelectOption[] =>
            data.items.flatMap(artwork => artwork.variants.map(variant => ({
                value: variant.id,
                label: variant.name || variant.id,
                meta: { artworkId: artwork.id },
            }))),
        getGroupOptions: (): BlueprintInspectorParamSelectOption[] =>
            data.groups.map(group => ({
                value: group.id,
                label: group.name || group.id,
            })),

        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },

        // ----------------------------------------------------------------
        // Artworks
        // ----------------------------------------------------------------
        /**
         * An empty entry of the given kind. Recollections and voice sets start
         * this way (there is nothing to import - the author picks a scene or
         * lines next); CG and music normally arrive through the import paths.
         */
        async addArtwork(kind: GalleryEntryKind = "cg", groupId: string | null = null): Promise<string> {
            const count = data.items.filter(item => item.kind === kind).length;
            const artwork = newArtwork(`${DEFAULT_ENTRY_NAME[kind]} ${count + 1}`, groupId, [], kind);
            await commitItems([...data.items, artwork]);
            return artwork.id;
        },
        /**
         * One artwork per picked image - the single-CG gallery in one action.
         * An artwork gains differentials later by adding variants to it, so this
         * shortcut never paints a project into a corner.
         */
        async importArtworks(assets: Asset[], groupId: string | null = null): Promise<string[]> {
            const created = assets.map(asset => {
                const artwork = newArtwork(stripExtension(asset.name), groupId, []);
                artwork.variants = [variantFromAsset(artwork.id, asset, artwork.name)];
                return artwork;
            });
            await commitItems([...data.items, ...created]);
            return created.map(artwork => artwork.id);
        },
        async patchArtworkFields(artworkId: string, patch: Partial<Omit<GalleryArtwork, "id" | "variants">>) {
            await patchArtwork(artworkId, artwork => ({ ...artwork, ...patch }));
        },
        async removeArtworks(artworkIds: string[]) {
            const doomed = new Set(artworkIds);
            await commitItems(data.items.filter(artwork => !doomed.has(artwork.id)));
        },
        async moveArtwork(artworkId: string, beforeArtworkId: string | null) {
            await commitItems(reorder(data.items, artworkId, beforeArtworkId));
        },

        // ----------------------------------------------------------------
        // Variants
        // ----------------------------------------------------------------
        /** One variant per picked asset, so a whole differential set lands in one go. */
        async addVariants(artworkId: string, assets: Asset[]) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                variants: [
                    ...artwork.variants,
                    ...assets.map((asset, index) => variantFromAsset(
                        artwork.id,
                        asset,
                        `Variant ${artwork.variants.length + index + 1}`,
                    )),
                ],
            }));
        },
        /** Tracks of an album, or loose clips of a voice set. */
        async addAudioVariants(artworkId: string, assets: Asset[]) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                variants: [
                    ...artwork.variants,
                    ...assets.map((asset, index) => variantFromAudio(
                        artwork.id,
                        asset,
                        `Track ${artwork.variants.length + index + 1}`,
                    )),
                ],
            }));
        },
        /**
         * Voice lines, from picked voice units. The clip is not stored: the unit
         * id resolves to it through the shipped voice table at runtime, so a
         * re-recorded take needs no gallery edit.
         */
        async addVoiceVariants(
            artworkId: string,
            units: { unitId: string; text: string; durationSec: number | null }[],
        ) {
            await patchArtwork(artworkId, artwork => {
                const existing = new Set(
                    artwork.variants.map(variant => variant.voiceUnitId).filter(Boolean),
                );
                const fresh = units.filter(unit => !existing.has(unit.unitId));
                return {
                    ...artwork,
                    variants: [
                        ...artwork.variants,
                        ...fresh.map(unit => ({
                            id: createVariantId(artwork.id),
                            // The line itself is the name: a voice row is
                            // recognised by what is said, not by a label.
                            name: unit.text.slice(0, 60) || unit.unitId,
                            imageAssetId: null,
                            voiceUnitId: unit.unitId,
                            lineText: unit.text,
                            ...(unit.durationSec ? { durationSec: unit.durationSec } : {}),
                        })),
                    ],
                };
            });
        },
        /** One album per picked file is rarely wanted; one album, many tracks is. */
        async importTracks(assets: Asset[], groupId: string | null = null): Promise<string> {
            const artwork = newArtwork(
                `Album ${data.items.filter(item => item.kind === "music").length + 1}`,
                groupId,
                [],
                "music",
            );
            artwork.variants = assets.map((asset, index) => variantFromAudio(
                artwork.id,
                asset,
                `Track ${index + 1}`,
            ));
            // A single track reads better as its own entry than as a one-track
            // album, so it takes the file's name.
            if (assets.length === 1) {
                artwork.name = artwork.variants[0]?.name ?? artwork.name;
            }
            await commitItems([...data.items, artwork]);
            return artwork.id;
        },
        async setScene(artworkId: string, scene: GalleryScenePayload | null) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                ...(scene ? { scene } : { scene: null }),
            }));
        },
        async patchVariant(artworkId: string, variantId: string, patch: Partial<GalleryVariant>) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                variants: artwork.variants.map(variant => (
                    variant.id === variantId ? { ...variant, ...patch } : variant
                )),
            }));
        },
        async removeVariant(artworkId: string, variantId: string) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                variants: artwork.variants.filter(variant => variant.id !== variantId),
                coverVariantId: artwork.coverVariantId === variantId ? null : artwork.coverVariantId,
            }));
        },
        async moveVariant(artworkId: string, variantId: string, beforeVariantId: string | null) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                variants: reorder(artwork.variants, variantId, beforeVariantId),
            }));
        },
        async setCoverVariant(artworkId: string, variantId: string) {
            await patchArtwork(artworkId, artwork => ({
                ...artwork,
                // Clicking the current cover clears it, falling back to the first variant.
                coverVariantId: artwork.coverVariantId === variantId ? null : variantId,
            }));
        },

        // ----------------------------------------------------------------
        // Groups
        // ----------------------------------------------------------------
        async addGroup(name?: string): Promise<string> {
            const group: GalleryGroup = {
                id: createGroupId(),
                name: name?.trim() || `Group ${data.groups.length + 1}`,
            };
            await commit({ groups: [...data.groups, group] });
            return group.id;
        },
        async renameGroup(groupId: string, name: string) {
            await commit({
                groups: data.groups.map(group => (group.id === groupId ? { ...group, name } : group)),
            });
        },
        /** Artworks in a deleted group survive as ungrouped (the normalizer drops the dangling id). */
        async removeGroup(groupId: string) {
            await commit({ groups: data.groups.filter(group => group.id !== groupId) });
        },
        async moveGroup(groupId: string, beforeGroupId: string | null) {
            await commit({ groups: reorder(data.groups, groupId, beforeGroupId) });
        },

        // ----------------------------------------------------------------
        // Settings
        // ----------------------------------------------------------------
        async patchSettings(patch: Partial<GallerySettings>) {
            await commit({ settings: { ...data.settings, ...patch } });
        },
    };
}

/** Asset names carry their extension; an artwork title should not. */
function stripExtension(name: string): string {
    const trimmed = name.trim();
    const dot = trimmed.lastIndexOf(".");
    return dot > 0 ? trimmed.slice(0, dot) : trimmed;
}
