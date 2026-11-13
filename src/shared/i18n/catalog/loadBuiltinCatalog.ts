import { isLocale, type Locale, type LocaleCode } from "../locales";
import { isBuiltinCatalogLoaded, registerBuiltinCatalog } from "../registry";
import type { LocaleMessages } from "./types";

/**
 * Where each non-source catalog comes from when a window has to fetch it. English is always
 * present. Typed over every locale but English, so adding a built-in language without a loader here
 * fails the type check rather than the window.
 */
const LOADERS: Record<Exclude<Locale, "en">, () => Promise<LocaleMessages>> = {
    zh: () => import("./zh").then(module => module.zh),
    ja: () => import("./ja").then(module => module.ja),
};

const inFlight = new Map<Locale, Promise<void>>();

/**
 * Make sure a built-in catalog is registered, loading it if this window does not have it yet.
 *
 * A no-op everywhere the full set is registered at start-up, which is everywhere but the small
 * windows. Resolves once the translator can answer in that language; a plugin-only locale or one
 * already loaded resolves at once. A failed load leaves the window in English rather than failing
 * it, and the next ask tries again.
 */
export function loadBuiltinCatalog(code: LocaleCode): Promise<void> {
    if (!isLocale(code) || code === "en" || isBuiltinCatalogLoaded(code)) {
        return Promise.resolve();
    }
    let pending = inFlight.get(code);
    if (!pending) {
        pending = LOADERS[code]()
            .then(messages => registerBuiltinCatalog(code, messages))
            .catch(error => {
                console.warn(`[i18n] Failed to load the "${code}" catalog; showing English.`, error);
            })
            .finally(() => inFlight.delete(code));
        inFlight.set(code, pending);
    }
    return pending;
}
