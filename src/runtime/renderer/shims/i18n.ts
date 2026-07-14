/**
 * Runtime shim for the Studio renderer i18n bindings (`@/lib/i18n`).
 *
 * Widget modules and their renderers are shared between the Studio editor and the
 * game runtime. In the editor they localize through `src/renderer/lib/i18n` (a live
 * store backed by global state + IPC broadcast + `<html lang>`). That store is
 * Studio-only and must never enter the runtime bundle, so `build-runtime.js` aliases
 * `@/lib/i18n` to this shim.
 *
 * The shim resolves the same catalog keys against the shared i18n core
 * (`@shared/i18n`, process-agnostic) using a fixed source-locale translator. Shared
 * widget code therefore renders real text (the source-locale strings that were
 * hardcoded here before i18n) with no dependency on the editor store and no live
 * locale switching (the runtime has no Studio language picker).
 */
import { createTranslator, DEFAULT_LOCALE } from "@shared/i18n";
import type {
    InterpolationParams,
    Locale,
    PluralKey,
    TranslationKey,
    Translator,
} from "@shared/i18n";

const translator: Translator = createTranslator(DEFAULT_LOCALE);

export interface UseTranslation extends Translator {
    /** No-op in the runtime bundle: there is no Studio language picker here. */
    setLocale(next: Locale): void;
}

const noop = (): void => undefined;
const noopUnsubscribe = (): (() => void) => noop;

/** Mirrors the editor `i18nStore` surface used by shared widget code, minus mutation. */
export const i18nStore = {
    getLocale(): Locale {
        return DEFAULT_LOCALE;
    },
    getTranslator(): Translator {
        return translator;
    },
    subscribe(): () => void {
        return noopUnsubscribe();
    },
    setLocale: noop,
};

export function useTranslation(): UseTranslation {
    return { ...translator, setLocale: noop };
}

export function translate(key: TranslationKey, params?: InterpolationParams): string {
    return translator.t(key, params);
}

export function translateN(base: PluralKey, count: number, params?: InterpolationParams): string {
    return translator.tn(base, count, params);
}

/** No-op: the runtime bundle has no persisted-language bootstrap. */
export async function initI18n(): Promise<void> {
    /* intentionally empty */
}
