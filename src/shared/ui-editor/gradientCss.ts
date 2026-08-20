import {
    DEFAULT_GRADIENT_ANGLE,
    DEFAULT_GRADIENT_CENTER,
    DEFAULT_GRADIENT_RADIUS,
    type GradientFill,
} from "@shared/types/ui-editor/gradientFill";

/**
 * The gradient's geometry, as one `background-image` value - and only the geometry.
 *
 * **Why the colours arrive already resolved.** Studio has two copies of the colour helpers, one for
 * the editor (`properties/framework/utils/colorUtils.ts`) and one for the shipped game
 * (`src/runtime/renderer/shims/colorUtils.ts`), because the two hosts resolve a brand link against
 * different things. `@shared` is the one Studio tree the runtime bundle may import, so putting the
 * resolver in here is not an option - but putting the *gradient* in here is exactly the point: each
 * host resolves its own colours and both then produce byte-identical CSS from the same numbers,
 * which is what makes "it looks the same in Dev Mode and in the build" a property rather than a
 * hope. Nothing in this file may import from `@/…`.
 *
 * **Why nothing here measures the element.** All three kinds emit percentages, which resolve against
 * the painted box, so the render path never needs the widget's pixel size - and a widget inside a
 * `stack` or `scroll` container has no authored size to read anyway, so wanting one would mean
 * measuring in the hot path. That constraint is the whole reason the v1 vector is cheap, and it is
 * what defers free start/end handles (a vector detached from the box needs both endpoints projected
 * onto the gradient line, in pixels), rotated radial ellipses, `repeating-*` and interpolation hints
 * such as `in oklab`. Adding any of those here is a design change, not a tweak.
 */

/** A stop whose colour the caller has already resolved to something CSS can paint. */
export type ResolvedGradientStop = {offset: number; color: string};

/**
 * At most two decimals.
 *
 * These strings sit in the render path of a versioned document, and `50.000000000000004%` is churn
 * in a diff and a wasted style recalculation for a difference no eye resolves.
 */
function round2(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.round(value * 100) / 100;
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * The stop list, as CSS.
 *
 * Order is left as the caller wrote it. `normalizeGradientFill` has already sorted a stored
 * gradient, and CSS itself clamps a stop that runs backwards up to its predecessor, so re-sorting
 * here would cost a sort on every repaint to change nothing.
 */
function stopsToCss(stops: readonly ResolvedGradientStop[]): string {
    return stops
        .map((stop) => `${stop.color} ${round2(clamp01(stop.offset) * 100)}%`)
        .join(", ");
}

/**
 * A solid colour, still spelled as a gradient.
 *
 * The contract is one property with one shape: whatever the caller passes, the answer is valid for
 * `background-image`. Returning a bare colour for the degenerate cases would push a branch - and a
 * second CSS property - into every call site, and the fill layer would then have to know which of
 * the two it was holding.
 */
function solid(color: string): string {
    return `linear-gradient(${color}, ${color})`;
}

/**
 * Build the `background-image` value for `fill`, painted with `stops`.
 *
 * `stops` is the authority on colour and `fill` on geometry; the caller resolves `fill.stops` into
 * `stops` and the two are expected to line up, which is also why a caller may hand over a shorter
 * list than the fill carries without this throwing.
 *
 * Degenerate input still answers with a valid value. No stops paints nothing - `transparent` at both
 * ends, rather than an empty string that would leave whatever the layer held before it standing -
 * and one stop, or a geometry with no length, paints that colour flat.
 */
export function gradientToCss(fill: GradientFill, stops: readonly ResolvedGradientStop[]): string {
    if (stops.length === 0) {
        return solid("transparent");
    }
    if (stops.length === 1) {
        return solid(stops[0].color);
    }

    const angle = round2(
        typeof fill.angle === "number" && Number.isFinite(fill.angle) ? fill.angle : DEFAULT_GRADIENT_ANGLE,
    );
    const center = fill.center ?? DEFAULT_GRADIENT_CENTER;
    const cx = round2(clamp01(center.x) * 100);
    const cy = round2(clamp01(center.y) * 100);
    const body = stopsToCss(stops);

    switch (fill.kind) {
        case "radial": {
            const radius = fill.radius ?? DEFAULT_GRADIENT_RADIUS;
            const rx = round2(clamp01(radius.x) * 100);
            const ry = round2(clamp01(radius.y) * 100);
            if (rx <= 0 || ry <= 0) {
                // A radius of nothing has no gradient line to lay the stops along, and CSS has no
                // useful answer for it either. The last stop is the colour that would have filled
                // everything outside the ellipse, so it is the one that stays.
                return solid(stops[stops.length - 1].color);
            }
            return `radial-gradient(ellipse ${rx}% ${ry}% at ${cx}% ${cy}%, ${body})`;
        }
        case "conic":
            return `conic-gradient(from ${angle}deg at ${cx}% ${cy}%, ${body})`;
        case "linear":
        default:
            // `default` is not dead: a document written by a later version can carry a kind this
            // build has never heard of, and linear is the reading that still paints every stop.
            return `linear-gradient(${angle}deg, ${body})`;
    }
}
