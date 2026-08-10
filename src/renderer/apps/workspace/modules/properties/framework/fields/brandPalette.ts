import { useCallback, useSyncExternalStore } from "react";
import {
    getActiveBrandPalette,
    getActiveBrandPaletteRevision,
    subscribeActiveBrandPalette,
    type BrandPalette,
} from "@shared/brand/brandRegistry";
import type { TranslationKey } from "@shared/i18n";
import type { BrandColor } from "@shared/types/brand";
import { useTranslation } from "@/lib/i18n";

/**
 * The project palette, as React reads it.
 *
 * Same shape as `recentColors.ts` next door: the store is module-level state in
 * `@shared/brand/brandRegistry`, and these are the `useSyncExternalStore` bindings over it. The
 * subscribe / snapshot functions are module-level declarations so their references stay stable
 * across renders - a fresh closure each render makes `useSyncExternalStore` re-subscribe on every
 * one.
 *
 * Read-only. Publishing a palette is the host's job (`BrandService` in the editor, the pack loader
 * in the game), not a colour field's.
 *
 * Comments in English per project convention.
 */

/** The live palette. Re-renders whenever a host publishes a different one. */
export function useBrandPalette(): BrandPalette {
    return useSyncExternalStore(subscribeActiveBrandPalette, getActiveBrandPalette, getActiveBrandPalette);
}

/**
 * A number that changes whenever the palette does.
 *
 * For the canvas, whose element tree is memoized on its props: a brand edit is not a document edit,
 * so nothing in those props moves and the old colours stay on screen. Taking this as a prop is what
 * makes the memo miss.
 */
export function useBrandPaletteRevision(): number {
    return useSyncExternalStore(
        subscribeActiveBrandPalette,
        getActiveBrandPaletteRevision,
        getActiveBrandPaletteRevision,
    );
}

/**
 * What to call a palette entry on screen.
 *
 * An author's own colour has the name they typed. A seeded one has no name in the document at all -
 * that is deliberate, an English word burnt into the file would read as English in a zh project -
 * so its name is an i18n string looked up from its id.
 *
 * **The dots in the id become hyphens** (`button.primary` -> `brand.presetName.button-primary`).
 * A message key is itself a dotted path, so dropping an id in whole would have `button.primary`
 * name a `button` group containing a `primary` leaf - the id's structure silently reinterpreted as
 * catalog structure, and the two would collide the day a group and a slot shared a name.
 *
 * An id with no message falls back to the id itself: a slot seeded ahead of its translation should
 * read as something identifiable rather than as an empty swatch.
 */
export function useBrandColorLabel(): (color: BrandColor) => string {
    const { t, has } = useTranslation();
    return useCallback(
        (color: BrandColor) => {
            if (color.name) {
                return color.name;
            }
            const key = `brand.presetName.${color.id.replace(/\./g, "-")}`;
            return has(key) ? t(key as TranslationKey) : color.id;
        },
        [t, has],
    );
}
