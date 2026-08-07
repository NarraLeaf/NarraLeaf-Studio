/**
 * The monogram tile something named gets when it ships no icon of its own - a project in the recent
 * list, a plugin in the plugin lists.
 *
 * Identity in those lists is the name, and names repeat ("Demo", "test") - the tile is what lets the
 * eye land on the right row before reading anything. Both halves derive from the name alone, so the
 * same thing looks the same everywhere it appears, with nothing to store.
 */

/**
 * One or two letters, taken from the start of the first words in the name.
 *
 * Word boundaries include camel case, because project names are usually written that way and
 * "CodemaoAutoTop" reduces to a useful "CA" rather than a meaningless "CO". A single word gets a
 * single letter - two letters from one word reads like an abbreviation of something else.
 *
 * Takes a missing name rather than requiring one. Both helpers here are total on purpose: a
 * nameless history record once reached this function, threw on `name.length`, and - because the
 * critical error boundary answers an uncaught render error by terminating - quit the app on every
 * launch. `recentProjectDisplayName` is the fix for *why* a name would be missing; this is the
 * guarantee that a monogram can never be the thing that ends the process.
 */
export function nameInitials(name?: string | null): string {
    const words = (name ?? "")
        // Separators of every kind become spaces: "Aumiao-py", "DrinkGame.sWeb", "my_game".
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        // Then split camel case, so "CodemaoAutoTop" is three words rather than one.
        .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    if (words.length === 0) {
        return "?";
    }
    if (words.length === 1) {
        return words[0].slice(0, 1).toUpperCase();
    }
    return (words[0].slice(0, 1) + words[1].slice(0, 1)).toUpperCase();
}

/**
 * Hues for the tiles, spaced around the wheel and picked rather than computed.
 *
 * A hash straight onto 0-360 looks fine in theory and bad in a list: it clusters, so three
 * neighbouring projects come out as three near-identical olives, and it wanders through the
 * yellow-brown band that turns muddy at this saturation. Choosing the hues keeps every pair
 * visibly different and keeps the muddy ones out.
 */
const AVATAR_HUES = [210, 260, 300, 340, 10, 30, 150, 175, 195];

/**
 * A stable tile colour for a name: one of {@link AVATAR_HUES}, at fixed saturation and lightness.
 *
 * Only the hue varies, and only at low saturation - the tiles have to be distinguishable at a
 * glance without becoming the loudest thing on a screen full of muted surfaces. Lightness is
 * pinned in the middle so the same white monogram stays legible in either theme.
 */
export function nameMonogramColor(name?: string | null): string {
    const source = name ?? "";
    let hash = 0;
    for (let index = 0; index < source.length; index++) {
        hash = (Math.imul(hash, 31) + source.charCodeAt(index)) >>> 0;
    }
    return `hsl(${AVATAR_HUES[hash % AVATAR_HUES.length]} 30% 44%)`;
}
