import { Locale } from "../locales";
import { en } from "./en";
import { zh } from "./zh";
import type { LocaleMessages } from "./types";

export type { Messages, LocaleMessages, LocaleNamespace, TranslationKey, PluralKey } from "./types";

/**
 * The full set of catalogs, keyed by locale. `en` is complete; the rest may be
 * partial and fall back to `en` at runtime (see {@link createTranslator}).
 *
 * Note: because renderer apps are bundled without code-splitting, importing this
 * registry pulls every locale into each app bundle. That is fine for a handful
 * of languages (text is tiny next to code). If it ever matters, split catalogs
 * per-namespace and have each app import only the namespaces it renders.
 */
export const CATALOGS: Record<Locale, LocaleMessages> = { en, zh };
