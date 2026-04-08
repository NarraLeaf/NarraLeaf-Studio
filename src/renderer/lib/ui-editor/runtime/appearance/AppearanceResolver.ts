import type {
    AppearanceModel,
    AppearanceValueRow,
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { getRectangleLikeProps } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { conditionMatches, type SystemInteractionSignals } from "./SystemInteractionState";
import { isButtonAppearanceKey, isContainerAppearanceKey } from "./appearanceWhitelist";
import { getButtonProps } from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import type { ButtonWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/button/types";

export type AppearanceResolveContext = {
    /** Runtime override for active variant (e.g. blueprint setVariant in P4). */
    variantOverrideId?: string | null;
    signals: SystemInteractionSignals;
};

function pickLastMatchingRowValue(rows: AppearanceValueRow[], signals: SystemInteractionSignals): unknown {
    let picked: unknown = undefined;
    for (const row of rows) {
        if (conditionMatches(row.conditions, signals)) {
            picked = row.value;
        }
    }
    return picked;
}

function resolveActiveVariant(appearance: AppearanceModel, variantOverrideId?: string | null) {
    if (variantOverrideId) {
        const byOverride = appearance.variants.find(v => v.id === variantOverrideId);
        if (byOverride) {
            return byOverride;
        }
    }
    const byDefault = appearance.variants.find(v => v.id === appearance.defaultVariantId);
    if (byDefault) {
        return byDefault;
    }
    return appearance.variants[0] ?? null;
}

function coerceString(v: unknown): string | undefined {
    if (v == null) {
        return undefined;
    }
    return String(v);
}

function coerceNumber(v: unknown): number | undefined {
    if (typeof v === "number" && Number.isFinite(v)) {
        return v;
    }
    if (typeof v === "string" && v.trim() !== "") {
        const n = Number(v);
        if (Number.isFinite(n)) {
            return n;
        }
    }
    return undefined;
}

function coerceBool(v: unknown): boolean | undefined {
    if (typeof v === "boolean") {
        return v;
    }
    return undefined;
}

function coerceImageFill(v: unknown): ImageFill | null | undefined {
    if (v == null) {
        return undefined;
    }
    if (typeof v === "object" && v !== null && "mode" in v) {
        return v as ImageFill;
    }
    return undefined;
}

function applyContainerKey(target: RectangleLikeProps, key: ContainerAppearancePropertyKey, raw: unknown): void {
    switch (key) {
        case "backgroundColor": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.backgroundColor = s;
            }
            break;
        }
        case "borderRadius": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.borderRadius = n;
            }
            break;
        }
        case "borderRadiusTL": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.borderRadiusTL = n;
            }
            break;
        }
        case "borderRadiusTR": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.borderRadiusTR = n;
            }
            break;
        }
        case "borderRadiusBL": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.borderRadiusBL = n;
            }
            break;
        }
        case "borderRadiusBR": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.borderRadiusBR = n;
            }
            break;
        }
        case "borderRadiusLinked": {
            const b = coerceBool(raw);
            if (b !== undefined) {
                target.borderRadiusLinked = b;
            }
            break;
        }
        case "borderColor": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.borderColor = s;
            }
            break;
        }
        case "borderWidth": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.borderWidth = n;
            }
            break;
        }
        case "borderStyle": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.borderStyle = s;
            }
            break;
        }
        case "backgroundImage": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.backgroundImage = s;
            }
            break;
        }
        case "backgroundFit": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.backgroundFit = s;
            }
            break;
        }
        case "imageFill": {
            const f = coerceImageFill(raw);
            if (f !== undefined) {
                target.imageFill = f;
            }
            break;
        }
        case "fillType": {
            const s = coerceString(raw);
            if (s === "color" || s === "image") {
                target.fillType = s;
            }
            break;
        }
        case "fillVisible": {
            const b = coerceBool(raw);
            if (b !== undefined) {
                target.fillVisible = b;
            }
            break;
        }
        case "fillOpacity": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.fillOpacity = n;
            }
            break;
        }
        case "strokeVisible": {
            const b = coerceBool(raw);
            if (b !== undefined) {
                target.strokeVisible = b;
            }
            break;
        }
        case "strokeOpacity": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.strokeOpacity = n;
            }
            break;
        }
        case "strokeAlign": {
            const s = coerceString(raw);
            if (s === "none" || s === "center" || s === "inside" || s === "outside") {
                target.strokeAlign = s;
            }
            break;
        }
        case "strokeSide": {
            const s = coerceString(raw);
            if (s === "all" || s === "top" || s === "right" || s === "bottom" || s === "left") {
                target.strokeSide = s;
            }
            break;
        }
        case "borderJoin": {
            const s = coerceString(raw);
            if (s === "miter" || s === "round" || s === "bevel") {
                target.borderJoin = s;
            }
            break;
        }
        case "cornerAdvanced": {
            const b = coerceBool(raw);
            if (b !== undefined) {
                target.cornerAdvanced = b;
            }
            break;
        }
        default:
            break;
    }
}

