import { i18nStore, translate } from "@/lib/i18n";
import { readAssetTag } from "@shared/types/assetSetLabels";
import { Services, type WorkspaceContext } from "../../services";
import { AssetsService } from "../../core/AssetsService";
import { AssetSetService } from "../../assets/AssetSetService";
import { AppTagService } from "../../appTag/AppTagService";
import { LocalizationService } from "../../localization/LocalizationService";
import type { SearchIndexEntry } from "../searchIndexModel";
import type { SearchSource } from "../searchSource";

/**
 * What a tag reads as in a result's detail line, or null for one the line leaves out.
 *
 * A member of an asset set carries the set's bookkeeping among its tags; the detail line prints them
 * the way the asset library does (see `readAssetTag`). Also what a search matches, so a detail line
 * never matches on an id it does not show.
 */
export type SearchTagReader = (tag: string) => string | null;

function readTags(tags: readonly string[] | undefined, readTag: SearchTagReader): string[] {
    return (tags ?? []).flatMap(tag => {
        const label = readTag(tag);
        return label === null ? [] : [label];
    });
}

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
export function extractAssetEntries(
    assets: readonly SearchableAsset[],
    readTag: SearchTagReader = tag => tag,
): SearchIndexEntry[] {
    return assets
        .filter(asset => asset.name)
        .map(asset => {
            const detailParts = readTags(asset.tags, readTag);
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
export function extractAssetSetEntries(
    sets: readonly SearchableAssetSet[],
    readTag: SearchTagReader = tag => tag,
): SearchIndexEntry[] {
    return sets
        .filter(set => set.name)
        .map(set => {
            // The tags that decide membership - a set's answer to the tag list a file carries, read
            // the same way. A set's own identity tag is bookkeeping, so most sets have no detail.
            const detailParts = readTags(set.filter, readTag);
            return {
                id: `assetSet:${set.id}`,
                group: "asset" as const,
                text: set.name,
                detail: detailParts.length > 0 ? detailParts.join(", ") : undefined,
                fields: { assetType: set.type },
                target: { kind: "assetSet" as const, assetSetId: set.id },
            };
        });
}

/**
 * The reader the asset slice prints tags with, from the project's languages and editions.
 *
 * Read per build of the slice, and the slice rebuilds when either list changes (see `watch`): a
 * renamed edition renames the detail lines that name it.
 */
function projectTagReader(ctx: WorkspaceContext): SearchTagReader {
    let locales: ReadonlyMap<string, string> = new Map();
    let editions: ReadonlyMap<string, string> = new Map();
    try {
        locales = new Map(ctx.services.get<LocalizationService>(Services.Localization)
            .getConfiguration().locales.map(locale => [locale.code, locale.displayName]));
    } catch {
        // No languages to name: a language tag prints its code.
    }
    try {
        editions = new Map(ctx.services.get<AppTagService>(Services.AppTags).listTags().map(tag => [tag.id, tag.name]));
    } catch {
        // No editions to name: `main` is still named, and any other edition reads as deleted.
    }
    const naming = {
        locales,
        editions,
        words: {
            language: translate("assets.sets.axisWord.language"),
            edition: translate("assets.sets.axisWord.variant"),
            deletedEdition: translate("assets.sets.deletedVariant"),
        },
    };
    return tag => readAssetTag(tag, naming);
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
    dependsOn: [Services.Assets, Services.AssetSets, Services.Localization, Services.AppTags],
    extract: ctx => {
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        const setService = ctx.services.get<AssetSetService>(Services.AssetSets);
        const readTag = projectTagReader(ctx);
        return [
            ...extractAssetEntries(Object.values(assetsService.getAssets()).flatMap(byId => Object.values(byId)), readTag),
            ...extractAssetSetEntries(setService.listSets(), readTag),
        ];
    },
    // Asset imports, renames, tag edits ("updated"), deletions, and group moves all funnel through
    // the library's three events; a set's own name and membership rule come from its service; and
    // the words a set's tags are printed in come from the project's languages and editions - and
    // from the interface language, which "Language:", "Variant:" and "Deleted variant" are written in.
    watch: (ctx, signal) => {
        const events = ctx.services.get<AssetsService>(Services.Assets).getEvents();
        const rebuild = () => signal.invalidate();
        const unsubs = [
            events.on("updated", rebuild),
            events.on("deleted", rebuild),
            events.on("groupsUpdated", rebuild),
            ctx.services.get<AssetSetService>(Services.AssetSets).onSetsChanged(rebuild),
            ctx.services.get<LocalizationService>(Services.Localization).onConfigChanged(rebuild),
            ctx.services.get<AppTagService>(Services.AppTags).onTagsChanged(rebuild),
            i18nStore.subscribe(rebuild),
        ];
        return () => unsubs.forEach(unsub => unsub());
    },
};
