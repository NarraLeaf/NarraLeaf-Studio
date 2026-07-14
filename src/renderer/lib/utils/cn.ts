import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge is taught about the design-system tokens defined in
 * `tailwind.config.js` so that conflicting utilities resolve last-wins.
 * Without this, `cn("bg-surface-raised", "bg-surface")` would keep BOTH
 * classes and let stylesheet source order decide the winner unpredictably.
 *
 * Keep this list in sync with the `colors` / `fontSize` extensions in
 * `tailwind.config.js`.
 */
const twMerge = extendTailwindMerge({
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
 * Tailwind classes in Studio — prefer this over string concatenation so that
 * a caller-supplied `className` can reliably override a component's base
 * utilities.
 */
export function cn(...inputs: ClassValue[]): string {
    return twMerge(clsx(inputs));
}
