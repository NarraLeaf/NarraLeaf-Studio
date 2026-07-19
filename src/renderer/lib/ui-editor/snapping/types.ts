/**
 * UI Surface smart snapping - shared types (editor-only).
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

/** One active guide segment shown in the overlay (surface design space). */
export type ActiveSnapGuideSegment = {
    value: number;
    kind: SnapGuideKind;
};

/** Payload for rendering guides in the viewport overlay. */
export type ActiveSnapGuides = {
    surfaceId: string;
    vertical: ActiveSnapGuideSegment[];
    horizontal: ActiveSnapGuideSegment[];
};

export type AxisAlignedRect = {
    x: number;
    y: number;
    width: number;
    height: number;
};

/**
 * Per-category smart snap targets (master toggle remains `getSmartSnapEnabled` on state service).
 * Persisted under project settings.
 */
export type SmartSnapDetailSettings = {
    /** Snap selection edges/centers to other elements' center lines. */
    snapElementLayout: boolean;
    /** Snap element edges to other elements' edges. */
    snapElementBorder: boolean;
    /** Snap to canvas (surface) edges and center lines. */
    snapCanvasLayout: boolean;
};

export const DEFAULT_SMART_SNAP_DETAIL_SETTINGS: SmartSnapDetailSettings = {
    snapElementLayout: true,
    snapElementBorder: true,
    snapCanvasLayout: true,
};
