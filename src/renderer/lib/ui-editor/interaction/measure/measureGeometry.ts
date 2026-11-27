/**
 * What the canvas measures and where it draws it: the selection's size, and the distances from the
 * selection to another layer while Alt is held. All in overlay pixels (the unscaled viewport the
 * selection frame is drawn on); a label divides by the zoom to show design pixels.
 */

export type ScreenRect = { left: number; top: number; width: number; height: number };

/**
 * One measured distance.
 *
 * `axis: "x"` is a horizontal line from `from` to `to` at height `at`; `"y"` is a vertical line from
 * `from` to `to` at `at` across. `leader` is a dashed line along the target's edge, out to where the
 * measured line runs, for a target that does not reach that far itself - without it the line would
 * end in empty space.
 */
export type MeasureSegment = {
    axis: "x" | "y";
    from: number;
    to: number;
    at: number;
    leader?: { at: number; from: number; to: number };
};

/** Up to two decimals, without trailing zeros: 120, 120.5, 120.25. */
export function formatMeasure(value: number): string {
    const rounded = Math.round(value * 100) / 100;
    return String(Object.is(rounded, -0) ? 0 : rounded);
}

export function unionScreenRects(rects: readonly ScreenRect[]): ScreenRect | null {
    if (rects.length === 0) {
        return null;
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const r of rects) {
        left = Math.min(left, r.left);
        top = Math.min(top, r.top);
        right = Math.max(right, r.left + r.width);
        bottom = Math.max(bottom, r.top + r.height);
    }
    return { left, top, width: right - left, height: bottom - top };
}

type Span = { start: number; end: number };

function spanOf(rect: ScreenRect, axis: "x" | "y"): Span {
    return axis === "x"
        ? { start: rect.left, end: rect.left + rect.width }
        : { start: rect.top, end: rect.top + rect.height };
}

function apart(a: Span, b: Span): boolean {
    return a.end <= b.start || b.end <= a.start;
}

function middle(span: Span): number {
    return (span.start + span.end) / 2;
}

/** Shorter than this (overlay px) is the same edge: nothing to draw. */
const SAME_EDGE_PX = 0.01;

/**
 * The distances from `subject` (the selection) to `target`, the way design tools draw them:
 *
 * - Apart on an axis: the gap between the facing edges. Where the two overlap on the other axis the
 *   line runs through the middle of that overlap; where they do not, it runs from the subject's
 *   middle and a dashed leader carries the target's edge out to it.
 * - Overlapping on both axes (one inside the other, or partly over it): edge to matching edge on all
 *   four sides, through the middle of where they overlap.
 * - Apart on one axis only: just that gap - the edges on the other axis are not a distance anyone
 *   is asking about.
 */
export function measureBetween(subject: ScreenRect, target: ScreenRect): MeasureSegment[] {
    const sx = spanOf(subject, "x");
    const sy = spanOf(subject, "y");
    const tx = spanOf(target, "x");
    const ty = spanOf(target, "y");
    const apartX = apart(sx, tx);
    const apartY = apart(sy, ty);
    if (apartX || apartY) {
        // Layers that only touch are apart by nothing: no line, rather than a "0" sitting on the seam.
        const gaps = [apartX ? gapSegment("x", sx, tx, sy, ty) : null, apartY ? gapSegment("y", sy, ty, sx, tx) : null];
        return gaps.filter((gap): gap is MeasureSegment => gap != null && gap.to - gap.from > SAME_EDGE_PX);
    }

    const out: MeasureSegment[] = [];
    const overlapX: Span = { start: Math.max(sx.start, tx.start), end: Math.min(sx.end, tx.end) };
    const overlapY: Span = { start: Math.max(sy.start, ty.start), end: Math.min(sy.end, ty.end) };
    const pushEdges = (axis: "x" | "y", s: Span, t: Span, at: number) => {
        for (const [a, b] of [[s.start, t.start], [s.end, t.end]] as const) {
            if (Math.abs(a - b) > SAME_EDGE_PX) {
                out.push({ axis, from: Math.min(a, b), to: Math.max(a, b), at });
            }
        }
    };
    pushEdges("x", sx, tx, middle(overlapY));
    pushEdges("y", sy, ty, middle(overlapX));
    return out;
}

/** The gap along `axis` between two spans that do not meet, placed on the cross axis. */
function gapSegment(axis: "x" | "y", s: Span, t: Span, sCross: Span, tCross: Span): MeasureSegment {
    const targetAfter = t.start >= s.end;
    const from = targetAfter ? s.end : t.end;
    const to = targetAfter ? t.start : s.start;
    const targetEdge = targetAfter ? t.start : t.end;
    if (!apart(sCross, tCross)) {
        const overlap: Span = { start: Math.max(sCross.start, tCross.start), end: Math.min(sCross.end, tCross.end) };
        return { axis, from, to, at: middle(overlap) };
    }
    const at = middle(sCross);
    const nearestCrossEdge = tCross.end <= sCross.start ? tCross.end : tCross.start;
    return {
        axis,
        from,
        to,
        at,
        leader: { at: targetEdge, from: Math.min(nearestCrossEdge, at), to: Math.max(nearestCrossEdge, at) },
    };
}
