/**
 * Single source of truth for the "highlight rows" preference (`editor.storyRowHighlight`).
 *
 * Shared between the settings registry (`appSettings.ts`) and the consumer that applies it (the story
 * scene editor's rows, through `useStoryRowHighlight`) so the key, its values and its default never
 * drift apart.
 */

/**
 * Which of the story editor's two layers wears a background tint (gutter 规范 §1).
 *
 * The layers themselves are not a preference — a row either gets performed or it does not, and the
 * gutter's mark says which either way. What IS a preference is whether that distinction should also
 * be painted, and which half of it should carry the paint:
 *
 *  - `"none"` — neither. The rows are one unbroken column and the gutter carries the whole
 *    distinction on its own.
 *  - `"script"` — the words that get spoken. For reading: the script lifts off the page and the
 *    machinery falls back into it.
 *  - `"command"` — the directives. For staging: the tinted rows are the ones being worked on, and a
 *    long run of them reads as one block instead of as a wall of individual lines.
 */
export type StoryRowHighlight = "none" | "script" | "command";

/** Global-state key the preference is stored under. */
export const STORY_ROW_HIGHLIGHT_KEY = "editor.storyRowHighlight" as const;

/** The three values, in the order the settings page offers them. */
export const STORY_ROW_HIGHLIGHT_OPTIONS: readonly StoryRowHighlight[] = ["none", "script", "command"];

/**
 * Neither layer, by default.
 *
 * The tint answers a question the gutter has already answered — a face means the line is spoken, a
 * bare glyph means it is not — so on a scene that is mostly script it is a band of grey that repeats
 * something the eye got for free. It earns its place on the scenes it was built for (staging-heavy
 * ones, where directives outnumber lines), which is exactly the case an author can recognise and turn
 * it on for. A default that paints every document to suit some of them is the wrong way round.
 */
export const STORY_ROW_HIGHLIGHT_DEFAULT: StoryRowHighlight = "none";

/** Narrow an unknown stored value to a highlight mode, falling back to the default. */
export function resolveStoryRowHighlight(stored: unknown): StoryRowHighlight {
    return STORY_ROW_HIGHLIGHT_OPTIONS.includes(stored as StoryRowHighlight)
        ? stored as StoryRowHighlight
        : STORY_ROW_HIGHLIGHT_DEFAULT;
}
