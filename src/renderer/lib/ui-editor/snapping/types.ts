/**
 * UI Surface smart snapping — shared types (editor-only).
 */

export type SnapGuideAxis = "vertical" | "horizontal";

/** One alignment line in surface (design) pixel space. */
export type SnapGuideLine =
    | { axis: "vertical"; value: number; kind: SnapGuideKind; sourceElementId: string | null }
    | { axis: "horizontal"; value: number; kind: SnapGuideKind; sourceElementId: string | null };

export type SnapGuideKind =
    | "surface-edge"
    | "surface-center"
    | "element-edge"
    | "element-center";

/** Payload for rendering guides in the viewport overlay. */
export type ActiveSnapGuides = {
    surfaceId: string;
    vertical: number[];
    horizontal: number[];
};

export type AxisAlignedRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};
