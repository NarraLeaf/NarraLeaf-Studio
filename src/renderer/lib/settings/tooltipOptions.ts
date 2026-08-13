/**
 * Single source of truth for the tooltip delay preference.
 *
 * Shared between the settings registry (`appSettings.ts`), the bootstrap that hands the value to the
 * tooltip controller (`lib/appearance`) and the controller's own clamp (`lib/tooltip`), so the
 * bounds can never drift.
 */

/** Global-state key; also the settings-registry key. */
export const TOOLTIP_DELAY_KEY = "ui.tooltipDelay";

/**
 * 0 is a real setting, not a disabled state: every tooltip appears the moment the pointer arrives.
 * The top of the range is roughly where Chromium's own bubble sat, for anyone who preferred it.
 */
export const TOOLTIP_DELAY_MIN_MS = 0;
export const TOOLTIP_DELAY_MAX_MS = 2000;
export const TOOLTIP_DELAY_STEP_MS = 50;

/**
 * Half of what the browser waited. Long enough that a pointer crossing a toolbar on its way
 * somewhere else leaves no trail of bubbles, short enough to be an answer rather than a wait -
 * and inside a `TooltipGroup` it is paid once for the whole strip.
 */
export const TOOLTIP_DELAY_DEFAULT_MS = 500;
