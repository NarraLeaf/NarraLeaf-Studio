import { isButtonCursorValue, type ButtonCursorValue } from "@shared/types/ui-editor/appearance";
import type {
    AppearanceFieldTransition,
    AppearanceModel,
    AppearanceValueRow,
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
    TextAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { ElementEffectValues } from "@shared/types/ui-editor/effects";
import { DEFAULT_ELEMENT_EFFECT_VALUES, normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";
import type { RectangleLikeProps } from "@shared/types/ui-editor/rectangleLike";
import { getRectangleLikeProps } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import { normalizeStrokeSideInput } from "@/lib/ui-editor/widget-modules/shared/chrome/strokeSideSpec";
import {
    buttonPropsToImageFillBaseline,
    getButtonProps,
} from "@/lib/ui-editor/widget-modules/builtin/button/helpers";
import { conditionMatches, type SystemInteractionSignals } from "./SystemInteractionState";
import { isButtonAppearanceKey, isContainerAppearanceKey, isTextAppearanceKey } from "./appearanceWhitelist";
import type { ButtonWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/button/types";
import type { TextWidgetProps } from "@/lib/ui-editor/widget-modules/builtin/text/types";
import { getContainerProps } from "@/lib/ui-editor/widget-modules/builtin/container/helpers";
import { getImageWidgetRectangleProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import {
    isMotionCapableButtonAppearanceKey,
    isMotionCapableContainerAppearanceKey,
    isMotionCapableTextAppearanceKey,
} from "@/lib/ui-editor/widget-modules/shared/appearance/appearanceMotion";
import { getTextProps } from "@/lib/ui-editor/widget-modules/builtin/text/helpers";

/** Flat button props plus border chrome fields resolved from appearance (not stored on element.props). */
export type ButtonResolvedVisualProps = Pick<
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
    | "cursor"
    | "transformOffsetX"
    | "transformOffsetY"
    | "transformScale"
    | "transformRotation"
    | "transformOpacity"
> & {
    strokeOpacity: number;
    strokeSide: string;
    strokeAlign: RectangleLikeProps["strokeAlign"];
    borderJoin: RectangleLikeProps["borderJoin"];
    effects: ElementEffectValues;
};

export type AppearanceResolveContext = {
    /** Runtime override for active variant (e.g. blueprint setVariant in P4). */
    variantOverrideId?: string | null;
    signals: SystemInteractionSignals;
    displayableOpacityKeys?: readonly string[];
};

export type TextResolvedVisualProps = Omit<TextWidgetProps, "appearance">;

export function resolveButtonCursor(
    cursor: ButtonCursorValue,
    interactionDisabled: boolean,
    canDispatchClick: boolean,
): ButtonCursorValue {
    if (interactionDisabled) {
        return "not-allowed";
    }
    if (cursor === "auto") {
        return canDispatchClick ? "pointer" : "default";
    }
    return cursor;
}

function pickLastMatchingRowValue(rows: AppearanceValueRow[], signals: SystemInteractionSignals): unknown {
    return pickLastMatchingRow(rows, signals)?.value;
}

function pickLastMatchingRow(
    rows: AppearanceValueRow[],
    signals: SystemInteractionSignals,
): AppearanceValueRow | null {
    let pickedRow: AppearanceValueRow | null = null;
    for (const row of rows) {
        if (conditionMatches(row.conditions, signals)) {
            pickedRow = row;
        }
    }
    return pickedRow;
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

function collectActiveVariantTransitions<K extends string>(
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext,
    isEligibleKey: (key: string) => key is K
): Partial<Record<K, AppearanceFieldTransition>> {
    if (!isUsableAppearance(appearance)) {
        return {};
    }
    const variant = resolveActiveVariant(appearance, ctx.variantOverrideId);
    if (!variant) {
        return {};
    }
    const out: Partial<Record<K, AppearanceFieldTransition>> = {};
    for (const group of variant.propertyGroups) {
        if (!group.transition || !isEligibleKey(group.key)) {
            continue;
        }
        out[group.key] = group.transition;
    }
    return out;
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

function patchRectangleLikeEffects(target: RectangleLikeProps, patch: Partial<ElementEffectValues>): void {
    target.effects = { ...target.effects, ...patch };
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
            if (s === undefined) {
                break;
            }
            const normalized = normalizeStrokeSideInput(s.trim());
            if (normalized !== undefined) {
                target.strokeSide = normalized;
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
        case "transformOffsetX": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformOffsetX = n;
            }
            break;
        }
        case "transformOffsetY": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformOffsetY = n;
            }
            break;
        }
        case "transformScale": {
            const n = coerceNumber(raw);
            if (n !== undefined && n > 0) {
                target.transformScale = n;
            }
            break;
        }
        case "transformRotation": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformRotation = n;
            }
            break;
        }
        case "transformOpacity": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformOpacity = Math.max(0, Math.min(1, n));
            }
            break;
        }
        case "effectBlur": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                patchRectangleLikeEffects(target, { effectBlur: Math.max(0, n) });
            }
            break;
        }
        case "effectBackgroundBlur": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                patchRectangleLikeEffects(target, { effectBackgroundBlur: Math.max(0, n) });
            }
            break;
        }
        case "effectShadow": {
            patchRectangleLikeEffects(target, {
                effectShadow: normalizeElementEffectValues({ effectShadow: raw }).effectShadow,
            });
            break;
        }
        case "effectInnerShadow": {
            patchRectangleLikeEffects(target, {
                effectInnerShadow: normalizeElementEffectValues({ effectInnerShadow: raw }).effectInnerShadow,
            });
            break;
        }
        case "effectBlend": {
            const s = coerceString(raw);
            if (s !== undefined) {
                patchRectangleLikeEffects(target, { effectBlend: s });
            }
            break;
        }
        case "effectGlow": {
            patchRectangleLikeEffects(target, {
                effectGlow: normalizeElementEffectValues({ effectGlow: raw }).effectGlow,
            });
            break;
        }
        case "effectFilter": {
            patchRectangleLikeEffects(target, {
                effectFilter: normalizeElementEffectValues({ effectFilter: raw }).effectFilter,
            });
            break;
        }
        default:
            break;
    }
}

