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
    type GalleryGroup,
    type GallerySettings,
    type GalleryStoreData,
    type GalleryVariant,
} from "./catalog";

export type GalleryStore = ReturnType<typeof createGalleryStore>;

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

    const newArtwork = (name: string, groupId: string | null, variants: GalleryVariant[]): GalleryArtwork => {
        const now = Date.now();
        return {
            id: createArtworkId(),
            name,
            kind: "cg",
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
        async addArtwork(groupId: string | null = null): Promise<string> {
            const artwork = newArtwork(`Artwork ${data.items.length + 1}`, groupId, []);
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
