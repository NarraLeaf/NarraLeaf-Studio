/**
 * View preferences of the built-in text editor.
 *
 * Both keys shipped a default years before anything read them; they are wired now rather than
 * removed (unlike the eleven in `RETIRED_GLOBAL_STATE_KEYS`) because the editor they describe
 * exists and honoring them is a Monaco option each. Their stored defaults happen to match
 * Monaco's own, so no profile changes behavior by this landing.
 */

export const EDITOR_LINE_NUMBERS_KEY = "editor.lineNumbers";
export const EDITOR_SOFT_WRAP_KEY = "editor.softWrap";

export const EDITOR_LINE_NUMBERS_DEFAULT = true;
export const EDITOR_SOFT_WRAP_DEFAULT = false;

export type TextEditorViewOptions = {
    lineNumbers: boolean;
    softWrap: boolean;
};

export const TEXT_EDITOR_VIEW_DEFAULTS: TextEditorViewOptions = {
    lineNumbers: EDITOR_LINE_NUMBERS_DEFAULT,
    softWrap: EDITOR_SOFT_WRAP_DEFAULT,
};

/** Persisted values are untrusted: anything that is not a boolean falls back to the default. */
export function resolveBooleanSetting(value: unknown, fallback: boolean): boolean {
    return typeof value === "boolean" ? value : fallback;
}