function applyButtonKey(target: ButtonResolvedVisualProps, key: ButtonAppearancePropertyKey, raw: unknown): void {
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
            if (s === "solid" || s === "dashed" || s === "dotted" || s === "none") {
                target.borderStyle = s;
            }
            break;
        }
        case "strokeOpacity": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.strokeOpacity = Math.max(0, Math.min(1, n));
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
            if (s === undefined) {
                break;
            }
            const normalized = normalizeStrokeSideInput(s.trim());
            if (normalized !== undefined) {
                target.strokeSide = normalized;
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
        case "cursor": {
            if (isButtonCursorValue(raw)) {
                target.cursor = raw;
            }
            break;
        }
        case "transformOffsetX": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformOffsetX = n;
            }
            break;
        }
        case "transformOffsetY": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformOffsetY = n;
            }
            break;
        }
        case "transformScale": {
            const n = coerceNumber(raw);
            if (n !== undefined && n > 0) {
                target.transformScale = n;
            }
            break;
        }
        case "transformRotation": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformRotation = n;
            }
            break;
        }
        case "transformOpacity": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformOpacity = Math.max(0, Math.min(1, n));
            }
            break;
        }
        case "effectBlur": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.effects = { ...target.effects, effectBlur: Math.max(0, n) };
            }
            break;
        }
        case "effectBackgroundBlur": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.effects = { ...target.effects, effectBackgroundBlur: Math.max(0, n) };
            }
            break;
        }
        case "effectShadow": {
            target.effects = {
                ...target.effects,
                effectShadow: normalizeElementEffectValues({ effectShadow: raw }).effectShadow,
            };
            break;
        }
        case "effectTextShadow": {
            target.effects = {
                ...target.effects,
                effectTextShadow: normalizeElementEffectValues({ effectTextShadow: raw }).effectTextShadow,
            };
            break;
        }
        case "effectInnerShadow": {
            target.effects = {
                ...target.effects,
                effectInnerShadow: normalizeElementEffectValues({ effectInnerShadow: raw }).effectInnerShadow,
            };
            break;
        }
        case "effectBlend": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.effects = { ...target.effects, effectBlend: s };
            }
            break;
        }
        case "effectGlow": {
            target.effects = {
                ...target.effects,
                effectGlow: normalizeElementEffectValues({ effectGlow: raw }).effectGlow,
            };
            break;
        }
        case "effectFilter": {
            target.effects = {
                ...target.effects,
                effectFilter: normalizeElementEffectValues({ effectFilter: raw }).effectFilter,
            };
            break;
        }
        default:
            break;
    }
}

