/**
 * Single source of truth for how tall the story inspector draws a character's appearance preview
 * (`editor.appearancePreviewHeight`).
 *
 * Shared between the picker that draws the preview and the buttons that resize it, so the ladder of
 * sizes, its default and the key they are stored under cannot drift apart.
 */

/**
 * The heights the preview steps through, in CSS pixels.
 *
 * A ladder rather than a free number for two reasons. The composite is cached per size
 * (`SpriteCompositor` keys on `maxSize`), so a continuous control would leave a decoded bitmap
 * behind at every pixel it passed through; and a portrait only has to answer "does this combination
 * read", which a handful of well-separated sizes answers as well as a thousand.
 */
export const APPEARANCE_PREVIEW_HEIGHTS: readonly number[] = [160, 216, 288, 384, 512];

/** Global-state key the chosen height is stored under. */
export const APPEARANCE_PREVIEW_HEIGHT_KEY = "editor.appearancePreviewHeight" as const;

/**
 * The third rung.
 *
 * The preview used to be a share of the picker's width with the tag rows beside it, which on the
 * inspector rail came out around 200px tall. 288 is the first step that is clearly taller than that
 * while still leaving the axes it belongs to on screen without scrolling.
 */
export const APPEARANCE_PREVIEW_HEIGHT_DEFAULT = 288;

/**
 * Narrow an unknown stored value to one of the rungs.
 *
 * A stored value is untrusted - it survives a downgrade, and the ladder may be re-cut later - so it
 * is snapped to the nearest rung rather than accepted or discarded. An author who set the largest
 * size keeps the largest size even if that number stops being one of the steps.
 */
export function resolveAppearancePreviewHeight(stored: unknown): number {
    if (typeof stored !== "number" || !Number.isFinite(stored)) {
        return APPEARANCE_PREVIEW_HEIGHT_DEFAULT;
    }
    let nearest = APPEARANCE_PREVIEW_HEIGHTS[0];
    for (const height of APPEARANCE_PREVIEW_HEIGHTS) {
        if (Math.abs(height - stored) < Math.abs(nearest - stored)) {
            nearest = height;
        }
    }
    return nearest;
}

/** The rung one step from `height`, or `height` itself when it is already at that end. */
export function stepAppearancePreviewHeight(height: number, direction: 1 | -1): number {
    const index = APPEARANCE_PREVIEW_HEIGHTS.indexOf(resolveAppearancePreviewHeight(height));
    const next = index + direction;
    return APPEARANCE_PREVIEW_HEIGHTS[next] ?? APPEARANCE_PREVIEW_HEIGHTS[index];
}
