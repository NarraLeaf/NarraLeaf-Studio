/**
 * Shared visual effects model for UI editor widgets.
 * Values are stored on appearance property groups (animated path) or on widget props.effects (static path).
 * Shadow and filter use structured storage; legacy string values are normalized on read.
 */

import {
    parseShadowLikeFragment,
    shadowLayerDataToCss,
    type EffectShadowLayerData,
} from "./shadowLayerCodec";
import { parseSimpleFilter, serializeSimpleFilter, type FilterPresetId } from "./effectFilterCodec";

export type VisualEffectKind =
    | "blur"
    | "backgroundBlur"
    | "shadow"
    /** Text glyphs only (CSS `text-shadow`); not used on rectangle chrome. */
    | "textShadow"
    | "innerShadow"
    | "blend"
    | "glow"
    | "filter";

/** Single shadow/glow layer (no inset — outer vs inner is determined by the effect slot). */
export type EffectShadowLayer = EffectShadowLayerData;

/**
 * Stored shadow field: parsed layer, or raw CSS when parsing fails (legacy / advanced).
 */
export type EffectShadowStored =
    | { storage: "layer"; layer: EffectShadowLayer }
    | { storage: "css"; css: string };

export type EffectFilterStored =
    | { storage: "preset"; preset: FilterPresetId; amount: number }
    | { storage: "css"; css: string };

/** Serialized effect field values (one row per appearance group key maps to these names). */
export type ElementEffectValues = {
    effectBlur: number;
    effectBackgroundBlur: number;
    effectShadow: EffectShadowStored | null;
    /** Text widgets: CSS text-shadow (separate from box-shadow `effectShadow`). */
    effectTextShadow: EffectShadowStored | null;
    effectInnerShadow: EffectShadowStored | null;
    effectBlend: string;
    effectGlow: EffectShadowStored | null;
    effectFilter: EffectFilterStored | null;
};

export const DEFAULT_ELEMENT_EFFECT_VALUES: ElementEffectValues = {
    effectBlur: 0,
    effectBackgroundBlur: 0,
    effectShadow: null,
    effectTextShadow: null,
    effectInnerShadow: null,
    effectBlend: "",
    effectGlow: null,
    effectFilter: null,
};

function clampNonNegative(n: number): number {
    if (!Number.isFinite(n) || n < 0) {
        return 0;
    }
    return n;
}

function trimStr(s: unknown): string {
    if (s == null) {
        return "";
    }
    return String(s).trim();
}

function clampLayer(partial: Partial<EffectShadowLayer>): EffectShadowLayer {
    return {
        offsetX: Number.isFinite(partial.offsetX) ? Number(partial.offsetX) : 0,
        offsetY: Number.isFinite(partial.offsetY) ? Number(partial.offsetY) : 0,
        blur: clampNonNegative(Number(partial.blur)),
        spread: Number.isFinite(partial.spread) ? Number(partial.spread) : 0,
        color: typeof partial.color === "string" && partial.color.trim() ? partial.color.trim() : "#000000",
    };
}

function normalizeEffectShadowField(raw: unknown): EffectShadowStored | null {
    if (raw == null || raw === "") {
        return null;
    }
    if (typeof raw === "string") {
        const t = raw.trim();
        if (!t) {
            return null;
        }
        const p = parseShadowLikeFragment(t);
        if (p.ok) {
            const { offsetX, offsetY, blur, spread, color } = p.value;
            return { storage: "layer", layer: clampLayer({ offsetX, offsetY, blur, spread, color }) };
        }
        return { storage: "css", css: t };
    }
    if (typeof raw === "object" && raw !== null) {
        const o = raw as Record<string, unknown>;
        if (o.storage === "css" && typeof o.css === "string") {
            const css = o.css.trim();
            return css ? { storage: "css", css } : null;
        }
        if (o.storage === "layer" && o.layer && typeof o.layer === "object") {
            const L = o.layer as Record<string, unknown>;
            return { storage: "layer", layer: clampLayer(L as Partial<EffectShadowLayer>) };
        }
        if ("offsetX" in o || "layer" in o) {
            const layer = ("layer" in o && o.layer && typeof o.layer === "object"
                ? (o.layer as Record<string, unknown>)
                : o) as Record<string, unknown>;
            return { storage: "layer", layer: clampLayer(layer as Partial<EffectShadowLayer>) };
        }
    }
    return null;
}