function applyTextKey(target: TextResolvedVisualProps, key: TextAppearancePropertyKey, raw: unknown): void {
    switch (key) {
        case "fontAssetId": {
            if (raw == null || raw === "") {
                target.fontAssetId = null;
            } else {
                target.fontAssetId = String(raw);
            }
            break;
        }
        case "fontSize": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.fontSize = Math.min(256, Math.max(1, n));
            }
            break;
        }
        case "fontWeight": {
            const s = coerceString(raw);
            if (s === "normal" || s === "bold" || s === "600") {
                target.fontWeight = s;
            }
            break;
        }
        case "fontStyle": {
            const s = coerceString(raw);
            if (s === "normal" || s === "italic") {
                target.fontStyle = s;
            }
            break;
        }
        case "color": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.color = s;
            }
            break;
        }
        case "lineHeight": {
            const n = coerceNumber(raw);
            if (n !== undefined && n > 0) {
                target.lineHeight = n;
            }
            break;
        }
        case "transformOffsetX": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformOffsetX = n;
            }
            break;
        }
        case "transformOffsetY": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformOffsetY = n;
            }
            break;
        }
        case "transformScale": {
            const n = coerceNumber(raw);
            if (n !== undefined && n > 0) {
                target.transformScale = n;
            }
            break;
        }
        case "transformRotation": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformRotation = n;
            }
            break;
        }
        case "transformOpacity": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.transformOpacity = Math.max(0, Math.min(1, n));
            }
            break;
        }
        case "effectBlur": {
            const n = coerceNumber(raw);
            if (n !== undefined) {
                target.effects = { ...target.effects, effectBlur: Math.max(0, n) };
            }
            break;
        }
        case "effectTextShadow": {
            target.effects = {
                ...target.effects,
                effectTextShadow: normalizeElementEffectValues({ effectTextShadow: raw }).effectTextShadow,
            };
            break;
        }
        case "effectBlend": {
            const s = coerceString(raw);
            if (s !== undefined) {
                target.effects = { ...target.effects, effectBlend: s };
            }
            break;
        }
        case "effectFilter": {
            target.effects = {
                ...target.effects,
                effectFilter: normalizeElementEffectValues({ effectFilter: raw }).effectFilter,
            };
            break;
        }
        default:
            break;
    }
}

function isUsableAppearance(appearance: AppearanceModel | null | undefined): appearance is AppearanceModel {
    return Boolean(appearance && appearance.variants.length > 0);
}

const IMAGE_FILL_DISPLAYABLE_OPACITY_KEYS = ["fillOpacity", "transformOpacity"] as const;
const TRANSFORM_DISPLAYABLE_OPACITY_KEYS = ["transformOpacity"] as const;

export function resolveImageDisplayableOpacityKeys(
    element: UIElement,
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext,
): readonly string[] {
    const resolved = resolveImageRectangleLike(element, appearance, ctx);
    return resolved.fillType === "image"
        ? IMAGE_FILL_DISPLAYABLE_OPACITY_KEYS
        : TRANSFORM_DISPLAYABLE_OPACITY_KEYS;
}

function resolveAppearanceOpacityFromKeys(
    variant: ReturnType<typeof resolveActiveVariant>,
    ctx: AppearanceResolveContext,
    keys: readonly string[],
    defaultVariant?: ReturnType<typeof resolveActiveVariant>,
): { key: string; row: AppearanceValueRow } | null {
    if (!variant) {
        return null;
    }
    const candidates: Array<{ key: string; row: AppearanceValueRow }> = [];
    for (const key of keys) {
        const group = variant.propertyGroups.find(item => item.key === key);
        if (!group) {
            continue;
        }
        const row = pickLastMatchingRow(group.rows, ctx.signals);
        if (row) {
            candidates.push({ key, row });
        }
    }
    if (candidates.length > 1 && defaultVariant && defaultVariant.id !== variant.id) {
        const changed = candidates.find(candidate => {
            const current = coerceNumber(candidate.row.value);
            if (current === undefined) {
                return false;
            }
            const defaultGroup = defaultVariant.propertyGroups.find(item => item.key === candidate.key);
            const defaultRow = defaultGroup ? pickLastMatchingRow(defaultGroup.rows, ctx.signals) : null;
            const baseline = defaultRow ? coerceNumber(defaultRow.value) : undefined;
            return baseline === undefined || baseline !== current;
        });
        if (changed) {
            return changed;
        }
    }
    return candidates[0] ?? null;
}

