import type {
    AppearanceModel,
    AppearancePropertyGroup,
    AppearanceSystemCondition,
    AppearanceValueRow,
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import type { ContainerWidgetProps } from "@shared/types/ui-editor/container";
import type { ButtonWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/button/types";
import { buttonPropsToImageFillBaseline } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import { getImageWidgetRectangleProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import { getRectangleLikeProps } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";

/** Stable id for the primary variant (blueprint / runtime default). */
export const DEFAULT_APPEARANCE_VARIANT_ID = "default";

/** Stable key order for container appearance groups (used by compact inspector and migrations). */
export const CONTAINER_KEY_ORDER: ContainerAppearancePropertyKey[] = [
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
];

/** Stable key order for button appearance groups. */
export const BUTTON_KEY_ORDER: ButtonAppearancePropertyKey[] = [
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
    "transformOffsetX",
    "transformOffsetY",
    "transformScale",
    "transformRotation",
    "transformOpacity",
];

/** Row seed for `nl.image` / rectangle baseline (all container appearance keys map to `RectangleLikeProps`). */
export function containerAppearanceRowFromRectangleLike(
    rl: RectangleLikeProps,
    key: ContainerAppearancePropertyKey
): AppearanceValueRow {
    const value = (() => {
        switch (key) {
            case "backgroundColor":
                return rl.backgroundColor;
            case "borderRadius":
                return rl.borderRadius;
            case "borderRadiusTL":
                return rl.borderRadiusTL;
            case "borderRadiusTR":
                return rl.borderRadiusTR;
            case "borderRadiusBL":
                return rl.borderRadiusBL;
            case "borderRadiusBR":
                return rl.borderRadiusBR;
            case "borderRadiusLinked":
                return rl.borderRadiusLinked;
            case "borderColor":
                return rl.borderColor;
            case "borderWidth":
                return rl.borderWidth;
            case "borderStyle":
                return rl.borderStyle;
            case "backgroundImage":
                return rl.backgroundImage;
            case "backgroundFit":
                return rl.backgroundFit;
            case "imageFill":
                return rl.imageFill ?? null;
            case "fillType":
                return rl.fillType;
            case "fillVisible":
                return rl.fillVisible;
            case "fillOpacity":
                return rl.fillOpacity;
            case "strokeVisible":
                return rl.strokeVisible;
            case "strokeOpacity":
                return rl.strokeOpacity;
            case "strokeAlign":
                return rl.strokeAlign;
            case "strokeSide":
                return rl.strokeSide;
            case "borderJoin":
                return rl.borderJoin;
            case "cornerAdvanced":
                return rl.cornerAdvanced;
            case "transformOffsetX":
                return rl.transformOffsetX;
            case "transformOffsetY":
                return rl.transformOffsetY;
            case "transformScale":
                return rl.transformScale;
            case "transformRotation":
                return rl.transformRotation;
            case "transformOpacity":
                return rl.transformOpacity;
            default:
                return null;
        }
    })();
    return { conditions: null, value };
}

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
            case "transformOffsetX":
                return props.transformOffsetX;
            case "transformOffsetY":
                return props.transformOffsetY;
            case "transformScale":
                return props.transformScale;
            case "transformRotation":
                return props.transformRotation;
            case "transformOpacity":
                return props.transformOpacity;
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
            case "fillType":
                return props.fillType;
            case "fillOpacity":
                return props.fillOpacity;
            case "fillVisible":
                return props.fillVisible;
            case "imageFill":
                return props.imageFill ?? null;
            case "backgroundImage":
                return props.backgroundImage;
            case "backgroundFit":
                return props.backgroundFit;
            case "borderRadius":
                return props.borderRadius;
            case "borderWidth":
                return props.borderWidth;
            case "borderColor":
                return props.borderColor;
            case "borderStyle":
                return props.borderStyle;
            case "strokeOpacity": {
                const bl = buttonPropsToImageFillBaseline(props);
                return bl.strokeOpacity;
            }
            case "strokeSide": {
                const bl = buttonPropsToImageFillBaseline(props);
                return bl.strokeSide;
            }
            case "borderJoin": {
                const bl = buttonPropsToImageFillBaseline(props);
                return bl.borderJoin;
            }
            case "strokeAlign": {
                const bl = buttonPropsToImageFillBaseline(props);
                return bl.strokeAlign;
            }
            case "paddingX":
                return props.paddingX;
            case "paddingY":
                return props.paddingY;
            case "clipContent":
                return props.clipContent;
            case "transformOffsetX":
                return props.transformOffsetX;
            case "transformOffsetY":
                return props.transformOffsetY;
            case "transformScale":
                return props.transformScale;
            case "transformRotation":
                return props.transformRotation;
            case "transformOpacity":
                return props.transformOpacity;
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

/** Initial appearance for `nl.image` (same property groups as container chrome + transform). */
export function createInitialImageAppearance(rectangleLike: RectangleLikeProps): AppearanceModel {
    const propertyGroups: AppearancePropertyGroup[] = CONTAINER_KEY_ORDER.map(key => ({
        key,
        rows: [containerAppearanceRowFromRectangleLike(rectangleLike, key)],
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

/**
 * Append missing property groups for older saved buttons (pre background-fill keys).
 */
export function ensureButtonAppearanceHasAllKeys(model: AppearanceModel, flat: ButtonWidgetProps): AppearanceModel {
    let changed = false;
    const variants = model.variants.map(v => {
        const have = new Set(v.propertyGroups.map(g => g.key));
        const missing = BUTTON_KEY_ORDER.filter(k => !have.has(k));
        if (missing.length === 0) {
            return v;
        }
        changed = true;
        const extra: AppearancePropertyGroup[] = missing.map(key => ({
            key,
            rows: [buttonRowValue(flat, key)],
        }));
        return { ...v, propertyGroups: [...v.propertyGroups, ...extra] };
    });
    return changed ? { ...model, variants } : model;
}

/**
 * Append missing property groups for older saved containers (pre compact background / fill keys).
 */
export function ensureContainerAppearanceHasAllKeys(model: AppearanceModel, flat: ContainerWidgetProps): AppearanceModel {
    let changed = false;
    const variants = model.variants.map(v => {
        const have = new Set(v.propertyGroups.map(g => g.key));
        const missing = CONTAINER_KEY_ORDER.filter(k => !have.has(k));
        if (missing.length === 0) {
            return v;
        }
        changed = true;
        const extra: AppearancePropertyGroup[] = missing.map(key => ({
            key,
            rows: [containerRowValue(flat, key)],
        }));
        return { ...v, propertyGroups: [...v.propertyGroups, ...extra] };
    });
    return changed ? { ...model, variants } : model;
}

/**
 * Append missing property groups for older `nl.image` documents (pre-appearance or pre-transform keys).
 */
export function ensureImageAppearanceHasAllKeys(model: AppearanceModel, element: UIElement): AppearanceModel {
    const rl = getImageWidgetRectangleProps(element);
    let changed = false;
    const variants = model.variants.map(v => {
        const have = new Set(v.propertyGroups.map(g => g.key));
        const missing = CONTAINER_KEY_ORDER.filter(k => !have.has(k));
        if (missing.length === 0) {
            return v;
        }
        changed = true;
        const extra: AppearancePropertyGroup[] = missing.map(key => ({
            key,
            rows: [containerAppearanceRowFromRectangleLike(rl, key)],
        }));
        return { ...v, propertyGroups: [...v.propertyGroups, ...extra] };
    });
    return changed ? { ...model, variants } : model;
}

function imageFillValuesEqual(a: ImageFill, b: ImageFill): boolean {
    if (a.mode !== b.mode) {
        return false;
    }
    if ((a.assetId ?? null) !== (b.assetId ?? null)) {
        return false;
    }
    return JSON.stringify(a.cropPlacement ?? null) === JSON.stringify(b.cropPlacement ?? null);
}

function appearanceImageFillRowIsUnconditional(conditions: AppearanceSystemCondition | null | undefined): boolean {
    if (conditions == null || Object.keys(conditions).length === 0) {
        return true;
    }
    return Object.values(conditions).every(v => v === undefined);
}

function coerceAppearanceRowImageFill(v: unknown): ImageFill | undefined {
    if (v == null || typeof v !== "object" || !("mode" in v)) {
        return undefined;
    }
    return v as ImageFill;
}

/**
 * Mirror `props.imageFill` into appearance so runtime resolution (baseline + appearance overlay)
 * does not keep stale `imageFill` rows when props are edited outside AppearanceAuthoringPanel.
 */
export function syncImageAppearanceImageFillFromProps(model: AppearanceModel, nextFill: ImageFill): AppearanceModel {
    let changed = false;
    const variants = model.variants.map(v => {
        const propertyGroups = v.propertyGroups.map(g => {
            if (g.key !== "imageFill") {
                return g;
            }
            const rows = g.rows.map(row => {
                const prev = coerceAppearanceRowImageFill(row.value);
                if (appearanceImageFillRowIsUnconditional(row.conditions)) {
                    if (prev && imageFillValuesEqual(prev, nextFill)) {
                        return row;
                    }
                    changed = true;
                    return { ...row, value: { ...nextFill } };
                }
                const merged: ImageFill = {
                    mode: nextFill.mode,
                    assetId: prev?.assetId ?? nextFill.assetId ?? null,
                    cropPlacement: nextFill.cropPlacement ?? prev?.cropPlacement,
                };
                if (prev && imageFillValuesEqual(prev, merged)) {
                    return row;
                }
                changed = true;
                return { ...row, value: merged };
            });
            return { ...g, rows };
        });
        return { ...v, propertyGroups };
    });
    return changed ? { ...model, variants } : model;
}

/** Build initial image appearance from a plain props bag (e.g. default element factory). */
export function createInitialImageAppearanceFromProps(props: Record<string, unknown>): AppearanceModel {
    return createInitialImageAppearance(getRectangleLikeProps({ props }));
}

export function isUsableAppearanceModel(appearance: AppearanceModel | null | undefined): appearance is AppearanceModel {
    return Boolean(appearance && appearance.variants.length > 0);
}
