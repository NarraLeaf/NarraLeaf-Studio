export type { Messages, LocaleMessages, LocaleNamespace, TranslationKey, PluralKey } from "./types";

/**
 * The full set of catalogs, keyed by locale. `en` is complete; the rest may be partial and fall
 * back to `en` at runtime (see {@link createTranslator}).
 *
 * Importing this module registers every built-in catalog with the translator, as a side effect of
 * `./builtinCatalogs`. The small renderer windows are built with that module swapped for
 * `./builtinCatalogs.lean`, which registers nothing and leaves the window to load the one language
 * it is shown in: three languages are ~2.6 MB of script, nine tenths of a confirmation dialog.
 */
export { CATALOGS } from "./builtinCatalogs";
export { loadBuiltinCatalog } from "./loadBuiltinCatalog";
