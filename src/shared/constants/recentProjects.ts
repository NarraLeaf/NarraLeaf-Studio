/**
 * How long the recently-opened history is allowed to be.
 *
 * Shared because both sides need the same numbers: `RecentlyOpened` in the main process clamps
 * writes by them, and the settings row shows them as the field's range. The setting itself has
 * been read since the history existed - it simply had no control anywhere, which is why a value
 * outside this range is perfectly possible on an existing profile and has to be tolerated on read
 * rather than assumed away.
 */

export const RECENT_PROJECTS_LIMIT_DEFAULT = 10;
export const RECENT_PROJECTS_LIMIT_MIN = 1;
/**
 * The native Open Recent submenu is built from this list, and a menu longer than a screen is not
 * a feature. Nothing enforces this ceiling on a hand-edited store; it is what the field offers.
 */
export const RECENT_PROJECTS_LIMIT_MAX = 50;
