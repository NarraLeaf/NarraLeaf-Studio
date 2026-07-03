import type {
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
    TextAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";

export const CONTAINER_APPEARANCE_KEYS = new Set<ContainerAppearancePropertyKey>([
    "backgroundColor",
    "borderRadius",
    "borderRadiusTL",
    "borderRadiusTR",
    "borderRadiusBL",
    "borderRadiusBR",
    "borderRadiusLinked",
    "borderColor",
    "borderWidth",
    "borderStyle",
    "backgroundImage",
    "backgroundFit",
    "imageFill",
    "fillType",
    "fillVisible",
    "fillOpacity",
    "strokeVisible",
    "strokeOpacity",
    "strokeAlign",
    "strokeSide",
    "borderJoin",
    "cornerAdvanced",
    "transformOffsetX",
    "transformOffsetY",
    "transformScale",
    "transformRotation",
    "transformOpacity",
    "effectBlur",
    "effectBackgroundBlur",
    "effectShadow",
    "effectInnerShadow",
    "effectBlend",
    "effectGlow",
    "effectFilter",
]);

export const BUTTON_APPEARANCE_KEYS = new Set<ButtonAppearancePropertyKey>([
    "backgroundColor",
    "fillType",
    "fillOpacity",
    "fillVisible",
    "imageFill",
    "backgroundImage",
    "backgroundFit",
    "borderRadius",
    "borderWidth",
    "borderColor",
    "borderStyle",
    "strokeOpacity",
    "strokeSide",
    "borderJoin",
    "strokeAlign",
    "paddingX",
    "paddingY",
    "clipContent",
    "cursor",
    "transformOffsetX",
    "transformOffsetY",
    "transformScale",
    "transformRotation",
    "transformOpacity",
    "effectBlur",
    "effectBackgroundBlur",
    "effectShadow",
    "effectTextShadow",
    "effectInnerShadow",
    "effectBlend",
    "effectGlow",
    "effectFilter",
]);

export const TEXT_APPEARANCE_KEYS = new Set<TextAppearancePropertyKey>([
    "fontAssetId",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "color",
    "lineHeight",
    "transformOffsetX",
    "transformOffsetY",
    "transformScale",
    "transformRotation",
    "transformOpacity",
    "effectBlur",
    "effectTextShadow",
    "effectBlend",
    "effectFilter",
]);

export function isContainerAppearanceKey(k: string): k is ContainerAppearancePropertyKey {
    return CONTAINER_APPEARANCE_KEYS.has(k as ContainerAppearancePropertyKey);
}

export function isButtonAppearanceKey(k: string): k is ButtonAppearancePropertyKey {
    return BUTTON_APPEARANCE_KEYS.has(k as ButtonAppearancePropertyKey);
}

export function isTextAppearanceKey(k: string): k is TextAppearancePropertyKey {
    return TEXT_APPEARANCE_KEYS.has(k as TextAppearancePropertyKey);
}
