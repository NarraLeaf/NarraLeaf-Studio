import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import type { RectangleProps } from "./types";
import { DEFAULT_CROP_PLACEMENT, mapLegacyFitToMode } from "./types";

export function getProps(element: { props?: Record<string, unknown> }): RectangleProps {
  const p = element.props ?? {};
  return {
    backgroundColor: String(p.backgroundColor ?? "#ffffff"),
    borderRadius: Number(p.borderRadius ?? 0),
    borderRadiusTL: Number(p.borderRadiusTL ?? p.borderRadius ?? 0),
    borderRadiusTR: Number(p.borderRadiusTR ?? p.borderRadius ?? 0),
    borderRadiusBL: Number(p.borderRadiusBL ?? p.borderRadius ?? 0),
    borderRadiusBR: Number(p.borderRadiusBR ?? p.borderRadius ?? 0),
    borderRadiusLinked: p.borderRadiusLinked !== false,
    borderColor: String(p.borderColor ?? "transparent"),
    borderWidth: Number(p.borderWidth ?? 0),
    borderStyle: String(p.borderStyle ?? "solid"),
    backgroundImage: String(p.backgroundImage ?? ""),
    backgroundFit: String(p.backgroundFit ?? "cover"),
    imageFill: (p.imageFill as ImageFill | undefined) ?? undefined,
    fillType: String(p.fillType ?? "color") as RectangleProps["fillType"],
    fillVisible: p.fillVisible !== false,
    fillOpacity: Number(p.fillOpacity ?? 1),
    strokeVisible: p.strokeVisible !== false,
    strokeOpacity: Number(p.strokeOpacity ?? 1),
    strokeAlign: String(p.strokeAlign ?? "center") as RectangleProps["strokeAlign"],
    strokeSide: String(p.strokeSide ?? "all") as RectangleProps["strokeSide"],
    borderJoin: String(p.borderJoin ?? "miter") as RectangleProps["borderJoin"],
    cornerAdvanced: Boolean(p.cornerAdvanced),
  };
}

export function deriveLegacyImageFill(props: RectangleProps): ImageFill | undefined {
  const trimmed = props.backgroundImage?.trim();
  if (!trimmed) {
    return undefined;
  }
  return {
    mode: mapLegacyFitToMode(props.backgroundFit),
    assetId: null,
  };
}

export function normalizeImageFill(props: RectangleProps): ImageFill | undefined {
  return props.imageFill ?? deriveLegacyImageFill(props);
}

export function ensureCropPlacement(fill?: ImageFill) {
  return fill?.cropPlacement ?? DEFAULT_CROP_PLACEMENT;
}
