/**
 * How a stack of collapsible sections shares one panel's height - the arithmetic behind
 * `SectionStack`, kept pure so the rules are stated in a test rather than found by dragging.
 *
 * The panel never scrolls. Its height goes, in order, to every section's header, to a 1px seam under
 * each open body that has a section after it, and what is left - the room - to the open bodies. Each
 * body scrolls on its own, so a body is only ever as tall as the room it is given.
 *
 * How the room is shared:
 * - A section the author has sized keeps that size; one they have not opens at its default.
 * - The fill section, when there is one and it is open, takes whatever is left over, more or less.
 *   It is the panel's subject, so a taller window grows it and leaves the sections the author sized
 *   alone - and a shorter one shrinks it first.
 * - Once the fill section is down to its minimum, the others give way, each in proportion to what it
 *   has above its own minimum, so every one of them reaches its minimum together.
 * - Without an open fill section, the open sections share the room in proportion to their sizes.
 * - When not even the minimums fit, every open body gets its minimum's share of what there is. The
 *   headers never give way: each section stays reachable however short the panel gets.
 */

/** A header's height in CSS pixels, border included - `h-9`. */
export const SECTION_HEADER_HEIGHT = 36;
/** The seam under an open body that has another section after it. */
export const SECTION_DIVIDER_HEIGHT = 1;

export type SectionStackSpec = {
    readonly id: string;
    /** The smallest a body is laid out at while there is room for every open section's minimum. */
    readonly minSize: number;
    /** What a body opens at until the author sizes it. */
    readonly defaultSize: number;
};

export type SectionStackEntry = {
    readonly spec: SectionStackSpec;
    readonly open: boolean;
    /** The body height the author left it at, or undefined when they never sized it. */
    readonly size: number | undefined;
};

