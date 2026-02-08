import type { ImageFill, ImageFillCropPlacement, ImageFillMode } from "@shared/types/ui-editor/imageFill";

export type FillType = "color" | "image";
export type StrokeAlign = "none" | "center" | "inside" | "outside";
export type StrokeSide = "all" | "top" | "right" | "bottom" | "left";
export type StrokeJoin = "miter" | "round" | "bevel";

export type RectangleProps = {
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
  fillType: FillType;
  fillVisible: boolean;
  fillOpacity: number;
  strokeVisible: boolean;
  strokeOpacity: number;
  strokeAlign: StrokeAlign;
  strokeSide: StrokeSide;
  borderJoin: StrokeJoin;
  cornerAdvanced: boolean;
};

export const DEFAULT_CROP_PLACEMENT: ImageFillCropPlacement = {
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
