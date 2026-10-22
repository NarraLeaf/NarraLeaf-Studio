import type { StoryTextOutline } from "@shared/types/story";

/** The widest outline a row may ask for, in design pixels. Each pixel is four more filter terms. */
export const STORY_TEXT_OUTLINE_MAX_WIDTH = 8;

/** The colour an outline takes when the line names a width alone. */
export const STORY_TEXT_OUTLINE_DEFAULT_COLOR = "#000000";

/**
 * The CSS `filter` chain that draws an outline round a text's glyphs, or `"none"` for no outline.
 *
 * Built from offset `drop-shadow()`s rather than `text-shadow`, because `filter` is a channel the
 * engine's transform bag already carries for every displayable. One pass of four shadows - right,
 * left, down, up, each shadowing the result of the one before - dilates the glyphs by its step in
 * every direction, corners included, which is what a Ren'Py outline is. A wider outline runs one pass
 * per pixel so the ring stays solid instead of splitting into four offset copies.
 */
export function storyTextOutlineFilter(outline: StoryTextOutline | null | undefined): string {
    if (!outline || !(outline.width > 0)) {
        return "none";
    }
    const width = Math.min(outline.width, STORY_TEXT_OUTLINE_MAX_WIDTH);
    const passes = Math.max(1, Math.ceil(width));
    const step = Number((width / passes).toFixed(3));
    const color = outline.color.trim() || STORY_TEXT_OUTLINE_DEFAULT_COLOR;
    const pass = [
        `drop-shadow(${step}px 0 0 ${color})`,
        `drop-shadow(-${step}px 0 0 ${color})`,
        `drop-shadow(0 ${step}px 0 ${color})`,
        `drop-shadow(0 -${step}px 0 ${color})`,
    ].join(" ");
    return Array.from({ length: passes }, () => pass).join(" ");
}
