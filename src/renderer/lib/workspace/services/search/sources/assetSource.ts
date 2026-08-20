import { Services } from "../../services";
import { AssetsService } from "../../core/AssetsService";
import { AssetSetService } from "../../assets/AssetSetService";
import type { SearchIndexEntry } from "../searchIndexModel";
import type { SearchSource } from "../searchSource";

/** The slice of an asset the index needs; matches `Asset` structurally without importing it. */
export interface SearchableAsset {
    id: string;
    type: string;
    name: string;
    tags?: readonly string[];
    description?: string;
}

/**
 * Asset slice: every imported asset (images, audio, video, fonts…) searchable by name (title) and
 * by tags/description (detail). The type rides on the target so the jump can pick the right
 * affordance (preview tab vs. panel selection).
 */
export function extractAssetEntries(assets: readonly SearchableAsset[]): SearchIndexEntry[] {
    return assets
        .filter(asset => asset.name)
        .map(asset => {
            const detailParts = [...(asset.tags ?? [])];
            if (asset.description) {
                detailParts.push(asset.description);
            }
            return {
                id: `asset:${asset.id}`,
                group: "asset" as const,
                text: asset.name,
                detail: detailParts.length > 0 ? detailParts.join(", ") : undefined,
                fields: { assetType: asset.type },
                target: { kind: "asset" as const, assetId: asset.id, assetType: asset.type },
            };
        });
}

/** The slice of an asset set the index needs; matches `AssetSet` structurally without importing it. */
export interface SearchableAssetSet {
    id: string;
    type: string;
    name: string;
    filter?: readonly string[];
}

/**
 * Asset sets, in the same slice as the files.
 *
 * The same group rather than one of their own, because a set is a row in the assets panel next to
 * the files and an author looking for "Room" does not first decide which of the two it is. What
 * separates them is the TARGET: a file opens a preview, a set is revealed selected with its
 * inspector, and the two are different variants precisely so this list does not have to explain
 * itself to the jump.
 *
 * Without this a set was unfindable: renaming one and then searching for the new name returned
 * nothing at all, which reads as the set having stopped existing.
 */
export function extractAssetSetEntries(sets: readonly SearchableAssetSet[]): SearchIndexEntry[] {
    return sets
        .filter(set => set.name)
        .map(set => ({
            id: `assetSet:${set.id}`,
            group: "asset" as const,
            text: set.name,
            // The tags that decide membership - a set's answer to the tag list a file carries.
            detail: set.filter && set.filter.length > 0 ? set.filter.join(", ") : undefined,
            fields: { assetType: set.type },
            target: { kind: "assetSet" as const, assetSetId: set.id },
        }));
}

/**
 * Every imported asset, in one slice.
 *
 * No `dedupKey`, and that is a decision rather than an omission: two files that happen to share a
 * name and a tag list are still two files, each with its own preview and its own delete. Collapsing
 * them would remove a destination the author can reach today - the opposite of the blueprint case,
 * where the collapsed rows led to the same place by construction.
 */
export const assetSource: SearchSource = {
    id: "asset",
    groups: ["asset"],
    dependsOn: [Services.Assets, Services.AssetSets],
    extract: ctx => {
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        const setService = ctx.services.get<AssetSetService>(Services.AssetSets);
        return [
            ...extractAssetEntries(Object.values(assetsService.getAssets()).flatMap(byId => Object.values(byId))),
            ...extractAssetSetEntries(setService.listSets()),
        ];
    },
    // Asset imports, renames, tag edits ("updated"), deletions, and group moves all funnel through
    // the library's three events; a set's own name and membership rule come from its service.
    watch: (ctx, signal) => {
        const events = ctx.services.get<AssetsService>(Services.Assets).getEvents();
        const rebuild = () => signal.invalidate();
        const unsubs = [
            events.on("updated", rebuild),
            events.on("deleted", rebuild),
            events.on("groupsUpdated", rebuild),
            ctx.services.get<AssetSetService>(Services.AssetSets).onSetsChanged(rebuild),
        ];
        return () => unsubs.forEach(unsub => unsub());
    },
};
