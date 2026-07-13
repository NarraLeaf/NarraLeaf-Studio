import {
    createTranslator,
    DEFAULT_LOCALE,
    InterpolationParams,
    Locale,
    LOCALE_META,
    PluralKey,
    TranslationKey,
    Translator,
} from "@shared/i18n";

/**
 * A tiny external store holding the active locale + its translator for one
 * renderer window. `useTranslation` reads it via `useSyncExternalStore`, so a
 * locale change re-renders the whole tree with no context plumbing.
 *
 * The store is the single writer of `<html lang/dir>` and never talks to the
 * bridge itself — persistence and cross-window broadcast are wired in
 * `bootstrap.ts` / `useTranslation.ts`, keeping this module trivially testable.
 */
let currentLocale: Locale = DEFAULT_LOCALE;
let translator: Translator = createTranslator(currentLocale);
const listeners = new Set<() => void>();

function applyDocumentLocale(locale: Locale): void {
    if (typeof document === "undefined") {
        return;
    }
    document.documentElement.lang = LOCALE_META[locale].intl;
    document.documentElement.dir = LOCALE_META[locale].dir;
}

export const i18nStore = {
    getLocale(): Locale {
        return currentLocale;
    },
    getTranslator(): Translator {
        return translator;
    },
    subscribe(listener: () => void): () => void {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },
    /** Swap the active locale and notify subscribers. No-op if unchanged. */
    setLocale(next: Locale): void {
        if (next === currentLocale) {
            return;
        }
        currentLocale = next;
        translator = createTranslator(next);
        applyDocumentLocale(next);
        listeners.forEach((listener) => listener());
    },
};

// Reflect the default locale onto the document before the first paint.
applyDocumentLocale(currentLocale);

/**
 * Imperative translation for non-React code — service notifications, event
 * handler closures, and `.ts` helpers that cannot call the `useTranslation`
 * hook. Reads the window's current locale at call time, so fire-and-forget
 * text (toasts, dialogs, thrown messages that surface to the user) is localized.
 *
 * For text that stays mounted and must re-localize on a live language switch,
 * use the `useTranslation` hook instead — an imperative call is a snapshot.
 */
export function translate(key: TranslationKey, params?: InterpolationParams): string {
    return translator.t(key, params);
}

/** Imperative plural translation. See {@link translate}. */
export function translateN(base: PluralKey, count: number, params?: InterpolationParams): string {
    return translator.tn(base, count, params);
}
