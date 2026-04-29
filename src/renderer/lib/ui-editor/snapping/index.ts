export type { ActiveSnapGuides, AxisAlignedRect, SnapGuideKind, SnapGuideLine, SnapGuideAxis } from "./types";
export { getSurfaceAxisAlignedBoundsForLayout, getSurfaceAxisAlignedBoundsFromDocument, getSurfaceTopLeftForLayout } from "./surfaceRect";
export { collectSnapGuideLines } from "./collectCandidates";
export {
    DEFAULT_SNAP_THRESHOLD_PX,
    surfaceThresholdFromViewportPx,
    snapTranslateAxisAlignedRect,
    snapSurfacePoint,
    unionAxisAlignedRects,
} from "./snapMath";
export { snapResizeLayoutInSurface } from "./resizeSnap";

import type { SnapGuideLine } from "./types";

export function splitSnapLinesToAxes(lines: readonly SnapGuideLine[]): {
    vertical: SnapGuideLine[];
    horizontal: SnapGuideLine[];
} {
    const vertical: SnapGuideLine[] = [];
    const horizontal: SnapGuideLine[] = [];
    for (const l of lines) {
        if (l.axis === "vertical") {
            vertical.push(l);
        } else {
            horizontal.push(l);
        }
    }
    return { vertical, horizontal };
}
