import { isButtonCursorValue, type ButtonCursorValue } from "@shared/types/ui-editor/appearance";
import type {
    AppearanceFieldTransition,
    AppearanceModel,
    AppearanceValueRow,
    AppearanceVariant,
    ButtonAppearancePropertyKey,
    ContainerAppearancePropertyKey,
    TextAppearancePropertyKey,
} from "@shared/types/ui-editor/appearance";
import type { ElementEffectValues } from "@shared/types/ui-editor/effects";
import { DEFAULT_ELEMENT_EFFECT_VALUES, normalizeElementEffectValues } from "@shared/types/ui-editor/effects";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { GradientFill } from "@shared/types/ui-editor/gradientFill";
import { normalizeGradientFill } from "@shared/types/ui-editor/gradientFill";
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
    | "gradientFill"
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

/**
 * The field transitions in force for the variant showing now.
 *
 * A transition says how a field moves, not which state it moves into, so the inspector writes one to
 * every variant at once (`setGroupTransitionOnAllVariants`). A variant carrying none is therefore a
 * document no inspector wrote - a widget that seeded a transition on the state it flips *to* and left
 * the resting state bare - and reading it literally animates the way there and snaps the way back.
 * Any other variant declaring one for the same field fills that gap, default variant first, so both
 * directions move alike. A transition on the variant showing now still wins, which is what keeps
 * per-variant timing available to anyone who sets one on each.
 */
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
    const collectInto = (source: AppearanceVariant) => {
        for (const group of source.propertyGroups) {
            if (!group.transition || !isEligibleKey(group.key) || out[group.key] !== undefined) {
                continue;
            }
            out[group.key] = group.transition;
        }
    };
    collectInto(variant);
    const defaultVariant = appearance.variants.find(v => v.id === appearance.defaultVariantId);
    if (defaultVariant) {
        collectInto(defaultVariant);
    }
    for (const other of appearance.variants) {
        collectInto(other);
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

/**
 * A row value that is a usable gradient, an explicit clear, or nothing at all.
 *
 * Same three answers as {@link coerceImageFill}, and the difference between the last two is a real
 * instruction rather than a formality: `null` is a row saying "this variant has no gradient", which
 * must overwrite an inherited one, while `undefined` is a row that says nothing and leaves the
 * baseline standing. An unreadable row is not an error either - `normalizeGradientFill` is the
 * read-from-disk path and repairs what it can, so a gradient that comes back `undefined` is one
 * with no honest reading at all, and it declines to override rather than clearing the fill.
 */
function coerceGradientFill(v: unknown): GradientFill | null | undefined {
    if (v === null) {
        return null;
    }
    if (v === undefined) {
        return undefined;
    }
    return normalizeGradientFill(v);
}

const FILL_TYPE_VALUES: readonly RectangleLikeProps["fillType"][] = ["color", "image", "gradient"];

/**
 * A row value that names a fill kind this build can paint.
 *
 * Unlike the other coercions this one is a whitelist rather than a shape test, because the value is
 * a bare string: an unknown one would type-check and then reach a renderer with no branch for it.
 * A row this rejects leaves the flat prop in place, which is the one reading that always paints.
 * Anything added to `RectangleLikeProps["fillType"]` must be added here too, or a variant pinning
 * it is dropped in silence - which is exactly how `"gradient"` was missed before it existed.
 */
function coerceFillType(v: unknown): RectangleLikeProps["fillType"] | undefined {
    const s = coerceString(v);
    if (s === undefined) {
        return undefined;
    }
    return FILL_TYPE_VALUES.includes(s as RectangleLikeProps["fillType"])
        ? (s as RectangleLikeProps["fillType"])
        : undefined;
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
        case "gradientFill": {
            const g = coerceGradientFill(raw);
            if (g !== undefined) {
                target.gradientFill = g;
            }
            break;
        }
        case "fillType": {
            const s = coerceFillType(raw);
            if (s !== undefined) {
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
        case "gradientFill": {
            const g = coerceGradientFill(raw);
            if (g !== undefined) {
                target.gradientFill = g;
            }
            break;
        }
        case "fillType": {
            const s = coerceFillType(raw);
            if (s !== undefined) {
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

/**
 * The offsets an element is drawn at, whatever kind of widget it is.
 *
 * `transformOffsetX/Y` mean the same thing in every appearance model, so this reads them straight off
 * the active variant rather than going through a per-kind resolver. The editor uses it to put the
 * offsets on the node it selects and measures, instead of on a layer inside it.
 */
export function resolveAppearanceTransformOffsets(
    appearance: AppearanceModel | null | undefined,
    ctx: AppearanceResolveContext,
): { x: number; y: number } {
    if (!isUsableAppearance(appearance)) {
        return { x: 0, y: 0 };
    }
    const variant = resolveActiveVariant(appearance, ctx.variantOverrideId);
    if (!variant) {
        return { x: 0, y: 0 };
    }
    const read = (key: string) => {
        const group = variant.propertyGroups.find(g => g.key === key);
        const value = group ? pickLastMatchingRowValue(group.rows, ctx.signals) : undefined;
        return typeof value === "number" && Number.isFinite(value) ? value : 0;
    };
    return { x: read("transformOffsetX"), y: read("transformOffsetY") };
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
    // Image-fill opacity doubles as Displayable opacity for image backgrounds; every other fill kind
    // still needs it as a fill alpha. The test is "not image" rather than "is colour" because a
    // gradient's fill opacity is a fill alpha in exactly the way a colour's is - reading it as the
    // Displayable's opacity would move the widget's whole opacity when the author dimmed its fill.
    if (next.fillType !== "image") {
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
    // Mirrors the gate in `resolveImageRectangleLike`: an image fill's opacity is animated as the
    // Displayable's own, so a `fillOpacity` transition here would run twice. Every other fill kind,
    // gradients included, owns its fill alpha and keeps the transition. A caller that does not hand
    // over the resolved chrome cannot be told apart from an image, so it keeps the old answer.
    if (!resolvedRectangleLike || resolvedRectangleLike.fillType === "image") {
        delete transitions.fillOpacity;
    }
    // Neither fill is a value motion can interpolate - two gradients may differ in kind and in stop
    // count, with no defined path between them - so a transition on either is dropped rather than
    // handed to Motion. The crossfade in the chrome renderer is what actually animates a fill change.
    delete transitions.imageFill;
    delete transitions.gradientFill;
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
        gradientFill: flat.gradientFill,
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
        gradientFill: v.gradientFill,
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
