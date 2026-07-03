import type { UIDocument, UILayout } from "@shared/types/ui-editor/document";
import { getElementSurfaceTopLeft } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
import { getSurfaceAxisAlignedBoundsForLayout } from "./surfaceRect";
import type { ActiveSnapGuides, AxisAlignedRect, SnapGuideLine } from "./types";
import { surfaceThresholdFromViewportPx } from "./snapMath";

function bestSnap1D(
    metrics: { position: number }[],
    lines: readonly SnapGuideLine[],
    threshold: number,
): { delta: number; line: SnapGuideLine | null } {
    let bestDelta = 0;
    let bestDist = Infinity;
    let bestLine: SnapGuideLine | null = null;
    for (const line of lines) {
        if (line.kind === "surface-center" || line.kind === "element-center") {
            continue;
        }
        for (const m of metrics) {
            const delta = line.value - m.position;
            const dist = Math.abs(delta);
            if (dist <= threshold && dist + 1e-9 < bestDist) {
                bestDist = dist;
                bestDelta = delta;
                bestLine = line;
            }
        }
    }
    return bestLine === null ? { delta: 0, line: null } : { delta: bestDelta, line: bestLine };
}

const MIN_DIM = 1;
const EPS = 1e-6;

type ResizeSnapOptions = {
    preserveAspectRatio?: boolean;
    aspectRatio?: number;
};

type AxisSnapCandidate = {
    rect: AxisAlignedRect;
    line: SnapGuideLine;
    distance: number;
    axis: "vertical" | "horizontal";
};

function getAspectRatio(tentative: Pick<UILayout, "width" | "height">, options?: ResizeSnapOptions): number | null {
    const configured = options?.aspectRatio;
    if (configured != null && Number.isFinite(configured) && configured > EPS) {
        return configured;
    }
    const width = Math.abs(tentative.width);
    const height = Math.abs(tentative.height);
    if (width > EPS && height > EPS) {
        return width / height;
    }
    return null;
}

function rectFromAnchoredSize(
    base: AxisAlignedRect,
    direction: readonly [number, number],
    width: number,
    height: number,
): AxisAlignedRect {
    const [dirX, dirY] = direction;
    const x =
        dirX === 1
            ? base.x
            : dirX === -1
              ? base.x + base.width - width
              : base.x + base.width / 2 - width / 2;
    const y =
        dirY === 1
            ? base.y
            : dirY === -1
              ? base.y + base.height - height
              : base.y + base.height / 2 - height / 2;
    return { x, y, width, height };
}

function enforceAspectMinSize(
    rect: AxisAlignedRect,
    direction: readonly [number, number],
    aspectRatio: number,
): AxisAlignedRect {
    if (rect.width >= MIN_DIM && rect.height >= MIN_DIM) {
        return rect;
    }
    if (rect.width > EPS && rect.height > EPS) {
        const scale = Math.max(MIN_DIM / rect.width, MIN_DIM / rect.height);
        return rectFromAnchoredSize(rect, direction, rect.width * scale, rect.height * scale);
    }
    if (aspectRatio >= 1) {
        return rectFromAnchoredSize(rect, direction, MIN_DIM * aspectRatio, MIN_DIM);
    }
    return rectFromAnchoredSize(rect, direction, MIN_DIM, MIN_DIM / aspectRatio);
}

function buildAspectPreservingCandidates(
    surf: AxisAlignedRect,
    direction: readonly [number, number],
    verticalLines: readonly SnapGuideLine[],
    horizontalLines: readonly SnapGuideLine[],
    threshold: number,
    aspectRatio: number,
): AxisSnapCandidate[] {
    const candidates: AxisSnapCandidate[] = [];
    const [dirX, dirY] = direction;

    if (dirX === -1) {
        const snap = bestSnap1D([{ position: surf.x }], verticalLines, threshold);
        const width = surf.width - snap.delta;
        const height = width / aspectRatio;
        if (snap.line != null && width >= MIN_DIM && height >= MIN_DIM) {
            candidates.push({
                rect: rectFromAnchoredSize(surf, direction, width, height),
                line: snap.line,
                distance: Math.abs(snap.delta),
                axis: "vertical",
            });
        }
    } else if (dirX === 1) {
        const right = surf.x + surf.width;
        const snap = bestSnap1D([{ position: right }], verticalLines, threshold);
        const width = surf.width + snap.delta;
        const height = width / aspectRatio;
        if (snap.line != null && width >= MIN_DIM && height >= MIN_DIM) {
            candidates.push({
                rect: rectFromAnchoredSize(surf, direction, width, height),
                line: snap.line,
                distance: Math.abs(snap.delta),
                axis: "vertical",
            });
        }
    }

    if (dirY === -1) {
        const snap = bestSnap1D([{ position: surf.y }], horizontalLines, threshold);
        const height = surf.height - snap.delta;
        const width = height * aspectRatio;
        if (snap.line != null && width >= MIN_DIM && height >= MIN_DIM) {
            candidates.push({
                rect: rectFromAnchoredSize(surf, direction, width, height),
                line: snap.line,
                distance: Math.abs(snap.delta),
                axis: "horizontal",
            });
        }
    } else if (dirY === 1) {
        const bottom = surf.y + surf.height;
        const snap = bestSnap1D([{ position: bottom }], horizontalLines, threshold);
        const height = surf.height + snap.delta;
        const width = height * aspectRatio;
        if (snap.line != null && width >= MIN_DIM && height >= MIN_DIM) {
            candidates.push({
                rect: rectFromAnchoredSize(surf, direction, width, height),
                line: snap.line,
                distance: Math.abs(snap.delta),
                axis: "horizontal",
            });
        }
    }

    return candidates;
}

