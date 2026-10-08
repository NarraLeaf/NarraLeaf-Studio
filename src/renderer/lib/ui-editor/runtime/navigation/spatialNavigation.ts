/**
 * Which control a direction goes to, from where the controls are drawn.
 *
 * Pure: boxes in, a choice out. The DOM half (`focusNavigation.ts`) measures the controls and says
 * which groups each one is in; this decides. Kept apart so the rule can be read and tested without a
 * page, and so the editor's preview of where each arrow goes can ask the same question later.
 *
 * ## The rule
 *
 * A control is a candidate for "down" when it lies further down than the current one - its centre
 * below the current centre and its bottom edge below the current bottom edge, so a control that only
 * overlaps the current one from above is not "down" from it. Among the candidates the nearest wins,
 * where near is the gap along the direction plus twice the gap across it. Twice, because the eye
 * reads a control straight below as "the one below" even when one off to the side is a little
 * closer: a grid moves along its columns, and a column of buttons beside a list does not steal the
 * list's next row. Overlapping across the direction counts as no gap at all.
 *
 * ## Groups
 *
 * A control can sit inside groups (`UIElementNavigation.region`), outermost first. A move is tried in
 * the innermost group first and only leaves it when nothing inside lies that way - then the group
 * around that, and so on out to the whole surface. A group that wraps never leaves: running out of
 * room one way comes back round from the other side, still inside it. The surface itself can wrap
 * the same way, once nothing at all lies in that direction.
 *
 * Comments in English per project convention.
 */

import type { UINavigationDirection } from "@shared/types/ui-editor/navigation";

export type NavigationRect = {
    left: number;
    top: number;
    right: number;
    bottom: number;
};

export type NavigationRegionRef = {
    key: string;
    wrap: boolean;
};

export type NavigationCandidate<T = unknown> = {
    /** Whatever the caller needs back - an element, an id. Compared by identity. */
    target: T;
    rect: NavigationRect;
    /** The groups it is inside, outermost first. */
    regions: readonly NavigationRegionRef[];
};

/** How far a box has to move past another before it counts as "further", in pixels. */
const EPSILON = 0.5;

/** The weight of the gap across a direction against the gap along it. See the module comment. */
const CROSS_WEIGHT = 2;

function centerX(rect: NavigationRect): number {
    return (rect.left + rect.right) / 2;
}

function centerY(rect: NavigationRect): number {
    return (rect.top + rect.bottom) / 2;
}

function isVertical(direction: UINavigationDirection): boolean {
    return direction === "up" || direction === "down";
}

/** Whether `rect` lies further along `direction` than `from`. */
export function liesInDirection(from: NavigationRect, rect: NavigationRect, direction: UINavigationDirection): boolean {
    switch (direction) {
        case "down":
            return centerY(rect) > centerY(from) + EPSILON && rect.bottom > from.bottom + EPSILON;
        case "up":
            return centerY(rect) < centerY(from) - EPSILON && rect.top < from.top - EPSILON;
        case "right":
            return centerX(rect) > centerX(from) + EPSILON && rect.right > from.right + EPSILON;
        case "left":
            return centerX(rect) < centerX(from) - EPSILON && rect.left < from.left - EPSILON;
    }
}

/** The gap between two intervals, zero when they overlap. */
function intervalGap(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
    if (aEnd < bStart) {
        return bStart - aEnd;
    }
    if (bEnd < aStart) {
        return aStart - bEnd;
    }
    return 0;
}

/** Gap along the direction, gap across it, and the distance between centres for ties. */
function distanceInDirection(from: NavigationRect, rect: NavigationRect, direction: UINavigationDirection): number {
    let along: number;
    switch (direction) {
        case "down":
            along = rect.top - from.bottom;
            break;
        case "up":
            along = from.top - rect.bottom;
            break;
        case "right":
            along = rect.left - from.right;
            break;
        case "left":
            along = from.left - rect.right;
            break;
    }
    const across = isVertical(direction)
        ? intervalGap(from.left, from.right, rect.left, rect.right)
        : intervalGap(from.top, from.bottom, rect.top, rect.bottom);
    return Math.max(0, along) + across * CROSS_WEIGHT;
}

function centerDistance(a: NavigationRect, b: NavigationRect): number {
    return Math.hypot(centerX(a) - centerX(b), centerY(a) - centerY(b));
}

