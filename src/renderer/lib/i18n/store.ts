import {
    createTranslator,
    DEFAULT_LOCALE,
    getLocaleMeta,
    InterpolationParams,
    LocaleCode,
    normalizeLocale,
    PluralKey,
    subscribeLocaleRegistry,
    TranslationKey,
    Translator,
} from "@shared/i18n";

/**
 * A tiny external store holding the active locale + its translator for one
 * renderer window. `useTranslation` reads it via `useSyncExternalStore`, so a
 * locale change re-renders the whole tree with no context plumbing.
 *
 * The store is the single writer of `<html lang/dir>` and never talks to the
 * bridge itself - persistence and cross-window broadcast are wired in
 * `bootstrap.ts` / `useTranslation.ts`, keeping this module trivially testable.
 *
 * It also subscribes to the shared locale registry: when a plugin language pack
 * is added/removed (or fills the current locale), the registry notifies here and
 * {@link i18nStore.refresh} rebuilds the translator and re-resolves the active
 * locale so mounted UI re-localizes and a locale whose provider vanished degrades
 * to the fallback.
 */
let currentLocale: LocaleCode = DEFAULT_LOCALE;
let translator: Translator = createTranslator(currentLocale);
const listeners = new Set<() => void>();

function applyDocumentLocale(locale: LocaleCode): void {
    if (typeof document === "undefined") {
        return;
    }
    const meta = getLocaleMeta(locale);
    document.documentElement.lang = meta.intl;
    document.documentElement.dir = meta.dir;
}

export const i18nStore = {
    getLocale(): LocaleCode {
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
    setLocale(next: LocaleCode): void {
        if (next === currentLocale) {
            return;
        }
        currentLocale = next;
        translator = createTranslator(next);
        applyDocumentLocale(next);
        listeners.forEach((listener) => listener());
    },
    /**
     * Rebuild the translator without changing the locale value. Called when the
     * locale registry changes: catalog messages for the current locale may have
     * changed, or the current locale's provider may have been removed (in which
     * case the active locale re-resolves to the fallback). Always notifies.
     */
    refresh(): void {
        const resolved = normalizeLocale(currentLocale);
        currentLocale = resolved;
        translator = createTranslator(resolved);
        applyDocumentLocale(resolved);
        listeners.forEach((listener) => listener());
    },
};

// Reflect the default locale onto the document before the first paint.
applyDocumentLocale(currentLocale);

// Re-localize live when a plugin language pack is registered/removed.
subscribeLocaleRegistry(() => i18nStore.refresh());

/**
 * Imperative translation for non-React code - service notifications, event
 * handler closures, and `.ts` helpers that cannot call the `useTranslation`
 * hook. Reads the window's current locale at call time, so fire-and-forget
 * text (toasts, dialogs, thrown messages that surface to the user) is localized.
 *
 * For text that stays mounted and must re-localize on a live language switch,
 * use the `useTranslation` hook instead - an imperative call is a snapshot.
 */
export function translate(key: TranslationKey, params?: InterpolationParams): string {
    return translator.t(key, params);
}

/** Imperative plural translation. See {@link translate}. */
export function translateN(base: PluralKey, count: number, params?: InterpolationParams): string {
    return translator.tn(base, count, params);
}
