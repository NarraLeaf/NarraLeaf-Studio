import type { StoryCharacterVariantSelection } from "@shared/types/story";

/**
 * The minimal form shape needed to resolve a differential selection to variant names: just the
 * variant groups. Both the story compiler's `DevModeCharacterSummary` form and the editor's
 * `CharacterForm` satisfy it structurally, which is what lets the two share one selection rule.
 */
export type VariantSelectForm = {
    groups?: ReadonlyArray<{
        name: string;
        defaultVariant?: string | null;
        variants?: ReadonlyArray<{ name: string }>;
    }>;
};

/**
 * The ordered variant names a differential selection resolves to (one per group).
 *
 * An array selection is already ordered and taken verbatim. A record selection reads each group's
 * explicit choice, else its default, else its first variant. Extracted verbatim from the story
 * compiler so the editor's variant-aware avatars pick the exact same asset the runtime would — the
 * compiler now calls this, so its behaviour is unchanged.
 */
export function selectCharacterVariantNames(
    form: VariantSelectForm,
    variants: StoryCharacterVariantSelection | undefined,
): string[] {
    if (Array.isArray(variants)) {
        return variants;
    }
    const selected: string[] = [];
    for (const group of form.groups ?? []) {
        const explicit = variants?.[group.name];
        const fallback = group.defaultVariant ?? group.variants?.[0]?.name;
        const choice = explicit || fallback;
        if (choice) {
            selected.push(choice);
        }
    }
    return selected;
}

/**
 * The first resolvable stored entry for an ordered variant selection: the earliest named variant that
 * satisfies `hasAsset`, else any satisfying entry in the map. This is the one fallback rule shared by
 * everything that turns a differential selection into a concrete asset — the runtime lookup, the
 * editor avatar's id, and the editor avatar's `Asset` object all walk the map the same way.
 */
export function resolveVariantEntry<T>(
    variantAssets: Record<string, T> | undefined,
    variantNames: readonly string[],
    hasAsset: (entry: T) => boolean,
): T | null {
    if (!variantAssets) {
        return null;
    }
    for (const name of variantNames) {
        const entry = variantAssets[name];
        if (entry && hasAsset(entry)) {
            return entry;
        }
    }
    for (const entry of Object.values(variantAssets)) {
        if (hasAsset(entry)) {
            return entry;
        }
    }
    return null;
}

/**
 * The first resolvable asset id for an ordered variant selection. Generic over how a stored entry
 * exposes its id — the compiler keys `assetId`, the editor `data.id` — so both the runtime lookup and
 * the editor avatar share one fallback rule (see {@link resolveVariantEntry}).
 */
export function resolveVariantAssetId<T>(
    variantAssets: Record<string, T> | undefined,
    variantNames: readonly string[],
    getAssetId: (entry: T) => string | null | undefined,
): string | null {
    const entry = resolveVariantEntry(variantAssets, variantNames, candidate => Boolean(getAssetId(candidate)));
    return entry ? getAssetId(entry) ?? null : null;
}
