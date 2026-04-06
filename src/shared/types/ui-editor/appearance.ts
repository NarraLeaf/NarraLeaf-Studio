import type { ImageFill } from "@shared/types/ui-editor/imageFill";

/**
 * v1: only system pseudo-state prerequisites on conditional rows (no expressions).
 * A field set to `true` requires the signal to be true; `false` requires false.
 * Omitted keys are not checked.
 */
export type AppearanceSystemCondition = Partial<{
    hovered: boolean;
    active: boolean;
    disabled: boolean;
    focused: boolean;
}>;

/**
 * Serialized value for one row in a property group. Interpretation depends on `AppearancePropertyGroup.key`.
 */
export type AppearanceRowValue =
    | string
    | number
    | boolean
    | null
    | ImageFill
    | Record<string, unknown>;

/**
 * One row: no / empty conditions = default row (always matches unless a later row also matches).
 * Within a group, the last matching row wins.
 */
export type AppearanceValueRow = {
    conditions?: AppearanceSystemCondition | null;
    value: AppearanceRowValue;
};

/** Whitelisted chrome keys for `nl.container` (maps to RectangleLike + container fill typing). */
export type ContainerAppearancePropertyKey =
    | "backgroundColor"
    | "borderRadius"
    | "borderRadiusTL"
    | "borderRadiusTR"
    | "borderRadiusBL"
    | "borderRadiusBR"
    | "borderRadiusLinked"
    | "borderColor"
    | "borderWidth"
    | "borderStyle"
    | "backgroundImage"
    | "backgroundFit"
    | "imageFill"
    | "fillType"
    | "fillVisible"
    | "fillOpacity"
    | "strokeVisible"
    | "strokeOpacity"
    | "strokeAlign"
    | "strokeSide"
    | "borderJoin"
    | "cornerAdvanced";

/** Whitelisted visual keys for `nl.button`. */
export type ButtonAppearancePropertyKey =
    | "backgroundColor"
    | "borderRadius"
    | "borderWidth"
    | "borderColor"
    | "borderStyle"
    | "paddingX"
    | "paddingY"
    | "clipContent";

export type AppearancePropertyGroup =
    | {
          key: ContainerAppearancePropertyKey;
          rows: AppearanceValueRow[];
      }
    | {
          key: ButtonAppearancePropertyKey;
          rows: AppearanceValueRow[];
      };

export type AppearanceVariant = {
    id: string;
    name: string;
    propertyGroups: AppearancePropertyGroup[];
};

export type AppearanceModel = {
    defaultVariantId: string;
    variants: AppearanceVariant[];
};

export function isAppearanceModel(value: unknown): value is AppearanceModel {
    if (!value || typeof value !== "object") {
        return false;
    }
    const v = value as Record<string, unknown>;
    if (typeof v.defaultVariantId !== "string" || !Array.isArray(v.variants)) {
        return false;
    }
    return v.variants.every(
        item =>
            item &&
            typeof item === "object" &&
            typeof (item as AppearanceVariant).id === "string" &&
            typeof (item as AppearanceVariant).name === "string" &&
            Array.isArray((item as AppearanceVariant).propertyGroups),
    );
}