function normalizeEffectFilterField(raw: unknown): EffectFilterStored | null {
    if (raw == null || raw === "") {
        return null;
    }
    if (typeof raw === "string") {
        const t = raw.trim();
        if (!t) {
            return null;
        }
        const p = parseSimpleFilter(t);
        if (p.kind === "preset") {
            return { storage: "preset", preset: p.preset, amount: p.amount };
        }
        return { storage: "css", css: t };
    }
    if (typeof raw === "object" && raw !== null) {
        const o = raw as Record<string, unknown>;
        if (o.storage === "css" && typeof o.css === "string") {
            const css = o.css.trim();
            return css ? { storage: "css", css } : null;
        }
        if (o.storage === "preset" && typeof o.preset === "string" && typeof o.amount === "number") {
            return {
                storage: "preset",
                preset: o.preset as FilterPresetId,
                amount: o.amount,
            };
        }
    }
    return null;
}

/** Normalize partial / unknown input into a full ElementEffectValues object (migrates legacy strings). */
export function normalizeElementEffectValues(raw: unknown): ElementEffectValues {
    if (!raw || typeof raw !== "object") {
        return { ...DEFAULT_ELEMENT_EFFECT_VALUES };
    }
    const o = raw as Record<string, unknown>;
    const blur = typeof o.effectBlur === "number" ? o.effectBlur : Number(o.effectBlur);
    const bb = typeof o.effectBackgroundBlur === "number" ? o.effectBackgroundBlur : Number(o.effectBackgroundBlur);
    return {
        effectBlur: clampNonNegative(Number.isFinite(blur) ? blur : 0),
        effectBackgroundBlur: clampNonNegative(Number.isFinite(bb) ? bb : 0),
        effectShadow: normalizeEffectShadowField(o.effectShadow),
        effectTextShadow: normalizeEffectShadowField(o.effectTextShadow),
        effectInnerShadow: normalizeEffectShadowField(o.effectInnerShadow),
        effectBlend: trimStr(o.effectBlend),
        effectGlow: normalizeEffectShadowField(o.effectGlow),
        effectFilter: normalizeEffectFilterField(o.effectFilter),
    };
}

export type ShadowSlotKind = "outer" | "inner" | "glow";

/** Convert stored shadow to one CSS fragment for box-shadow / text-shadow composition. */
export function effectShadowStoredToCss(value: EffectShadowStored | null, slot: ShadowSlotKind): string {
    if (!value) {
        return "";
    }
    if (value.storage === "css") {
        return value.css.trim();
    }
    const mode = slot === "inner" ? "inner" : slot === "glow" ? "glow" : "outer";
    return shadowLayerDataToCss(value.layer, mode);
}

/** Serialize filter stored value to a CSS filter() fragment (excluding blur() from effectBlur). */
export function effectFilterStoredToCss(value: EffectFilterStored | null): string {
    if (!value) {
        return "";
    }
    if (value.storage === "css") {
        return value.css.trim();
    }
    return serializeSimpleFilter(value.preset, value.amount);
}

/** Appearance / property keys for each effect field (aligned with ContainerAppearancePropertyKey / ButtonAppearancePropertyKey). */
export const EFFECT_APPEARANCE_KEY_BY_KIND: Record<VisualEffectKind, keyof ElementEffectValues> = {
    blur: "effectBlur",
    backgroundBlur: "effectBackgroundBlur",
    shadow: "effectShadow",
    textShadow: "effectTextShadow",
    innerShadow: "effectInnerShadow",
    blend: "effectBlend",
    glow: "effectGlow",
    filter: "effectFilter",
};

/** Which effect kinds each widget type supports (static path: no backgroundBlur on text). */
export const WIDGET_EFFECT_KINDS_BY_TYPE: Record<string, readonly VisualEffectKind[]> = {
    "nl.text": ["blur", "textShadow", "blend", "filter"],
    "nl.dialog.sentence": ["blur", "textShadow", "blend", "filter"],
    "nl.dialog.nametag": ["blur", "textShadow", "blend", "filter"],
    "nl.list": ["blur", "backgroundBlur", "shadow", "innerShadow", "blend", "glow", "filter"],
    "nl.container": [
        "blur",
        "backgroundBlur",
        "shadow",
        "innerShadow",
        "blend",
        "glow",
        "filter",
    ],
    "nl.image": ["blur", "backgroundBlur", "shadow", "innerShadow", "blend", "glow", "filter"],
    "nl.button": ["blur", "backgroundBlur", "shadow", "innerShadow", "blend", "glow", "filter"],
};

export function getSupportedEffectKindsForWidgetType(type: string): readonly VisualEffectKind[] {
    return WIDGET_EFFECT_KINDS_BY_TYPE[type] ?? WIDGET_EFFECT_KINDS_BY_TYPE["nl.container"]!;
}

export function isVisualEffectKind(value: string): value is VisualEffectKind {
    return value in EFFECT_APPEARANCE_KEY_BY_KIND;
}
