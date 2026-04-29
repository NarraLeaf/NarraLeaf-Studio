import type { UIDocument, UILayout } from "@shared/types/ui-editor/document";
import { surfaceRectToParentLocalLayout } from "@/lib/ui-editor/layout/elementSurfaceGeometry";
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

    if (dirX === -1) {
        const snap = bestSnap1D([{ position: surf.x }], verticalLines, threshold);
        if (snap.line != null) {
            surf = { ...surf, x: surf.x + snap.delta, width: surf.width - snap.delta };
            activeGuides.vertical = [snap.line.value];
        }
    } else if (dirX === 1) {
        const right = surf.x + surf.width;
        const snap = bestSnap1D([{ position: right }], verticalLines, threshold);
        if (snap.line != null) {
            surf = { ...surf, width: surf.width + snap.delta };
            activeGuides.vertical = [snap.line.value];
        }
    }

    if (surf.width < MIN_DIM) {
        surf = { ...surf, width: MIN_DIM };
    }

    if (dirY === -1) {
        const snap = bestSnap1D([{ position: surf.y }], horizontalLines, threshold);
        if (snap.line != null) {
            surf = { ...surf, y: surf.y + snap.delta, height: surf.height - snap.delta };
            activeGuides.horizontal = [snap.line.value];
        }
    } else if (dirY === 1) {
        const bottom = surf.y + surf.height;
        const snap = bestSnap1D([{ position: bottom }], horizontalLines, threshold);
        if (snap.line != null) {
            surf = { ...surf, height: surf.height + snap.delta };
            activeGuides.horizontal = [snap.line.value];
        }
    }

    if (surf.height < MIN_DIM) {
        surf = { ...surf, height: MIN_DIM };
    }

    const local = surfaceRectToParentLocalLayout(document, parentId, surf);
    return {
        layout: { x: local.x, y: local.y, width: local.width, height: local.height },
        activeGuides,
    };
}
