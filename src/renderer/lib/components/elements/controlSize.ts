/**
 * The one size scale every Studio control shares.
 *
 * Before this existed each component derived its own height from padding plus a
 * font size, so two controls asking for the same `size` did not agree: `Button`
 * had no border and `Input` had one, which alone made a `size="sm"` button 2px
 * shorter than the field beside it, and `Select` - a `Button` wearing an input's
 * border colours - was shorter still because it never drew the border at all.
 * A row of "the same size" controls therefore never lined up, and call sites
 * papered over it one at a time (`className="h-9 min-h-[34px] py-0"`,
 * `[&>button]:h-9`), each with a slightly different number.
 *
 * So the height is stated here instead of emerging from padding:
 *
 * | size | height | used for |
 * |------|--------|----------|
 * | `sm` | 28px   | dense panels, toolbars, inspector rows - Studio's default |
 * | `md` | 36px   | dialogs and forms |
 * | `lg` | 40px   | the rare full-width call to action |
 *
 * `min-h-*` rather than `h-*`: for every normal single-line control the content
 * is shorter than the floor, so the floor *is* the height and two controls of
 * the same size are pixel-identical whether or not they carry a border. A label
 * that wraps - a long translation in a narrow full-width button - then grows the
 * control instead of spilling out of it.
 *
 * Comments in English per project convention.
 */

export type ControlSize = "sm" | "md" | "lg";

/**
 * Height floor, horizontal padding and type scale for a text-height control
 * (button, input, select trigger).
 *
 * The vertical padding is deliberately small: it never decides the height of a
 * single-line control, it only keeps wrapped text off the edges.
 */
export const CONTROL_SIZE_CLASS: Record<ControlSize, string> = {
    sm: "min-h-7 px-2 py-1 text-xs",
    md: "min-h-9 px-3 py-1 text-sm",
    lg: "min-h-10 px-4 py-1 text-base",
};

/**
 * The same scale as a square: an icon-only button is as tall as the control it
 * sits next to, and as wide as it is tall.
 */
export const CONTROL_SQUARE_CLASS: Record<ControlSize, string> = {
    sm: "h-7 w-7",
    md: "h-9 w-9",
    lg: "h-10 w-10",
};

/** Height floor alone, for a hand-rolled control that brings its own padding. */
export const CONTROL_HEIGHT_CLASS: Record<ControlSize, string> = {
    sm: "min-h-7",
    md: "min-h-9",
    lg: "min-h-10",
};
