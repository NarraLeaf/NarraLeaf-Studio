import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge, validators } from "tailwind-merge";

/**
 * tailwind-merge is taught about the design-system tokens defined in
 * `tailwind.config.js` so that conflicting utilities resolve last-wins.
 * Without this, `cn("bg-surface-raised", "bg-surface")` would keep BOTH
 * classes and let stylesheet source order decide the winner unpredictably.
 *
 * Keep this list in sync with the `colors` / `fontSize` extensions in
 * `tailwind.config.js`.
 *
 * The outline groups are overridden because tailwind-merge 3 describes Tailwind 4, where a bare
 * `outline` is a width. In the Tailwind 3 this app builds with, `outline` is the outline *style*
 * (`outline-style: solid`) and `outline-1`/`outline-2` are widths. Left to its defaults the merge
 * treats `outline outline-2` as two widths, keeps the last and drops the style - and an outline
 * with no style is never drawn (the Switch focus ring and the change marks' selection were lost
 * that way).
 */
const twMerge = extendTailwindMerge({
    override: {
        classGroups: {
            "outline-style": [{ outline: ["", "solid", "dashed", "dotted", "double", "none", "hidden"] }],
            "outline-w": [{
                outline: [validators.isNumber, validators.isArbitraryVariableLength, validators.isArbitraryLength],
            }],
        },
    },
    extend: {
        theme: {
            color: [
                "primary",
                "surface",
                "surface-canvas",
                "surface-sunken",
                "surface-raised",
                "surface-overlay",
                "fg",
                "fg-muted",
                "fg-subtle",
                "edge",
                "edge-subtle",
                "edge-strong",
                "fill",
                "fill-subtle",
                "fill-strong",
                "binding",
                "danger",
                "success",
                "warning",
            ],
            text: ["2xs"],
        },
    },
});

/**
 * Merge class names with clsx (conditional/array support) and then
 * tailwind-merge (conflict resolution). The single canonical way to combine
 * Tailwind classes in Studio - prefer this over string concatenation so that
 * a caller-supplied `className` can reliably override a component's base
 * utilities.
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
