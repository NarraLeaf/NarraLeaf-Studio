/**
 * One width for every control in the settings pane.
 *
 * Each row used to size its own control, so the column was as wide as whatever happened to be in
 * it: a language dropdown showing `中文` came out 65px, the one below it 89, a source picker 192,
 * the font picker 224 — sixteen different widths down a single pane, all right-aligned, so every
 * left edge landed somewhere else and the gap between a label and its control changed on every
 * row. The widest of them is the floor: the font picker renders the chosen face inside its own
 * trigger and the source pickers hold addresses, and neither survives being narrowed.
 *
 * Controls that are not fields — a switch, an action button, the accent swatches — keep their own
 * size and sit at the right of this column rather than stretching across it.
 */
export const SETTING_CONTROL_WIDTH = "w-56";

/** The same width in pixels, for the popovers that have to match a trigger they cannot measure. */
export const SETTING_CONTROL_WIDTH_PX = 224;
