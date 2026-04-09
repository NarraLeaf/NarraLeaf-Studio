import type { AppearancePropertyKey, AppearanceRowValue } from "@shared/types/ui-editor/appearance";
import {
    normalizeElementEffectValues,
    type ElementEffectValues,
} from "@shared/types/ui-editor/effects";

export function readElementEffectValuesFromGetter(
    get: (key: AppearancePropertyKey) => unknown
): ElementEffectValues {
    return normalizeElementEffectValues({
        effectBlur: get("effectBlur"),
        effectBackgroundBlur: get("effectBackgroundBlur"),
        effectShadow: get("effectShadow"),
        effectInnerShadow: get("effectInnerShadow"),
        effectBlend: get("effectBlend"),
        effectGlow: get("effectGlow"),
        effectFilter: get("effectFilter"),
    });
}

const EFFECT_VALUE_KEYS = [
    "effectBlur",
    "effectBackgroundBlur",
    "effectShadow",
    "effectInnerShadow",
    "effectBlend",
    "effectGlow",
    "effectFilter",
] as const satisfies readonly (keyof ElementEffectValues)[];

function fieldEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** Patch only appearance keys whose values changed (supports structured effect fields). */
export function diffPatchElementEffectValues(
    prev: ElementEffectValues,
    next: ElementEffectValues,
    patch: (key: AppearancePropertyKey, value: AppearanceRowValue) => void
): void {
    for (const k of EFFECT_VALUE_KEYS) {
        if (!fieldEqual(prev[k], next[k])) {
            patch(k as AppearancePropertyKey, next[k] as AppearanceRowValue);
        }
    }
}
