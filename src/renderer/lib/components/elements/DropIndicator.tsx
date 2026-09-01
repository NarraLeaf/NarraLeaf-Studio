import { cn } from "../../utils/cn";

export type DropEdge = "before" | "after";

export interface DropIndicatorProps {
    /** Which edge of the positioned parent the line sits on. */
    edge: DropEdge;
    /** Extra classes for the rare caller that has to nudge it; the line itself is not negotiable. */
    className?: string;
}

/**
 * The bar that says where a dragged row would land.
 *
 * **One component because a list with two levels of row draws it at both.** The story outline has
 * scenes inside chapters, and two hand-written spellings of "a line at this edge" is exactly how the
 * two levels came to look like two different kinds of hint - one full-bleed, one inset, and neither
 * reading as the same answer to the same question. A drop indicator is one thing in this app and it
 * is drawn here.
 *
 * ⚠ **`h-1` is a rendering decision, not a taste one.** At 125% Windows scaling a 2px line is 2.5
 * device pixels, and where it lands decides whether Chromium paints two rows or three - measured, in
 * this panel: the scene-level line came out 2 device rows and the chapter-level one 3, from the same
 * CSS box. That is the "one of them looks thicker" this component exists to end. 4px is a whole
 * number of device pixels at every scaling Windows offers (125% → 5, 150% → 6, 175% → 7), so both
 * levels paint the same bar.
 *
 * The parent must be positioned (`relative`); this fills its width and hangs on the named edge.
 */
export function DropIndicator({ edge, className }: DropIndicatorProps) {
    return (
        <div
            aria-hidden
            className={cn(
                "pointer-events-none absolute inset-x-0 z-10 h-1 rounded-full bg-primary",
                edge === "before" ? "top-0" : "bottom-0",
                className,
            )}
        />
    );
}
