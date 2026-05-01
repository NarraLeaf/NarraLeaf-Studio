import type { ActiveSnapGuides, AxisAlignedRect, SnapGuideKind, SnapGuideLine } from "./types";

export const DEFAULT_SNAP_THRESHOLD_PX = 8;

export function unionAxisAlignedRects(rects: readonly AxisAlignedRect[]): AxisAlignedRect | null {
    if (rects.length === 0) {
        return null;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rects) {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.width);
        maxY = Math.max(maxY, r.y + r.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function surfaceThresholdFromViewportPx(viewportScale: number, px: number): number {
    const s = Math.max(viewportScale, 1e-4);
    return px / s;
}

type MetricKind = "edge" | "center";
type Metric = { position: number; kind: MetricKind };

function metricKindForGuide(kind: SnapGuideKind): MetricKind {
    return kind === "surface-center" || kind === "element-center" ? "center" : "edge";
}

function bestSnap1D(
    metrics: Metric[],
    lines: readonly SnapGuideLine[],
    threshold: number,
): { delta: number; line: SnapGuideLine | null } {
    let bestDelta = 0;
    let bestDist = Infinity;
    let bestLine: SnapGuideLine | null = null;

    for (const line of lines) {
        for (const m of metrics) {
            if (metricKindForGuide(line.kind) !== m.kind) {
                continue;
            }
            const delta = line.value - m.position;
            const dist = Math.abs(delta);
            if (dist <= threshold && dist + 1e-9 < bestDist) {
                bestDist = dist;
                bestDelta = delta;
                bestLine = line;
            }
        }
    }

    if (bestLine === null) {
        return { delta: 0, line: null };
    }
    return { delta: bestDelta, line: bestLine };
}

/**
 * Snap a translating axis-aligned rect: try left, right, centerX against vertical lines;
 * top, bottom, centerY against horizontal lines. Picks independent best per axis.
 */
export function snapTranslateAxisAlignedRect(params: {
    rect: AxisAlignedRect;
    verticalLines: readonly SnapGuideLine[];
    horizontalLines: readonly SnapGuideLine[];
    thresholdSurface: number;
    surfaceId: string;
}): {
    dx: number;
    dy: number;
    activeGuides: ActiveSnapGuides;
    guideLines: SnapGuideLine[];
} {
    const { rect, verticalLines, horizontalLines, thresholdSurface, surfaceId } = params;
    const left = rect.x;
    const right = rect.x + rect.width;
    const top = rect.y;
    const bottom = rect.y + rect.height;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;

    const xSnap = bestSnap1D(
        [
            { position: left, kind: "edge" },
            { position: right, kind: "edge" },
            { position: cx, kind: "center" },
        ],
        verticalLines,
        thresholdSurface,
    );
    const ySnap = bestSnap1D(
        [
            { position: top, kind: "edge" },
            { position: bottom, kind: "edge" },
            { position: cy, kind: "center" },
        ],
        horizontalLines,
        thresholdSurface,
    );

    const guideLines: SnapGuideLine[] = [];
    if (xSnap.line != null) {
        guideLines.push(xSnap.line);
    }
    if (ySnap.line != null) {
        guideLines.push(ySnap.line);
    }

    return {
        dx: xSnap.delta,
        dy: ySnap.delta,
        activeGuides: {
            surfaceId,
            vertical:
                xSnap.line != null ? [{ value: xSnap.line.value, kind: xSnap.line.kind }] : [],
            horizontal:
                ySnap.line != null ? [{ value: ySnap.line.value, kind: ySnap.line.kind }] : [],
        },
        guideLines,
    };
}

/**
 * Snap a free point (e.g. insert drag corner) to the nearest vertical and horizontal guide.
 */
export function snapSurfacePoint(params: {
    x: number;
    y: number;
    verticalLines: readonly SnapGuideLine[];
    horizontalLines: readonly SnapGuideLine[];
    thresholdSurface: number;
    surfaceId: string;
}): { x: number; y: number; activeGuides: ActiveSnapGuides } {
    const { x, y, verticalLines, horizontalLines, thresholdSurface, surfaceId } = params;
    const xSnap = bestSnap1D([{ position: x, kind: "edge" }], verticalLines, thresholdSurface);
    const ySnap = bestSnap1D([{ position: y, kind: "edge" }], horizontalLines, thresholdSurface);
    return {
        x: x + xSnap.delta,
        y: y + ySnap.delta,
        activeGuides: {
            surfaceId,
            vertical:
                xSnap.line != null ? [{ value: xSnap.line.value, kind: xSnap.line.kind }] : [],
            horizontal:
                ySnap.line != null ? [{ value: ySnap.line.value, kind: ySnap.line.kind }] : [],
        },
    };
}
