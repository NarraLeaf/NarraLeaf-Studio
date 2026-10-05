export type {
    ActiveSnapGuideSegment,
    ActiveSnapGuides,
    AxisAlignedRect,
    SmartSnapDetailSettings,
    SnapGuideKind,
    SnapGuideLine,
    SnapGuideAxis,
} from "./types";
export { DEFAULT_SMART_SNAP_DETAIL_SETTINGS } from "./types";
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
export {
    DEFAULT_UI_EDITOR_GRID_SPACING,
    MAX_UI_EDITOR_GRID_SPACING,
    MIN_UI_EDITOR_GRID_SPACING,
    computeGridScreenLines,
    nearestGridPoint,
    nearestGridValue,
    normalizeUiEditorGridSpacing,
    parseUiEditorGridSpacing,
    resolveGridDisplayStep,
    resolveGridTranslate,
    snapResizeEdgeToGrid,
} from "./gridSnap";

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
