import type {
    AppearanceModel,
    AppearancePropertyGroup,
    AppearanceValueRow,
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { ContainerWidgetProps } from "@shared/types/ui-editor/container";
import type { ButtonWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/button/types";

/** Stable id for the primary variant (blueprint / runtime default). */
export const DEFAULT_APPEARANCE_VARIANT_ID = "default";

const CONTAINER_KEY_ORDER: ContainerAppearancePropertyKey[] = [
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
];

const BUTTON_KEY_ORDER: ButtonAppearancePropertyKey[] = [
    "backgroundColor",
    "borderRadius",
    "borderWidth",
    "borderColor",
    "borderStyle",
    "paddingX",
    "paddingY",
    "clipContent",
];

function containerRowValue(props: ContainerWidgetProps, key: ContainerAppearancePropertyKey): AppearanceValueRow {
    const value = (() => {
        switch (key) {
            case "backgroundColor":
                return props.backgroundColor;
            case "borderRadius":
                return props.borderRadius;
            case "borderRadiusTL":
                return props.borderRadiusTL;
            case "borderRadiusTR":
                return props.borderRadiusTR;
            case "borderRadiusBL":
                return props.borderRadiusBL;
            case "borderRadiusBR":
                return props.borderRadiusBR;
            case "borderRadiusLinked":
                return props.borderRadiusLinked;
            case "borderColor":
                return props.borderColor;
            case "borderWidth":
                return props.borderWidth;
            case "borderStyle":
                return props.borderStyle;
            case "backgroundImage":
                return props.backgroundImage;
            case "backgroundFit":
                return props.backgroundFit;
            case "imageFill":
                return props.imageFill ?? null;
            case "fillType":
                return props.fillType;
            case "fillVisible":
                return props.fillVisible;
            case "fillOpacity":
                return props.fillOpacity;
            case "strokeVisible":
                return props.strokeVisible;
            case "strokeOpacity":
                return props.strokeOpacity;
            case "strokeAlign":
                return props.strokeAlign;
            case "strokeSide":
                return props.strokeSide;
            case "borderJoin":
                return props.borderJoin;
            case "cornerAdvanced":
                return props.cornerAdvanced;
            default:
                return null;
        }
    })();
    return { conditions: null, value };
}

function buttonRowValue(props: ButtonWidgetProps, key: ButtonAppearancePropertyKey): AppearanceValueRow {
    const value = (() => {
        switch (key) {
            case "backgroundColor":
                return props.backgroundColor;
            case "borderRadius":
                return props.borderRadius;
            case "borderWidth":
                return props.borderWidth;
            case "borderColor":
                return props.borderColor;
            case "borderStyle":
                return props.borderStyle;
            case "paddingX":
                return props.paddingX;
            case "paddingY":
                return props.paddingY;
            case "clipContent":
                return props.clipContent;
            default:
                return null;
        }
    })();
    return { conditions: null, value };
}

export function createInitialContainerAppearance(props: ContainerWidgetProps): AppearanceModel {
    const propertyGroups: AppearancePropertyGroup[] = CONTAINER_KEY_ORDER.map(key => ({
        key,
        rows: [containerRowValue(props, key)],
    }));
    return {
        defaultVariantId: DEFAULT_APPEARANCE_VARIANT_ID,
        variants: [
            {
                id: DEFAULT_APPEARANCE_VARIANT_ID,
                name: "Default",
                propertyGroups,
            },
        ],
    };
}

export function createInitialButtonAppearance(props: ButtonWidgetProps): AppearanceModel {
    const propertyGroups: AppearancePropertyGroup[] = BUTTON_KEY_ORDER.map(key => ({
        key,
        rows: [buttonRowValue(props, key)],
    }));
    return {
        defaultVariantId: DEFAULT_APPEARANCE_VARIANT_ID,
        variants: [
            {
                id: DEFAULT_APPEARANCE_VARIANT_ID,
                name: "Default",
                propertyGroups,
            },
        ],
    };
}

export function isUsableAppearanceModel(appearance: AppearanceModel | null | undefined): appearance is AppearanceModel {
    return Boolean(appearance && appearance.variants.length > 0);
}
