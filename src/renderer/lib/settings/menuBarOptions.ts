/**
 * Single source of truth for how the workspace's menus are presented in the title bar.
 *
 * Shared between the settings registry (`appSettings.ts`) and the two places that read the stored
 * value (the workspace title bar and its right-click menu), so the option ids, the default and the
 * "what does an unreadable value mean" answer cannot drift apart.
 */

/** Global-state key; also the settings-registry key. */
export const MENU_BAR_MODE_KEY = "ui.menuBar.mode";

/**
 * `toolbar` - each menu is its own named dropdown in the title bar, beside the run controls.
 * `hamburger` - one button holds all of them, each menu a submenu inside it.
 *
 * There is deliberately no third value for a menu bar of its own on a row above the toolbar: a
 * second full-width strip is a row of chrome the workspace would carry on every screen, and the
 * two here already cover the choice it was there to offer (menus in reach, or menus out of the way).
 */
export type MenuBarMode = "toolbar" | "hamburger";

/** Option ids, in the order the settings row and the context menu list them. */
export const MENU_BAR_MODES: readonly MenuBarMode[] = ["hamburger", "toolbar"];

/**
 * One button - the arrangement Studio ships in.
 *
 * The title bar is the workspace's only full-width strip, and it already carries the project, the
 * run controls, the search box and the window's own buttons; three named dropdowns spend a fifth of
 * it on menus that are opened a few times a session. Nothing is lost by collapsing them: the rows,
 * their chords and their accelerators are the same in both arrangements, so Alt+F still opens File.
 *
 * An author who wants the menus named along the bar says so, in Appearance or on the strip's own
 * right-click menu.
 */
export const MENU_BAR_MODE_DEFAULT: MenuBarMode = "hamburger";

/** Read a persisted (untrusted) value, falling back to the default for anything unrecognised. */
export function resolveMenuBarMode(value: unknown): MenuBarMode {
    return MENU_BAR_MODES.includes(value as MenuBarMode) ? (value as MenuBarMode) : MENU_BAR_MODE_DEFAULT;
}
