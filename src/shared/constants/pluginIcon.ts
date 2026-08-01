/**
 * Plugin icon rules.
 *
 * A plugin may ship one thumbnail, shown next to its name in the Launcher's
 * plugin list (installed and store alike). The constraints below are what makes
 * that list stay a list: every tile is the same square box, so one plugin cannot
 * make itself taller or wider than its neighbours by shipping a banner.
 */

/**
 * Extensions an icon may use, matched case-insensitively.
 *
 * Raster only, and deliberately short:
 * - `svg` is a document, not an image — it can carry script and external
 *   references, and it would render inside Studio's own window.
 * - `gif` is excluded because an animating row is a distraction the author of
 *   one plugin gets to impose on the whole list.
 */
export const PLUGIN_ICON_EXTENSIONS = ["png", "webp", "jpg", "jpeg"] as const;
export type PluginIconExtension = (typeof PLUGIN_ICON_EXTENSIONS)[number];

/** Longest edge. The icon is drawn at ~36-44 px, so this is already generous. */
export const PLUGIN_ICON_MAX_DIMENSION = 512;

/**
 * Shortest edge. Not a technical limit — a 16 px source scaled into a 44 px tile
 * is a blurred smear, and every plugin that ships one makes the list look broken.
 */
export const PLUGIN_ICON_MIN_DIMENSION = 64;

/** A 512x512 icon fits this many times over; anything past it is not an icon. */
export const PLUGIN_ICON_MAX_BYTES = 512 * 1024;
