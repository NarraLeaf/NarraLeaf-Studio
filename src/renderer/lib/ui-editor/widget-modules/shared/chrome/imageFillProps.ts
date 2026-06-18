import { isAppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import { syncImageAppearanceImageFillFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";

export function buildImageFillPropsUpdate(element: UIElement, nextFill: ImageFill): Record<string, unknown> {
    const props = element.props ?? {};
    const rawAppearance = (props as { appearance?: unknown }).appearance;
    const nextAppearance = isAppearanceModel(rawAppearance)
        ? syncImageAppearanceImageFillFromProps(rawAppearance, nextFill)
        : rawAppearance;

    return {
        ...props,
        fillType: "image",
        imageFill: nextFill,
        ...(nextAppearance !== rawAppearance ? { appearance: nextAppearance } : {}),
    };
}