function applyButtonKey(target: ButtonWidgetProps, key: ButtonAppearancePropertyKey, raw: unknown): void {
    switch (key) {
        case "backgroundColor": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.backgroundColor = s;
            }
            break;
        }
        case "backgroundImage": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.backgroundImage = s;
            }
            break;
        }
        case "backgroundFit": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.backgroundFit = s;
            }
            break;
        }
        case "imageFill": {
            const f = coerceImageFill(raw);
            if (f !== undefined) {
                target.imageFill = f;
            }
            break;
        }
        case "fillType": {
            const s = coerceString(raw);
            if (s === "color" || s === "image") {
                target.fillType = s;
            }
            break;
        }
        case "fillVisible": {
            const b = coerceBool(raw);
            if (b !== undefined) {
                target.fillVisible = b;
            }
            break;
        }
        case "fillOpacity": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.fillOpacity = n;
            }
            break;
        }
        case "borderRadius": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.borderRadius = n;
            }
            break;
        }
        case "borderWidth": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.borderWidth = n;
            }
            break;
        }
        case "borderColor": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.borderColor = s;
            }
            break;
        }
        case "borderStyle": {
            const s = coerceString(raw);
            if (s === "solid" || s === "dashed" || s === "none") {
                target.borderStyle = s;
            }
            break;
        }
        case "paddingX": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.paddingX = n;
            }
            break;
        }
        case "paddingY": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.paddingY = n;
            }
            break;
        }
        case "clipContent": {
            const b = coerceBool(raw);
            if (b !== undefined) {
                target.clipContent = b;
            }
            break;
        }
        default:
            break;
    }
}

function isUsableAppearance(appearance: AppearanceModel | null | undefined): appearance is AppearanceModel {
    return Boolean(appearance && appearance.variants.length > 0);
}

/**
 * Resolve rectangle-like chrome for `nl.container`: legacy baseline from element props, then appearance overlays.
 */
export function resolveContainerRectangleLike(
    element: UIElement,
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext
): RectangleLikeProps {
    const baseline = getRectangleLikeProps(element);
    if (!isUsableAppearance(appearance)) {
        return baseline;
    }
    const variant = resolveActiveVariant(appearance, ctx.variantOverrideId);
    if (!variant) {
        return baseline;
    }
    const next: RectangleLikeProps = { ...baseline };
    for (const group of variant.propertyGroups) {
        const key = group.key;
        if (!isContainerAppearanceKey(key)) {
            continue;
        }
        const raw = pickLastMatchingRowValue(group.rows, ctx.signals);
        if (raw === undefined) {
            continue;
        }
        applyContainerKey(next, key, raw);
    }
    return next;
}

/**
 * Resolve flat button visual props used by `ButtonRenderer` (excluding interactionDisabled).
 */
export function resolveButtonVisualProps(
    element: UIElement,
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext
): Pick<
    ButtonWidgetProps,
    | "backgroundColor"
    | "fillType"
    | "fillOpacity"
    | "fillVisible"
    | "imageFill"
    | "backgroundImage"
    | "backgroundFit"
    | "borderRadius"
    | "borderWidth"
    | "borderColor"
    | "borderStyle"
    | "paddingX"
    | "paddingY"
    | "clipContent"
> {
    const flat = getButtonProps(element);
    const baseline = {
        backgroundColor: flat.backgroundColor,
        fillType: flat.fillType,
        fillOpacity: flat.fillOpacity,
        fillVisible: flat.fillVisible,
        imageFill: flat.imageFill,
        backgroundImage: flat.backgroundImage,
        backgroundFit: flat.backgroundFit,
        borderRadius: flat.borderRadius,
        borderWidth: flat.borderWidth,
        borderColor: flat.borderColor,
        borderStyle: flat.borderStyle,
        paddingX: flat.paddingX,
        paddingY: flat.paddingY,
        clipContent: flat.clipContent,
    };
    if (!isUsableAppearance(appearance)) {
        return baseline;
    }
    const variant = resolveActiveVariant(appearance, ctx.variantOverrideId);
    if (!variant) {
        return baseline;
    }
    const next = { ...baseline };
    for (const group of variant.propertyGroups) {
        const key = group.key;
        if (!isButtonAppearanceKey(key)) {
            continue;
        }
        const raw = pickLastMatchingRowValue(group.rows, ctx.signals);
        if (raw === undefined) {
            continue;
        }
        applyButtonKey(next as ButtonWidgetProps, key, raw);
    }
    return next;
}

/** Map resolved button visuals to rectangle chrome for `RectangleChromeRenderer` and image-fill diagnostics. */
export function buttonResolvedVisualToRectangleLike(
    v: Pick<
        ButtonWidgetProps,
        | "backgroundColor"
        | "fillType"
        | "fillOpacity"
        | "fillVisible"
        | "imageFill"
        | "backgroundImage"
        | "backgroundFit"
        | "borderRadius"
        | "borderWidth"
        | "borderColor"
        | "borderStyle"
    >
): RectangleLikeProps {
    const r = v.borderRadius;
    const hasBorder = v.borderStyle !== "none" && v.borderWidth > 0;
    return {
        backgroundColor: v.backgroundColor,
        borderRadius: r,
        borderRadiusTL: r,
        borderRadiusTR: r,
        borderRadiusBL: r,
        borderRadiusBR: r,
        borderRadiusLinked: true,
        borderColor: v.borderColor,
        borderWidth: v.borderWidth,
        borderStyle: v.borderStyle === "none" ? "solid" : v.borderStyle,
        backgroundImage: v.backgroundImage,
        backgroundFit: v.backgroundFit,
        imageFill: v.imageFill,
        fillType: v.fillType,
        fillVisible: v.fillVisible,
        fillOpacity: v.fillOpacity,
        strokeVisible: hasBorder,
        strokeOpacity: 1,
        strokeAlign: "center",
        strokeSide: "all",
        borderJoin: "miter",
        cornerAdvanced: false,
    };
}