/** The nearest of `candidates` that lies in `direction` from `from`, or null. */
export function pickInDirection<T>(
    from: NavigationRect,
    candidates: readonly NavigationCandidate<T>[],
    direction: UINavigationDirection,
): NavigationCandidate<T> | null {
    let best: NavigationCandidate<T> | null = null;
    let bestScore = Infinity;
    let bestTie = Infinity;
    for (const candidate of candidates) {
        if (!liesInDirection(from, candidate.rect, direction)) {
            continue;
        }
        const score = distanceInDirection(from, candidate.rect, direction);
        const tie = centerDistance(from, candidate.rect);
        if (score < bestScore || (score === bestScore && tie < bestTie)) {
            best = candidate;
            bestScore = score;
            bestTie = tie;
        }
    }
    return best;
}

/**
 * Where a move that ran out of room comes back in: the candidate furthest the other way, nearest
 * across. Going down off the bottom row lands on the top row, in the column the player was in.
 */
export function pickWrapped<T>(
    from: NavigationRect,
    candidates: readonly NavigationCandidate<T>[],
    direction: UINavigationDirection,
): NavigationCandidate<T> | null {
    if (candidates.length === 0) {
        return null;
    }
    // The edge every candidate is measured back from: the far side of the whole set.
    const edge = (rect: NavigationRect) => {
        switch (direction) {
            case "down":
                return rect.top;
            case "up":
                return -rect.bottom;
            case "right":
                return rect.left;
            case "left":
                return -rect.right;
        }
    };
    const start = Math.min(...candidates.map(candidate => edge(candidate.rect)));
    let best: NavigationCandidate<T> | null = null;
    let bestScore = Infinity;
    for (const candidate of candidates) {
        const across = isVertical(direction)
            ? intervalGap(from.left, from.right, candidate.rect.left, candidate.rect.right)
            : intervalGap(from.top, from.bottom, candidate.rect.top, candidate.rect.bottom);
        const score = edge(candidate.rect) - start + across * CROSS_WEIGHT;
        if (score < bestScore) {
            best = candidate;
            bestScore = score;
        }
    }
    return best;
}

/** Whether `candidate` is inside the first `depth` groups `current` is inside. */
function sharesRegions(current: readonly NavigationRegionRef[], candidate: readonly NavigationRegionRef[], depth: number): boolean {
    if (candidate.length < depth) {
        return false;
    }
    for (let index = 0; index < depth; index += 1) {
        if (candidate[index].key !== current[index].key) {
            return false;
        }
    }
    return true;
}

/**
 * Where `direction` goes from `current`, groups and wrapping included. See the module comment.
 *
 * `candidates` may include `current`; it is never the answer.
 */
export function findNavigationTarget<T>(input: {
    current: NavigationCandidate<T>;
    candidates: readonly NavigationCandidate<T>[];
    direction: UINavigationDirection;
    /** Whether the surface as a whole wraps. */
    wrap?: boolean;
}): NavigationCandidate<T> | null {
    const { current, direction } = input;
    const others = input.candidates.filter(candidate => candidate.target !== current.target);
    for (let depth = current.regions.length; depth >= 0; depth -= 1) {
        const pool = depth === 0 ? others : others.filter(candidate => sharesRegions(current.regions, candidate.regions, depth));
        const found = pickInDirection(current.rect, pool, direction);
        if (found) {
            return found;
        }
        if (depth > 0 && current.regions[depth - 1].wrap) {
            return pickWrapped(current.rect, pool, direction);
        }
    }
    return input.wrap ? pickWrapped(current.rect, others, direction) : null;
}

/** The first control in reading order: top row first, then leftmost. For a surface with no default. */
export function firstInReadingOrder<T>(candidates: readonly NavigationCandidate<T>[]): NavigationCandidate<T> | null {
    let best: NavigationCandidate<T> | null = null;
    for (const candidate of candidates) {
        if (!best) {
            best = candidate;
            continue;
        }
        const sameRow = intervalGap(best.rect.top, best.rect.bottom, candidate.rect.top, candidate.rect.bottom) === 0
            && Math.abs(centerY(best.rect) - centerY(candidate.rect)) < Math.min(
                best.rect.bottom - best.rect.top,
                candidate.rect.bottom - candidate.rect.top,
            ) / 2;
        if (sameRow ? candidate.rect.left < best.rect.left : centerY(candidate.rect) < centerY(best.rect)) {
            best = candidate;
        }
    }
    return best;
}
