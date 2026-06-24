import type { AppearancePropertyKey, AppearanceRowValue } from "@shared/types/ui-editor/appearance";
import {
    normalizeElementEffectValues,
    type ElementEffectValues,
} from "@shared/types/ui-editor/effects";

export function readElementEffectValuesFromGetter(
    get: (key: AppearancePropertyKey) => unknown,
    options: { includeTextShadow?: boolean } = {}
): ElementEffectValues {
    return normalizeElementEffectValues({
        effectBlur: get("effectBlur"),
        effectBackgroundBlur: get("effectBackgroundBlur"),
        effectShadow: get("effectShadow"),
        effectInnerShadow: get("effectInnerShadow"),
        effectBlend: get("effectBlend"),
        effectGlow: get("effectGlow"),
        effectFilter: get("effectFilter"),
        effectTextShadow: options.includeTextShadow ? get("effectTextShadow") : null,
    });
}

const APPEARANCE_PATCHABLE_EFFECT_KEYS = [
    "effectBlur",
    "effectBackgroundBlur",
    "effectShadow",
    "effectInnerShadow",
    "effectBlend",
    "effectGlow",
    "effectFilter",
] as const satisfies readonly AppearancePropertyKey[];

const APPEARANCE_PATCHABLE_TEXT_EFFECT_KEYS = [
    ...APPEARANCE_PATCHABLE_EFFECT_KEYS,
    "effectTextShadow",
] as const satisfies readonly AppearancePropertyKey[];

function fieldEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** Patch only appearance keys whose values changed (supports structured effect fields). */
export function diffPatchElementEffectValues(
    prev: ElementEffectValues,
    next: ElementEffectValues,
    patch: (key: AppearancePropertyKey, value: AppearanceRowValue) => void,
    options: { includeTextShadow?: boolean } = {}
): void {
    const keys = options.includeTextShadow ? APPEARANCE_PATCHABLE_TEXT_EFFECT_KEYS : APPEARANCE_PATCHABLE_EFFECT_KEYS;
    for (const k of keys) {
        if (!fieldEqual(prev[k], next[k])) {
            patch(k, next[k] as AppearanceRowValue);
        }
    }
}