function chooseBestAspectPreservingCandidate(candidates: AxisSnapCandidate[]): AxisSnapCandidate | null {
    if (candidates.length === 0) {
        return null;
    }
    return candidates.reduce((best, candidate) => {
        if (candidate.distance + EPS < best.distance) {
            return candidate;
        }
        return best;
    });
}

/**
 * Snap resize of an axis-aligned box in surface space (no element self-rotation).
 * Returns adjusted layout fields in parent-local coordinates.
 */
export function snapResizeLayoutInSurface(
    document: UIDocument,
    elementId: string,
    tentative: Pick<UILayout, "x" | "y" | "width" | "height" | "rotation">,
    direction: readonly [number, number],
    verticalLines: readonly SnapGuideLine[],
    horizontalLines: readonly SnapGuideLine[],
    viewportScale: number,
    surfaceId: string,
    options?: ResizeSnapOptions,
): {
    layout: Pick<UILayout, "x" | "y" | "width" | "height">;
    activeGuides: ActiveSnapGuides;
} {
    const el = document.elements[elementId];
    const threshold = surfaceThresholdFromViewportPx(viewportScale, 8);
    const activeGuides: ActiveSnapGuides = { surfaceId, vertical: [], horizontal: [] };

    if (!el?.parentId || (tentative.rotation ?? 0) !== 0) {
        return {
            layout: {
                x: tentative.x,
                y: tentative.y,
                width: tentative.width,
                height: tentative.height,
            },
            activeGuides,
        };
    }

    const parentId = el.parentId;
    const full: UILayout = {
        ...el.layout,
        ...tentative,
    };

    let surf: AxisAlignedRect = getSurfaceAxisAlignedBoundsForLayout(document, elementId, full);

    const [dirX, dirY] = direction;
    const aspectRatio = options?.preserveAspectRatio ? getAspectRatio(tentative, options) : null;

    if (aspectRatio != null) {
        const best = chooseBestAspectPreservingCandidate(
            buildAspectPreservingCandidates(surf, direction, verticalLines, horizontalLines, threshold, aspectRatio),
        );
        if (best != null) {
            surf = best.rect;
            if (best.axis === "vertical") {
                activeGuides.vertical = [{ value: best.line.value, kind: best.line.kind }];
            } else {
                activeGuides.horizontal = [{ value: best.line.value, kind: best.line.kind }];
            }
        }
        surf = enforceAspectMinSize(surf, direction, aspectRatio);

        const parentSurfaceTL = getElementSurfaceTopLeft(document, parentId);
        return {
            layout: {
                x: surf.x - parentSurfaceTL.x,
                y: surf.y - parentSurfaceTL.y,
                width: surf.width,
                height: surf.height,
            },
            activeGuides,
        };
    }

    if (dirX === -1) {
        const snap = bestSnap1D([{ position: surf.x }], verticalLines, threshold);
        if (snap.line != null) {
            surf = { ...surf, x: surf.x + snap.delta, width: surf.width - snap.delta };
            activeGuides.vertical = [{ value: snap.line.value, kind: snap.line.kind }];
        }
    } else if (dirX === 1) {
        const right = surf.x + surf.width;
        const snap = bestSnap1D([{ position: right }], verticalLines, threshold);
        if (snap.line != null) {
            surf = { ...surf, width: surf.width + snap.delta };
            activeGuides.vertical = [{ value: snap.line.value, kind: snap.line.kind }];
        }
    }

    if (surf.width < MIN_DIM) {
        surf = { ...surf, width: MIN_DIM };
    }

    if (dirY === -1) {
        const snap = bestSnap1D([{ position: surf.y }], horizontalLines, threshold);
        if (snap.line != null) {
            surf = { ...surf, y: surf.y + snap.delta, height: surf.height - snap.delta };
            activeGuides.horizontal = [{ value: snap.line.value, kind: snap.line.kind }];
        }
    } else if (dirY === 1) {
        const bottom = surf.y + surf.height;
        const snap = bestSnap1D([{ position: bottom }], horizontalLines, threshold);
        if (snap.line != null) {
            surf = { ...surf, height: surf.height + snap.delta };
            activeGuides.horizontal = [{ value: snap.line.value, kind: snap.line.kind }];
        }
    }

    if (surf.height < MIN_DIM) {
        surf = { ...surf, height: MIN_DIM };
    }

    // Inlined parent-local mapping without the Math.max(0, ...) clamp used by tree/insert helpers:
    // resize must allow elements to live at negative parent-local positions (e.g. snapping past
    // a parent's left edge), otherwise the result snaps back to 0 and the element jumps.
    const parentSurfaceTL = getElementSurfaceTopLeft(document, parentId);
    return {
        layout: {
            x: surf.x - parentSurfaceTL.x,
            y: surf.y - parentSurfaceTL.y,
            width: surf.width,
            height: surf.height,
        },
        activeGuides,
    };
}
