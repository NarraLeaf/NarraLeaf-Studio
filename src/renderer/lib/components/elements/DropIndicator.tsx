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
 * ⚠ **2px is not exact at every display scaling and that is accepted.** At 125% it is 2.5 device
 * pixels, so Chromium paints two rows or three depending on where the row it hangs from happens to
 * sit; 4px would be exact at every scaling Windows offers, and was tried, and reads as a slab. What
 * made the difference visible was two lines being on screen to compare - a list that draws one line
 * at a time has nothing to compare it against.
 *
 * The parent must be positioned (`relative`); this fills its width and hangs on the named edge.
 */
export function DropIndicator({ edge, className }: DropIndicatorProps) {
    return (
        <div
            aria-hidden
            className={cn(
                "pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded-full bg-primary",
                edge === "before" ? "top-0" : "bottom-0",
                className,
            )}
        />
    );
}
