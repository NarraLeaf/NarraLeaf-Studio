import type {
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
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
]);

export const BUTTON_APPEARANCE_KEYS = new Set<ButtonAppearancePropertyKey>([
    "backgroundColor",
    "borderRadius",
    "borderWidth",
    "borderColor",
    "borderStyle",
    "paddingX",
    "paddingY",
    "clipContent",
]);

export function isContainerAppearanceKey(k: string): k is ContainerAppearancePropertyKey {
    return CONTAINER_APPEARANCE_KEYS.has(k as ContainerAppearancePropertyKey);
}

export function isButtonAppearanceKey(k: string): k is ButtonAppearancePropertyKey {
    return BUTTON_APPEARANCE_KEYS.has(k as ButtonAppearancePropertyKey);
}
