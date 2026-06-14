import type {
    EffectFilterStored,
    EffectShadowStored,
    ElementEffectValues,
    VisualEffectKind,
} from "@shared/types/ui-editor/effects";
import { effectFilterStoredToCss, effectShadowStoredToCss } from "@shared/types/ui-editor/effects";
import type { ShadowSlotKind } from "@shared/types/ui-editor/effects";
import { parseShadowLikeFragment } from "@shared/types/ui-editor/shadowLayerCodec";

/** Stable row order for the effects stack UI (subset filtered by supportedKinds). */
export const EFFECT_STACK_KIND_ORDER: readonly VisualEffectKind[] = [
    "blur",
    "backgroundBlur",
    "shadow",
    "textShadow",
    "innerShadow",
    "blend",
    "glow",
    "filter",
] as const;

export const EFFECT_KIND_LABEL: Record<VisualEffectKind, string> = {
    blur: "Blur",
    backgroundBlur: "Bg blur",
    shadow: "Shadow",
    textShadow: "Text shadow",
    innerShadow: "Inner shadow",
    blend: "Blend",
    glow: "Glow",
    filter: "Filter",
};

function shadowSlotForKind(kind: VisualEffectKind): ShadowSlotKind {
    if (kind === "innerShadow") {
        return "inner";
    }
    if (kind === "glow") {
        return "glow";
    }
    if (kind === "textShadow") {
        return "outer";
    }
    return "outer";
}

const ENABLE_PATCH: Record<VisualEffectKind, Partial<ElementEffectValues>> = {
    blur: { effectBlur: 8 },
    backgroundBlur: { effectBackgroundBlur: 12 },
    shadow: {
        effectShadow: {
            storage: "layer",
            layer: { offsetX: 0, offsetY: 4, blur: 12, spread: 0, color: "rgba(0,0,0,0.28)" },
        },
    },
    textShadow: {
        effectTextShadow: {
            storage: "layer",
            layer: { offsetX: 0, offsetY: 4, blur: 12, spread: 0, color: "rgba(0,0,0,0.28)" },
        },
    },
    innerShadow: {
        effectInnerShadow: {
            storage: "layer",
            layer: { offsetX: 0, offsetY: 2, blur: 4, spread: 0, color: "rgba(0,0,0,0.25)" },
        },
    },
    blend: { effectBlend: "multiply" },
    glow: {
        effectGlow: {
            storage: "layer",
            layer: { offsetX: 0, offsetY: 0, blur: 12, spread: 2, color: "rgba(255,255,255,0.35)" },
        },
    },
    filter: { effectFilter: { storage: "preset", preset: "brightness", amount: 1.05 } },
};

const CLEAR_PATCH: Record<VisualEffectKind, Partial<ElementEffectValues>> = {
    blur: { effectBlur: 0 },
    backgroundBlur: { effectBackgroundBlur: 0 },
    shadow: { effectShadow: null },
    textShadow: { effectTextShadow: null },
    innerShadow: { effectInnerShadow: null },
    blend: { effectBlend: "" },
    glow: { effectGlow: null },
    filter: { effectFilter: null },
};

function shadowStoredEnabled(v: EffectShadowStored | null): boolean {
    if (!v) {
        return false;
    }
    if (v.storage === "css") {
        return v.css.trim().length > 0;
    }
    return true;
}

function filterEnabled(v: EffectFilterStored | null): boolean {
    if (!v) {
        return false;
    }
    if (v.storage === "css") {
        return v.css.trim().length > 0;
    }
    return true;
}

export function isEffectKindEnabled(kind: VisualEffectKind, v: ElementEffectValues): boolean {
    switch (kind) {
        case "blur":
            return v.effectBlur > 0;
        case "backgroundBlur":
            return v.effectBackgroundBlur > 0;
        case "shadow":
            return shadowStoredEnabled(v.effectShadow);
        case "textShadow":
            return shadowStoredEnabled(v.effectTextShadow);
        case "innerShadow":
            return shadowStoredEnabled(v.effectInnerShadow);
        case "blend":
            return v.effectBlend.trim().length > 0;
        case "glow":
            return shadowStoredEnabled(v.effectGlow);
        case "filter":
            return filterEnabled(v.effectFilter);
        default:
            return false;
    }
}

export function enableEffectKindPatch(kind: VisualEffectKind): Partial<ElementEffectValues> {
    return { ...ENABLE_PATCH[kind] };
}

export function clearEffectKindPatch(kind: VisualEffectKind): Partial<ElementEffectValues> {
    return { ...CLEAR_PATCH[kind] };
}

export function listEnabledKindsInOrder(
    v: ElementEffectValues,
    supported: readonly VisualEffectKind[]
): VisualEffectKind[] {
    const set = new Set(supported);
    return EFFECT_STACK_KIND_ORDER.filter(k => set.has(k) && isEffectKindEnabled(k, v));
}

export function listRemainingKinds(
    v: ElementEffectValues,
    supported: readonly VisualEffectKind[]
): VisualEffectKind[] {
    const set = new Set(supported);
    return EFFECT_STACK_KIND_ORDER.filter(k => set.has(k) && !isEffectKindEnabled(k, v));
}

function shadowSummaryStored(v: EffectShadowStored | null, kind: VisualEffectKind): string {
    if (!v) {
        return "";
    }
    if (v.storage === "css") {
        const raw = v.css.trim();
        return raw.length > 22 ? `${raw.slice(0, 20)}…` : raw;
    }
    const css = effectShadowStoredToCss(v, shadowSlotForKind(kind));
    const p = parseShadowLikeFragment(css);
    if (!p.ok) {
        return css.length > 22 ? `${css.slice(0, 20)}…` : css;
    }
    const { offsetX, offsetY, blur, spread } = p.value;
    const sp = spread !== 0 ? ` / ${spread}` : "";
    return `${offsetX}, ${offsetY} · ${blur}px${sp}`;
}

/** One-line preview for the compact row (no long prose). */
export function summarizeEffectKind(kind: VisualEffectKind, v: ElementEffectValues): string {
    switch (kind) {
        case "blur":
            return `${v.effectBlur}px`;
        case "backgroundBlur":
            return `${v.effectBackgroundBlur}px`;
        case "shadow":
            return shadowSummaryStored(v.effectShadow, "shadow");
        case "textShadow":
            return shadowSummaryStored(v.effectTextShadow, "textShadow");
        case "innerShadow":
            return shadowSummaryStored(v.effectInnerShadow, "innerShadow");
        case "glow":
            return shadowSummaryStored(v.effectGlow, "glow");
        case "blend":
            return v.effectBlend || "-";
        case "filter": {
            const f = v.effectFilter;
            if (!f) {
                return "-";
            }
            if (f.storage === "preset") {
                return `${f.preset} ${f.amount}`;
            }
            const t = f.css.trim();
            return t.length > 24 ? `${t.slice(0, 22)}…` : t;
        }
        default:
            return "";
    }
}
