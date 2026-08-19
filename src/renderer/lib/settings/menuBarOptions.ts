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
 * Named dropdowns - what the title bar has always drawn.
 *
 * A default that collapsed them would move every author's File menu on an update, and the author
 * who wants the room can say so; the one who never opens this setting keeps what they know.
 */
export const MENU_BAR_MODE_DEFAULT: MenuBarMode = "toolbar";

/** Read a persisted (untrusted) value, falling back to the default for anything unrecognised. */
export function resolveMenuBarMode(value: unknown): MenuBarMode {
    return MENU_BAR_MODES.includes(value as MenuBarMode) ? (value as MenuBarMode) : MENU_BAR_MODE_DEFAULT;
}
