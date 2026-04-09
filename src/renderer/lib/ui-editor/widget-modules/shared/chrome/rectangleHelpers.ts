import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { DEFAULT_RECTANGLE_CROP_PLACEMENT, mapLegacyFitToMode } from "@shared/types/ui-editor/rectangleLike";
import { normalizeElementEffectValues } from "@shared/types/ui-editor/effects";

export function getRectangleLikeProps(element: { props?: Record<string, unknown> }): RectangleLikeProps {
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
        imageFlipX: p.imageFlipX === true,
        imageFlipY: p.imageFlipY === true,
        fillType: String(p.fillType ?? "color") as RectangleLikeProps["fillType"],
        fillVisible: p.fillVisible !== false,
        fillOpacity: Number(p.fillOpacity ?? 1),
        strokeVisible: p.strokeVisible !== false,
        strokeOpacity: Number(p.strokeOpacity ?? 1),
        strokeAlign: String(p.strokeAlign ?? "center") as RectangleLikeProps["strokeAlign"],
        strokeSide: String(p.strokeSide ?? "all") as RectangleLikeProps["strokeSide"],
        borderJoin: String(p.borderJoin ?? "miter") as RectangleLikeProps["borderJoin"],
        cornerAdvanced: Boolean(p.cornerAdvanced),
        transformOffsetX: Number(p.transformOffsetX ?? 0),
        transformOffsetY: Number(p.transformOffsetY ?? 0),
        transformScale: Number(p.transformScale ?? 1),
        transformRotation: Number(p.transformRotation ?? 0),
        transformOpacity: Number(p.transformOpacity ?? 1),
        effects: normalizeElementEffectValues(p.effects),
    };
}

export function deriveLegacyImageFill(props: RectangleLikeProps): ImageFill | undefined {
    const trimmed = props.backgroundImage?.trim();
    if (!trimmed) {
        return undefined;
    }
    return {
        mode: mapLegacyFitToMode(props.backgroundFit),
        assetId: null,
    };
}

export function normalizeImageFill(props: RectangleLikeProps): ImageFill | undefined {
    return props.imageFill ?? deriveLegacyImageFill(props);
}

export function ensureCropPlacement(fill?: ImageFill) {
    return fill?.cropPlacement ?? DEFAULT_RECTANGLE_CROP_PLACEMENT;
}
