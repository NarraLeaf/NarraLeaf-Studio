/**
 * A gradient a widget can be filled with, stored beside {@link import("./imageFill").ImageFill} and
 * selected by the same `fillType` seam.
 *
 * **Why a gradient is a fill and never a colour.** A stored colour resolves to one CSS colour string
 * and is then used in places that accept a colour and nothing else - `backgroundColor`,
 * `outlineColor`, the four `border*Color`s, the inset box-shadow that draws an inside stroke. A
 * gradient put through that path does not paint wrong, it makes the whole declaration invalid,
 * silently, one site at a time. So the choice is made once by `fillType` rather than re-decided at
 * every colour input, and nothing here ever reaches a colour consumer.
 *
 * **Why a stop's colour is an ordinary stored colour string.** It means a stop may hold
 * `nlbrand:primary` like any other colour field, so `parseColorValue`/`serializeColorValue` are
 * reused per stop with no new colour code, and `brandReferences.ts` - which tests every string in
 * the document rather than a whitelist of props - already counts a brand-linked stop in the delete
 * confirmation and already reports it through the `brand/broken-link` lint rule. Resolving those
 * strings is the host's job, not this file's: the editor and the game runtime each own a copy of
 * the colour helpers, and this module has no idea which one is asking.
 */

export type GradientKind = "linear" | "radial" | "conic";

export const GRADIENT_KINDS: readonly GradientKind[] = ["linear", "radial", "conic"];

export interface GradientStop {
    /** 0..1 along the gradient line. */
    offset: number;
    /**
     * A stored colour string: a literal, or `nlbrand:<id>[/<alpha>]`. Deliberately unresolved - see
     * the file comment.
     */
    color: string;
}

export interface GradientFill {
    kind: GradientKind;
    /** Normalised to two or more, sorted by offset, offsets clamped to 0..1. */
    stops: GradientStop[];
    /** Linear and conic. Degrees, CSS convention: 0 points to the top, 90 to the right. */
    angle?: number;
    /** Radial and conic. 0..1 of the painted box. */
    center?: {x: number; y: number};
    /** Radial. 0..1 of the painted box, one radius per axis. */
    radius?: {x: number; y: number};
}

/**
 * The fallbacks for the optional fields, exported because two files need to agree on them: this one
 * writes them into a new gradient, and `@shared/ui-editor/gradientCss.ts` substitutes them for a
 * field a stored gradient simply does not carry. A gradient authored as linear has no reason to
 * store a centre, so the CSS builder must be able to answer for one without a second opinion.
 */
export const DEFAULT_GRADIENT_ANGLE = 180;
export const DEFAULT_GRADIENT_CENTER: {x: number; y: number} = {x: 0.5, y: 0.5};
export const DEFAULT_GRADIENT_RADIUS: {x: number; y: number} = {x: 0.5, y: 0.5};

/**
 * The gradient a widget gets when the author first switches its fill to one.
 *
 * Top-to-bottom, because that is the direction a reader of a left-to-right or a vertical script both
 * read a panel in, and the two seeded brand slots, so the first thing the author sees is their own
 * project's colours rather than a stock blue - and a palette edit visibly moves it, which is the
 * behaviour the rest of the feature depends on.
 *
 * Treat it as immutable. `normalizeGradientFill` always answers with fresh objects, so nothing in
 * the read path hands this array out by reference.
 */
export const DEFAULT_GRADIENT_FILL: GradientFill = {
    kind: "linear",
    angle: DEFAULT_GRADIENT_ANGLE,
    stops: [
        {offset: 0, color: "nlbrand:primary"},
        {offset: 1, color: "nlbrand:secondary"},
    ],
};

function isGradientKind(value: unknown): value is GradientKind {
    return typeof value === "string" && (GRADIENT_KINDS as readonly string[]).includes(value);
}

function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** A 0..1 pair, or `undefined` when the field is absent or unreadable. */
function normalizePoint(raw: unknown): {x: number; y: number} | undefined {
    if (!raw || typeof raw !== "object") {
        return undefined;
    }
    const {x, y} = raw as {x?: unknown; y?: unknown};
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
        return undefined;
    }
    return {x: clamp01(x), y: clamp01(y)};
}

