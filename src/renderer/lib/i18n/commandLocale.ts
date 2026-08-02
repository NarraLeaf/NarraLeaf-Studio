import {
    createTranslator,
    InterpolationParams,
    LocaleCode,
    TranslationKey,
    Translator,
} from "@shared/i18n";
import { LOCALIZED_COMMANDS_DEFAULT, resolveCommandLocale } from "@/lib/settings/commandLanguageOptions";
import { i18nStore } from "./store";

/**
 * The second locale axis: the language the story editor's *command vocabulary* renders in.
 *
 * Structurally a twin of {@link i18nStore} — same external-store shape, read by
 * `useCommandTranslation` through `useSyncExternalStore` and by `.ts` layers through
 * {@link translateCommand}. It is a separate store rather than a parameter threaded through the
 * command modules because the consumers are spread across pure `.ts` files (the registry's localized
 * token table, the localized param table) that have no React context to read from, and those tables
 * are caches that must be dropped the moment the effective locale changes.
 *
 * Effective locale = the interface locale while translation is on, the source locale while it is off.
 * Subscribing to `i18nStore` is therefore load-bearing twice over: it makes the on state track a
 * language change, and it makes a plugin language pack registering/vanishing rebuild this translator
 * too (`i18nStore.refresh` notifies on the same channel).
 */
let preference: unknown = LOCALIZED_COMMANDS_DEFAULT;
let currentLocale: LocaleCode = resolveCommandLocale(preference, i18nStore.getLocale());
let translator: Translator = createTranslator(currentLocale);
const listeners = new Set<() => void>();

/** Recompute the effective locale; notify only when the resulting translator actually changed. */
function reconcile(): void {
    const next = resolveCommandLocale(preference, i18nStore.getLocale());
    if (next === currentLocale) {
        return;
    }
    currentLocale = next;
    translator = createTranslator(next);
    listeners.forEach((listener) => listener());
}

export const commandI18nStore = {
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
    /**
     * Store the `editor.localizedCommands` value and re-resolve. Wired in `bootstrap.ts` from the
     * persisted value and the main process's global-state broadcast, so a change made in the Settings
     * window reaches every open workspace with no reload.
     */
    setPreference(next: unknown): void {
        preference = next;
        reconcile();
    },
    /**
     * Rebuild against the interface locale as it stands now. Called when `i18nStore` notifies: while
     * translation is on the effective locale just moved, and even while it is off the catalog behind
     * the source locale may have been swapped by a language pack.
     */
    refresh(): void {
        const next = resolveCommandLocale(preference, i18nStore.getLocale());
        currentLocale = next;
        translator = createTranslator(next);
        listeners.forEach((listener) => listener());
    },
};

i18nStore.subscribe(() => commandI18nStore.refresh());

/**
 * Imperative translation in the command locale, for the `.ts` layers that cannot call a hook — the
 * derived token and param alias tables the parser consults. Mirrors `translate` from `./store`; the
 * same caveat applies (it is a snapshot, so mounted UI must use the hook).
 */
export function translateCommand(key: TranslationKey, params?: InterpolationParams): string {
    return translator.t(key, params);
}