/** A stored size worth using: a positive, finite number of pixels. */
export function isUsableSectionSize(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** Whether a seam is drawn under section `index`: it is open and something comes after it. */
export function hasDividerAfter(open: readonly boolean[], index: number): boolean {
    return open[index] === true && index < open.length - 1;
}

/** Everything in the panel that is not a body: the headers and the seams. */
export function sectionStackChromeHeight(open: readonly boolean[]): number {
    let dividers = 0;
    for (let index = 0; index < open.length; index++) {
        if (hasDividerAfter(open, index)) {
            dividers++;
        }
    }
    return open.length * SECTION_HEADER_HEIGHT + dividers * SECTION_DIVIDER_HEIGHT;
}

/**
 * The two bodies the seam under section `index` resizes: that section, and the next open one below
 * it - past any closed sections in between, whose headers simply ride along. Null when nothing below
 * is open, which leaves the seam a line.
 */
export function sashNeighbours(open: readonly boolean[], index: number): { upper: number; lower: number } | null {
    if (!hasDividerAfter(open, index)) {
        return null;
    }
    for (let lower = index + 1; lower < open.length; lower++) {
        if (open[lower]) {
            return { upper: index, lower };
        }
    }
    return null;
}

/**
 * Whole pixels for `values`, summing to exactly `total`: each value rounded down, and the pixels
 * that leaves over given to the largest remainders, ties to the later section.
 */
function roundToTotal(values: number[], total: number): number[] {
    const floors = values.map(value => Math.max(0, Math.floor(value)));
    let left = total - floors.reduce((sum, value) => sum + value, 0);
    const order = values
        .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
        .sort((a, b) => b.remainder - a.remainder || b.index - a.index);
    for (let step = 0; left > 0 && order.length > 0; step = (step + 1) % order.length) {
        floors[order[step]!.index]++;
        left--;
    }
    return floors;
}

/** Share `total` among `weights` in proportion; equally when they are all zero. */
function share(total: number, weights: number[]): number[] {
    const sum = weights.reduce((acc, weight) => acc + weight, 0);
    const raw = sum > 0
        ? weights.map(weight => (total * weight) / sum)
        : weights.map(() => total / weights.length);
    return roundToTotal(raw, total);
}

/**
 * Bring `sizes` down to `total`, which is at least the sum of `mins`: each gives up a part of what it
 * has above its own minimum, the same part for all of them.
 */
function shrinkTo(total: number, sizes: number[], mins: number[]): number[] {
    const slack = sizes.map((size, index) => size - mins[index]!);
    const slackSum = slack.reduce((acc, value) => acc + value, 0);
    const excess = sizes.reduce((acc, value) => acc + value, 0) - total;
    if (excess <= 0 || slackSum <= 0) {
        return sizes;
    }
    const keep = 1 - excess / slackSum;
    return roundToTotal(sizes.map((_, index) => mins[index]! + slack[index]! * keep), total);
}

/**
 * Each section's body height in whole pixels - 0 for a closed one - for `room` pixels of bodies.
 * See the module comment for the rules; `fillIndex` is the fill section, or -1 for none.
 */
export function resolveSectionStackLayout(
    room: number,
    entries: readonly SectionStackEntry[],
    fillIndex = -1,
): number[] {
    const result = entries.map(() => 0);
    const total = Math.max(0, Math.floor(room));
    const openIndices = entries.flatMap((entry, index) => (entry.open ? [index] : []));
    if (openIndices.length === 0 || total === 0) {
        return result;
    }
    const minOf = (index: number) => Math.max(0, Math.round(entries[index]!.spec.minSize));
    // A stored size below the minimum is read as the minimum: the minimum is the floor whenever
    // there is room for it, whatever was written down when there was not.
    const preferredOf = (index: number) => {
        const entry = entries[index]!;
        const size = isUsableSectionSize(entry.size) ? Math.round(entry.size) : Math.round(entry.spec.defaultSize);
        return Math.max(minOf(index), size);
    };
    const assign = (indices: number[], sizes: number[]) => {
        indices.forEach((index, at) => {
            result[index] = sizes[at]!;
        });
    };

    const mins = openIndices.map(minOf);
    const minSum = mins.reduce((acc, value) => acc + value, 0);
    if (minSum >= total) {
        assign(openIndices, share(total, mins));
        return result;
    }

    if (fillIndex >= 0 && entries[fillIndex]?.open) {
        const others = openIndices.filter(index => index !== fillIndex);
        const preferred = others.map(preferredOf);
        const left = total - preferred.reduce((acc, value) => acc + value, 0);
        if (left >= minOf(fillIndex)) {
            assign(others, preferred);
            result[fillIndex] = left;
            return result;
        }
        result[fillIndex] = minOf(fillIndex);
        assign(others, shrinkTo(total - minOf(fillIndex), preferred, others.map(minOf)));
        return result;
    }

    const preferred = openIndices.map(preferredOf);
    const preferredSum = preferred.reduce((acc, value) => acc + value, 0);
    assign(
        openIndices,
        preferredSum <= total ? share(total, preferred) : shrinkTo(total, preferred, mins),
    );
    return result;
}

/**
 * Move `delta` pixels from the body below a seam to the body above it (a negative delta the other
 * way), stopping where either reaches its minimum - or where it already is, if the panel had it
 * squeezed below that. Returns the new sizes and how much of `delta` was applied.
 */
export function resizeSectionPair(
    sizes: readonly number[],
    upper: number,
    lower: number,
    delta: number,
    mins: readonly number[],
): { sizes: number[]; applied: number } {
    const upperSize = sizes[upper] ?? 0;
    const lowerSize = sizes[lower] ?? 0;
    const upperFloor = Math.min(mins[upper] ?? 0, upperSize);
    const lowerFloor = Math.min(mins[lower] ?? 0, lowerSize);
    const applied = Math.round(Math.min(lowerSize - lowerFloor, Math.max(upperFloor - upperSize, delta)));
    const next = sizes.slice();
    next[upper] = upperSize + applied;
    next[lower] = lowerSize - applied;
    return { sizes: next, applied };
}