export function resolveAppearanceDisplayableOpacity(
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext,
): number | null {
    if (!isUsableAppearance(appearance)) {
        return null;
    }
    const variant = resolveActiveVariant(appearance, ctx.variantOverrideId);
    if (!variant) {
        return null;
    }
    const defaultVariant = appearance.variants.find(v => v.id === appearance.defaultVariantId) ?? appearance.variants[0] ?? null;
    const resolved = resolveAppearanceOpacityFromKeys(
        variant,
        ctx,
        ctx.displayableOpacityKeys ?? ["transformOpacity"],
        defaultVariant,
    );
    if (!resolved) {
        return null;
    }
    const isDefaultVariant = defaultVariant?.id === variant.id;
    const hasConditions = Boolean(resolved.row.conditions && Object.keys(resolved.row.conditions).length > 0);
    if (isDefaultVariant && !hasConditions) {
        return null;
    }
    const n = coerceNumber(resolved.row.value);
    return n === undefined ? null : Math.max(0, Math.min(1, n));
}

/**
 * Resolve rectangle-like chrome for `nl.container`: legacy baseline from element props, then appearance overlays.
 * `clipContent` stays on flat `element.props` (merged via `getContainerProps`); it is not driven by appearance
 * rows so variant/hover cannot silently change overflow clipping for containers.
 */
