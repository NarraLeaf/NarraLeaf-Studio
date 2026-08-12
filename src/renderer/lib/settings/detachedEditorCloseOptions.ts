/**
 * Single source of truth for "what happens when a detached editor's window closes"
 * (`editor.detachedEditorOnClose`).
 *
 * Shared between the settings registry (`appSettings.ts`) and the consumer that applies it (the
 * workspace's detached-editor host) so the key, its values and its default never drift apart.
 */

/**
 * Where a popped-out editor goes when its window closes.
 *
 *  - `"restoreTab"` — back into the workspace as the tab it was before it was popped out. Popping
 *    out and closing become one reversible pair, and nothing is ever lost by trying it.
 *  - `"close"` — nowhere. Closing the window is closing the editor, the way it is for every other
 *    window on the desktop.
 */
export type DetachedEditorOnClose = "restoreTab" | "close";

/** Global-state key the preference is stored under. */
export const DETACHED_EDITOR_ON_CLOSE_KEY = "editor.detachedEditorOnClose" as const;

/** The two values, in the order the settings page offers them. */
export const DETACHED_EDITOR_ON_CLOSE_OPTIONS: readonly DetachedEditorOnClose[] = ["restoreTab", "close"];

/**
 * Back to a tab, by default.
 *
 * Popping an editor out is a change of view, not a decision about the document, and a view change
 * that can strand work behind a closed window is one authors learn not to use.
 */
export const DETACHED_EDITOR_ON_CLOSE_DEFAULT: DetachedEditorOnClose = "restoreTab";

/** Narrow an unknown stored value, falling back to the default. */
export function resolveDetachedEditorOnClose(stored: unknown): DetachedEditorOnClose {
    return DETACHED_EDITOR_ON_CLOSE_OPTIONS.includes(stored as DetachedEditorOnClose)
        ? stored as DetachedEditorOnClose
        : DETACHED_EDITOR_ON_CLOSE_DEFAULT;
}
