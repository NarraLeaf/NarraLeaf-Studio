import { getBuiltinCatalog } from "../registry";
import { SUPPORTED_LOCALES, type Locale } from "../locales";
import type { LocaleMessages } from "./types";

/**
 * The stand-in for `./builtinCatalogs.ts` in the small renderer windows (the list is in
 * `project/build/rendererLocales.js`). It registers nothing: such a window loads the one language it
 * is shown in with `loadBuiltinCatalog` before it first paints, and another on a language switch.
 *
 * `CATALOGS` answers with what is loaded so far, so the export keeps its shape; nothing in those
 * windows reads it.
 */
export const CATALOGS = Object.fromEntries(
    SUPPORTED_LOCALES.map(locale => [locale, undefined]),
) as unknown as Record<Locale, LocaleMessages>;

for (const locale of SUPPORTED_LOCALES) {
    Object.defineProperty(CATALOGS, locale, {
        enumerable: true,
        get: () => getBuiltinCatalog(locale),
    });
}