export function resolveContainerRectangleLike(
    element: UIElement,
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext
): RectangleLikeProps {
    // Match `getContainerProps` so sparse on-disk props still get widget defaults before appearance overlay.
    const mergedFlat = getContainerProps(element) as unknown as Record<string, unknown>;
    const baseline = getRectangleLikeProps({ props: mergedFlat });
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

export function resolveContainerAppearanceTransitions(
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext
): Partial<Record<ContainerAppearancePropertyKey, AppearanceFieldTransition>> {
    return collectActiveVariantTransitions(appearance, ctx, isMotionCapableContainerAppearanceKey);
}

/**
 * Resolve rectangle-like chrome for `nl.image` (baseline from image helpers, then appearance overlays).
 */
export function resolveImageRectangleLike(
    element: UIElement,
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext
): RectangleLikeProps {
    const baseline = getImageWidgetRectangleProps(element);
    if (!isUsableAppearance(appearance)) {
        return baseline;
    }
    const variant = resolveActiveVariant(appearance, ctx.variantOverrideId);
    if (!variant) {
        return baseline;
    }
    const defaultVariant = appearance.variants.find(v => v.id === appearance.defaultVariantId) ?? appearance.variants[0] ?? null;
    const next: RectangleLikeProps = { ...baseline };
    const defaultImageFillGroup = defaultVariant?.propertyGroups.find(group => group.key === "imageFill");
    const defaultImageFill = defaultImageFillGroup
        ? pickLastMatchingRowValue(defaultImageFillGroup.rows, ctx.signals)
        : undefined;
    if (defaultImageFill !== undefined) {
        applyContainerKey(next, "imageFill", defaultImageFill);
    }
    for (const group of variant.propertyGroups) {
        const key = group.key;
        if (key === "fillOpacity" || key === "imageFill") {
            continue;
        }
        if (!isContainerAppearanceKey(key)) {
            continue;
        }
        const raw = pickLastMatchingRowValue(group.rows, ctx.signals);
        if (raw === undefined) {
            continue;
        }
        applyContainerKey(next, key, raw);
    }
    // Image-fill opacity doubles as Displayable opacity for image backgrounds; color backgrounds still need it as fill alpha.
    if (next.fillType === "color") {
        const fillOpacityGroup = variant.propertyGroups.find(group => group.key === "fillOpacity");
        const raw = fillOpacityGroup ? pickLastMatchingRowValue(fillOpacityGroup.rows, ctx.signals) : undefined;
        if (raw !== undefined) {
            applyContainerKey(next, "fillOpacity", raw);
        }
    }
    return next;
}

/** Same transition map as container chrome (image reuses container appearance keys). */
export function resolveImageAppearanceTransitions(
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext,
    resolvedRectangleLike?: Pick<RectangleLikeProps, "fillType">,
): Partial<Record<ContainerAppearancePropertyKey, AppearanceFieldTransition>> {
    const transitions = resolveContainerAppearanceTransitions(appearance, ctx);
    if (resolvedRectangleLike?.fillType !== "color") {
        delete transitions.fillOpacity;
    }
    delete transitions.imageFill;
    return transitions;
}

/**
 * Resolve flat button visual props used by `ButtonRenderer` (excluding interactionDisabled).
 */
export function resolveButtonVisualProps(
    element: UIElement,
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext
): ButtonResolvedVisualProps {
    const flat = getButtonProps(element);
    const bl = buttonPropsToImageFillBaseline(flat);
    const baseline: ButtonResolvedVisualProps = {
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
        cursor: flat.cursor,
        transformOffsetX: flat.transformOffsetX,
        transformOffsetY: flat.transformOffsetY,
        transformScale: flat.transformScale,
        transformRotation: flat.transformRotation,
        transformOpacity: flat.transformOpacity,
        strokeOpacity: bl.strokeOpacity,
        strokeSide: bl.strokeSide,
        strokeAlign: bl.strokeAlign,
        borderJoin: bl.borderJoin,
        effects: normalizeElementEffectValues(
            (flat as unknown as Record<string, unknown>).effects ?? DEFAULT_ELEMENT_EFFECT_VALUES
        ),
    };
    if (!isUsableAppearance(appearance)) {
        return baseline;
    }
    const variant = resolveActiveVariant(appearance, ctx.variantOverrideId);
    if (!variant) {
        return baseline;
    }
    const next: ButtonResolvedVisualProps = { ...baseline };
    for (const group of variant.propertyGroups) {
        const key = group.key;
        if (!isButtonAppearanceKey(key)) {
            continue;
        }
        const raw = pickLastMatchingRowValue(group.rows, ctx.signals);
        if (raw === undefined) {
            continue;
        }
        applyButtonKey(next, key, raw);
    }
    return next;
}

export function resolveButtonAppearanceTransitions(
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext
): Partial<Record<ButtonAppearancePropertyKey, AppearanceFieldTransition>> {
    return collectActiveVariantTransitions(appearance, ctx, isMotionCapableButtonAppearanceKey);
}

export function resolveTextVisualProps(
    element: UIElement,
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext
): TextResolvedVisualProps {
    const baseline = getTextProps(element) as TextResolvedVisualProps;
    if (!isUsableAppearance(appearance)) {
        return baseline;
    }
    const variant = resolveActiveVariant(appearance, ctx.variantOverrideId);
    if (!variant) {
        return baseline;
    }
    const next: TextResolvedVisualProps = {
        ...baseline,
        effects: { ...baseline.effects },
    };
    for (const group of variant.propertyGroups) {
        const key = group.key;
        if (!isTextAppearanceKey(key)) {
            continue;
        }
        const raw = pickLastMatchingRowValue(group.rows, ctx.signals);
        if (raw === undefined) {
            continue;
        }
        applyTextKey(next, key, raw);
    }
    return next;
}

export function resolveTextAppearanceTransitions(
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext
): Partial<Record<TextAppearancePropertyKey, AppearanceFieldTransition>> {
    return collectActiveVariantTransitions(appearance, ctx, isMotionCapableTextAppearanceKey);
}

/** Map resolved button visuals to rectangle chrome for `RectangleChromeRenderer` and image-fill diagnostics. */
export function buttonResolvedVisualToRectangleLike(v: ButtonResolvedVisualProps): RectangleLikeProps {
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
        strokeOpacity: v.strokeOpacity,
        strokeAlign: v.strokeAlign,
        strokeSide: v.strokeSide,
        borderJoin: v.borderJoin,
        cornerAdvanced: false,
        transformOffsetX: v.transformOffsetX,
        transformOffsetY: v.transformOffsetY,
        transformScale: v.transformScale,
        transformRotation: v.transformRotation,
        transformOpacity: v.transformOpacity,
        effects: { ...v.effects },
    };
}
