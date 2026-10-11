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
 * (`@shared/i18n`, process-agnostic). Shared widget code therefore renders real text with no
 * dependency on the editor store.
 *
 * The language is the shell's (see `../shellLocale`): the game's own, resolved to one of Studio's
 * catalogues the way the game's other Studio words are, or the machine's while no game language is
 * known. Everything this bundle says through `translate` is said inside the author's game, to the
 * player reading it, so it is said in the language they are reading.
 *
 * It changes while the window is open - a language picked on a title screen applies without a
 * restart - so the hook re-renders on a change and the plain functions read the answer at the moment
 * they are called. There is no setter: the game decides the language, not the code that draws in it.
 * All three catalogs are in this bundle either way, since the registry is imported whole.
 */
import { useSyncExternalStore } from "react";
import { createTranslator } from "@shared/i18n";
import type {
    InterpolationParams,
    Locale,
    LocaleCode,
    PluralKey,
    TranslationKey,
    Translator,
} from "@shared/i18n";
import { getShellLocale, subscribeShellLocale } from "../shellLocale";

const translators = new Map<LocaleCode, Translator>();

/**
 * The translator for the shell's language right now. One per language for the life of the page, so
 * `useSyncExternalStore` sees a stable snapshot between changes.
 */
function currentTranslator(): Translator {
    const locale = getShellLocale();
    let translator = translators.get(locale);
    if (!translator) {
        translator = createTranslator(locale);
        translators.set(locale, translator);
    }
    return translator;
}

export interface UseTranslation extends Translator {
    /** No-op in the runtime bundle: there is no Studio language picker here. */
    setLocale(next: Locale): void;
}

const noop = (): void => undefined;

/** Mirrors the editor `i18nStore` surface used by shared widget code, minus mutation. */
export const i18nStore = {
    getLocale(): LocaleCode {
        return getShellLocale();
    },
    getTranslator(): Translator {
        return currentTranslator();
    },
    subscribe(listener: () => void): () => void {
        return subscribeShellLocale(listener);
    },
    setLocale: noop,
};

export function useTranslation(): UseTranslation {
    const translator = useSyncExternalStore(subscribeShellLocale, currentTranslator, currentTranslator);
    return { ...translator, setLocale: noop };
}

export function translate(key: TranslationKey, params?: InterpolationParams): string {
    return currentTranslator().t(key, params);
}

export function translateN(base: PluralKey, count: number, params?: InterpolationParams): string {
    return currentTranslator().tn(base, count, params);
}

/** No-op: the runtime bundle has no persisted-language bootstrap. */
export async function initI18n(): Promise<void> {
    /* intentionally empty */
}
