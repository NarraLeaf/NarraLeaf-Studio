/**
 * Single source of truth for the Story editor font preference options.
 *
 * Shared between the settings registry (`appSettings.ts`) and the consumer that applies the
 * preference to the scene editor (`storyEditorTextStyle.tsx`) so the option keys can never drift.
 */

/** Selectable font families. Values double as their own display labels (proper case, stable). */
export const EDITOR_FONT_FAMILY_OPTIONS = ["Default", "Sans Serif", "Serif", "Monospace"] as const;

export type EditorFontFamilyOption = typeof EDITOR_FONT_FAMILY_OPTIONS[number];

export const EDITOR_FONT_SIZE_MIN = 8;
export const EDITOR_FONT_SIZE_MAX = 48;
export const EDITOR_FONT_SIZE_DEFAULT = 14;
export const EDITOR_FONT_FAMILY_DEFAULT: EditorFontFamilyOption = "Default";
