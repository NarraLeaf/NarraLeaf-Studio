import type { UISurfaceDesignSize } from "@shared/types/ui-editor/document";
import type { ActiveSnapGuides, AxisAlignedRect, SnapGuideKind } from "./types";

/**
 * A snap guide drawn as far as the things it lines up, rather than across the whole viewport.
 *
 * `from`/`to` run along the line (y for a vertical guide, x for a horizontal one), in surface space.
 * `gap` is the space along the line between the selection and the nearest layer it lines up with,
 * labelled on the canvas so the author sees how far apart the two are as well as that they align.
 */
export type SnapGuideSpan = {
    axis: "vertical" | "horizontal";
    value: number;
    kind: SnapGuideKind;
    from: number;
    to: number;
    gap?: { from: number; to: number };
};

/** Design pixels: what a snap leaves equal is equal to well within this. */
const ALIGNED_EPS = 0.01;

type Range = { start: number; end: number };

function alongLine(rect: AxisAlignedRect, axis: "vertical" | "horizontal"): Range {
    return axis === "vertical"
        ? { start: rect.y, end: rect.y + rect.height }
        : { start: rect.x, end: rect.x + rect.width };
}

function alignsWith(rect: AxisAlignedRect, axis: "vertical" | "horizontal", value: number, kind: SnapGuideKind): boolean {
    const start = axis === "vertical" ? rect.x : rect.y;
    const size = axis === "vertical" ? rect.width : rect.height;
    if (kind === "element-center") {
        return Math.abs(start + size / 2 - value) <= ALIGNED_EPS;
    }
    return Math.abs(start - value) <= ALIGNED_EPS || Math.abs(start + size - value) <= ALIGNED_EPS;
}

/**
 * Where each active guide starts and ends, given the box being moved or resized (`subject`) and the
 * boxes it can line up with (`candidates`, from `collectSnapCandidateRects`).
 *
 * - A guide to the canvas edge or centre runs the canvas's length, and on past the subject if that
 *   hangs over the edge.
 * - A guide to other layers runs from the first thing it lines up to the last, the subject included,
 *   and labels the gap to the nearest of them. A layer the subject overlaps along the line has no gap.
 * - Should no layer match (the guide outlived what it was found on), it falls back to the canvas's
 *   length rather than to nothing.
 */
export function resolveSnapGuideSpans(params: {
    guides: ActiveSnapGuides;
    subject: AxisAlignedRect;
    candidates: readonly AxisAlignedRect[];
    designSize: UISurfaceDesignSize;
}): SnapGuideSpan[] {
    const { guides, subject, candidates, designSize } = params;
    const out: SnapGuideSpan[] = [];
    const resolve = (axis: "vertical" | "horizontal", value: number, kind: SnapGuideKind) => {
        const own = alongLine(subject, axis);
        const canvas: Range = { start: 0, end: axis === "vertical" ? designSize.height : designSize.width };
        const aligned = kind === "element-edge" || kind === "element-center"
            ? candidates.filter(rect => alignsWith(rect, axis, value, kind))
            : [];
        if (aligned.length === 0) {
            out.push({ axis, value, kind, from: Math.min(canvas.start, own.start), to: Math.max(canvas.end, own.end) });
            return;
        }
        let from = own.start;
        let to = own.end;
        let gap: { from: number; to: number } | undefined;
        for (const rect of aligned) {
            const range = alongLine(rect, axis);
            from = Math.min(from, range.start);
            to = Math.max(to, range.end);
            const between = range.end <= own.start
                ? { from: range.end, to: own.start }
                : range.start >= own.end
                  ? { from: own.end, to: range.start }
                  : null;
            if (between && between.to - between.from > ALIGNED_EPS && (!gap || between.to - between.from < gap.to - gap.from)) {
                gap = between;
            }
        }
        out.push({ axis, value, kind, from, to, ...(gap ? { gap } : {}) });
    };
    for (const segment of guides.vertical) {
        resolve("vertical", segment.value, segment.kind);
    }
    for (const segment of guides.horizontal) {
        resolve("horizontal", segment.value, segment.kind);
    }
    return out;
}
