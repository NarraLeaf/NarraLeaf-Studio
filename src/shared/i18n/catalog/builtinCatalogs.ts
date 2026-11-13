import type { Locale } from "../locales";
import { registerBuiltinCatalog } from "../registry";
import { en } from "./en";
import { ja } from "./ja";
import type { LocaleMessages } from "./types";
import { zh } from "./zh";

/**
 * Every built-in catalog, registered with the translator when this module is evaluated.
 *
 * This is what every process gets: the main process, the game runtime, the workers, the tests, and
 * the renderer windows that translate into languages other than their own interface language - the
 * editor writes a widget's default words in the *game's* language, Dev Mode reads the player's.
 * Those lookups are synchronous, so the catalogs have to be present before anyone asks.
 *
 * The small windows that only ever speak their interface language are built with this module
 * replaced by `./builtinCatalogs.lean.ts`; keep the two exporting the same names.
 */
export const CATALOGS: Record<Locale, LocaleMessages> = { en, zh, ja };

registerBuiltinCatalog("zh", zh);
registerBuiltinCatalog("ja", ja);
