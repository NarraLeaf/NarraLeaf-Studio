/**
 * Single source of truth for the "hide parameter names" preference (`editor.hideParamNames`).
 *
 * Shared between the settings registry (`appSettings.ts`) and the consumer that applies it (the story
 * scene editor's committed rows, through `useHideParamNames` and `StoryCommandLineProvider`) so the key
 * and its default never drift.
 */

/** Global-state key the preference is stored under. */
export const HIDE_PARAM_NAMES_KEY = "editor.hideParamNames" as const;

/**
 * Off: a committed row prints the line in full, keys and all.
 *
 * The keys are what make a row unambiguous — `1` beside `0.8` says nothing about which is the fade and
 * which the volume — so an author who never opens the setting keeps the readable form.
 */
export const HIDE_PARAM_NAMES_DEFAULT = false;
