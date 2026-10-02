/**
 * How the UI rail's interface list is laid out at a given width.
 *
 * The list used to be one column of tall cards whatever the rail's width: a name, three lines of
 * metadata and a 96px preview each, so at the default width one card filled most of the space the
 * list is given and a wide rail drew the same column with empty space either side of every preview.
 * It is now a grid of tiles that adds a column whenever another one fits, and below two columns a
 * list of rows with the preview as a thumbnail beside the name.
 *
 * Pure, so the breakpoints are stated in a test rather than discovered by dragging the rail.
 */

/** Space between cards, in both directions - Tailwind's `gap-2`. */
export const SURFACE_LIST_GAP = 8;

/**
 * The narrowest a tile may be.
 *
 * Chosen so the rail's default width holds two columns and its minimum width holds one: at 136px a
 * tile still shows a page's name in full for most names, and a 16:9 preview about 66px tall.
 */
export const SURFACE_TILE_MIN_WIDTH = 136;

/** A tile's border and padding on each side (`border` + `p-2`), which the preview sits inside. */
const TILE_CHROME_X = 1 + 8;

/** The thumbnail beside a row's name: 96 × 54, the 16:9 a page is designed at. */
export const SURFACE_ROW_THUMB_HEIGHT = 54;

/** Tile previews never shrink below this, so a page is never reduced to a smudge. */
const MIN_TILE_PREVIEW_HEIGHT = 56;
/** ...and never grow past this, so a very wide rail does not go back to one card per screen. */
const MAX_TILE_PREVIEW_HEIGHT = 160;

export type SurfaceListLayout =
    | { mode: "rows" }
    | { mode: "tiles"; columns: number; previewHeight: number };

/**
 * The layout for a list whose content box is `contentWidth` CSS pixels wide.
 *
 * Tiles take every column that fits at {@link SURFACE_TILE_MIN_WIDTH}; their preview is as tall as a
 * 16:9 picture as wide as the tile, so the common page shape fills it with no bars. One column of
 * tiles is never used: a single tile is the old card again, and a row with a thumbnail shows the same
 * things in a third of the height.
 */
export function resolveSurfaceListLayout(contentWidth: number): SurfaceListLayout {
    if (!Number.isFinite(contentWidth) || contentWidth <= 0) {
        return { mode: "rows" };
    }
    const columns = Math.floor((contentWidth + SURFACE_LIST_GAP) / (SURFACE_TILE_MIN_WIDTH + SURFACE_LIST_GAP));
    if (columns < 2) {
        return { mode: "rows" };
    }
    const tileWidth = (contentWidth - SURFACE_LIST_GAP * (columns - 1)) / columns;
    const previewWidth = tileWidth - TILE_CHROME_X * 2;
    const previewHeight = Math.min(
        MAX_TILE_PREVIEW_HEIGHT,
        Math.max(MIN_TILE_PREVIEW_HEIGHT, Math.round((previewWidth * 9) / 16)),
    );
    return { mode: "tiles", columns, previewHeight };
}