/**
 * Read stored stops.
 *
 * A stop with no colour is dropped: there is nothing to paint and nothing to repair it towards. A
 * stop whose offset is missing or not finite keeps its colour and takes 0, because the loss there is
 * a position - which the author can see and drag back - where dropping the stop would lose the
 * colour, which they cannot get back.
 *
 * The sort is `Array.prototype.sort`, which is stable, so two stops at the same offset keep the
 * order they were written in. That pair is how a hard stop is spelled, and reversing it reverses
 * which side of the line each colour lands on.
 */
function normalizeStops(raw: unknown): GradientStop[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const stops: GradientStop[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== "object") {
            continue;
        }
        const {offset, color} = entry as {offset?: unknown; color?: unknown};
        if (typeof color !== "string" || color.trim() === "") {
            continue;
        }
        const usableOffset = typeof offset === "number" && Number.isFinite(offset) ? clamp01(offset) : 0;
        stops.push({offset: usableOffset, color: color.trim()});
    }
    return stops.sort((a, b) => a.offset - b.offset);
}

/**
 * Read a stored gradient, or `undefined` for anything that is not one.
 *
 * These documents are on disk and versioned, so a hand-edit or a bad merge can put anything in this
 * field. Every field is therefore read defensively and nothing here throws - a gradient that cannot
 * be read answers `undefined` and the caller falls back exactly as it does for an absent field,
 * which is what `coerceImageFill` does on the image side.
 *
 * The two refusals are the ones with no honest repair: an unknown `kind`, because a gradient
 * authored by a later version would otherwise be silently redrawn as a different shape than the one
 * its author saw; and a stop list nothing usable survived, because there is no colour left to guess
 * from. Everything else is repaired - offsets clamped and sorted, a single stop padded to the pair
 * CSS needs, a nonsense angle or centre dropped so the documented default stands in.
 *
 * Absent optionals stay absent rather than being written out. A linear gradient carrying a centre it
 * does not use is a diff row about nothing, and the CSS builder substitutes the same defaults this
 * file exports.
 */
export function normalizeGradientFill(raw: unknown): GradientFill | undefined {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return undefined;
    }
    const source = raw as Partial<GradientFill>;
    if (!isGradientKind(source.kind)) {
        return undefined;
    }
    const stops = normalizeStops(source.stops);
    if (stops.length === 0) {
        return undefined;
    }
    if (stops.length === 1) {
        // One colour is a solid, and a solid is the pair repeated - see `gradientToCss`, which
        // answers the same way rather than emitting a bare colour into `background-image`.
        stops.push({...stops[0]});
    }

    const fill: GradientFill = {kind: source.kind, stops};
    if (typeof source.angle === "number" && Number.isFinite(source.angle)) {
        fill.angle = source.angle;
    }
    const center = normalizePoint(source.center);
    if (center) {
        fill.center = center;
    }
    const radius = normalizePoint(source.radius);
    if (radius) {
        fill.radius = radius;
    }
    return fill;
}

/**
 * Whether a value already is a usable gradient.
 *
 * This is the narrowing check - telling a `GradientFill` from an `ImageFill` or a colour string in a
 * union that carries all three - and not a substitute for {@link normalizeGradientFill}, which is
 * the read-from-disk path. It holds for everything `normalizeGradientFill` returns, so a value that
 * has been through there never needs to go through here.
 */
export function isGradientFill(raw: unknown): raw is GradientFill {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return false;
    }
    const source = raw as Partial<GradientFill>;
    if (!isGradientKind(source.kind) || !Array.isArray(source.stops) || source.stops.length < 2) {
        return false;
    }
    for (const stop of source.stops) {
        if (!stop || typeof stop !== "object") {
            return false;
        }
        const {offset, color} = stop as {offset?: unknown; color?: unknown};
        if (typeof offset !== "number" || !Number.isFinite(offset) || typeof color !== "string" || color === "") {
            return false;
        }
    }
    if (source.angle !== undefined && (typeof source.angle !== "number" || !Number.isFinite(source.angle))) {
        return false;
    }
    if (source.center !== undefined && !normalizePoint(source.center)) {
        return false;
    }
    if (source.radius !== undefined && !normalizePoint(source.radius)) {
        return false;
    }
    return true;
}
