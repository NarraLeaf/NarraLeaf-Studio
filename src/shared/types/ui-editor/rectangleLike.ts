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
    fillType: "color" | "image";
    fillVisible: boolean;
    fillOpacity: number;
    strokeVisible: boolean;
    strokeOpacity: number;
    strokeAlign: "none" | "center" | "inside" | "outside";
    strokeSide: "all" | "top" | "right" | "bottom" | "left";
    borderJoin: "miter" | "round" | "bevel";
    cornerAdvanced: boolean;
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
