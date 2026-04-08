import type { ImageFill, ImageFillCropPlacement, ImageFillMode } from "@shared/types/ui-editor/imageFill";

/** Chrome props shared by `nl.image` and the visual layer of `nl.container`. */
export type RectangleLikeProps = {
    backgroundColor: string;
    borderRadius: number;
    borderRadiusTL: number;
    borderRadiusTR: number;
    borderRadiusBL: number;
    borderRadiusBR: number;
    borderRadiusLinked: boolean;
    borderColor: string;
    borderWidth: number;
    borderStyle: string;
    backgroundImage: string;
    backgroundFit: string;
    imageFill?: ImageFill | null;
    imageFlipX?: boolean;
    imageFlipY?: boolean;
    fillType: "color" | "image";
    fillVisible: boolean;
    fillOpacity: number;
    strokeVisible: boolean;
    strokeOpacity: number;
    strokeAlign: "none" | "center" | "inside" | "outside";
    /** "all", a single edge, or comma-separated edges (canonical order), e.g. "bottom,left". */
    strokeSide: string;
    borderJoin: "miter" | "round" | "bevel";
    cornerAdvanced: boolean;

    /** Appearance transform: px offset from layout box (Motion x/y). */
    transformOffsetX: number;
    transformOffsetY: number;
    /** Uniform scale; 1 = 100%. */
    transformScale: number;
    /** Degrees (Motion rotate). */
    transformRotation: number;
    /** Multiplier on chrome root opacity (0–1); combines with layer opacity upstream. */
    transformOpacity: number;
};

export type StrokeSide = "all" | "top" | "right" | "bottom" | "left";
export type StrokeJoin = "miter" | "round" | "bevel";

export const DEFAULT_RECTANGLE_CROP_PLACEMENT: ImageFillCropPlacement = {
    leftPct: 0,
    topPct: 0,
    widthPct: 100,
    heightPct: 100,
};

export function mapLegacyFitToMode(fit: string): ImageFillMode {
    const normalized = (fit ?? "").toLowerCase();
    if (normalized === "contain") return "contain";
    if (normalized === "cover") return "cover";
    if (normalized === "tile") return "tile";
    return "stretch";
}
