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
 * The first resolvable asset id for an ordered variant selection: the earliest named variant that
 * carries an asset, else any asset in the map. Generic over how a stored entry exposes its id — the
 * compiler keys `assetId`, the editor `data.id` — so both the runtime lookup and the editor avatar
 * share one fallback rule.
 */
export function resolveVariantAssetId<T>(
    variantAssets: Record<string, T> | undefined,
    variantNames: readonly string[],
    getAssetId: (entry: T) => string | null | undefined,
): string | null {
    if (!variantAssets) {
        return null;
    }
    for (const name of variantNames) {
        const entry = variantAssets[name];
        const id = entry ? getAssetId(entry) : null;
        if (id) {
            return id;
        }
    }
    for (const entry of Object.values(variantAssets)) {
        const id = getAssetId(entry);
        if (id) {
            return id;
        }
    }
    return null;
}
