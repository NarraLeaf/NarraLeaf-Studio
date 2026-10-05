/**
 * A named translation key's text, the one answer both key readers give.
 *
 * `Get Text` is latent and asks the host for the player's language; `Translation Key Text` is pure,
 * resolved while a data pin is read, and so cannot await anything. The two would otherwise each say
 * in their own words what a key reads as - its translation along the fallback chain, else its source
 * text, else nothing for a key the project does not have - and the first difference between them would
 * be a value-bound label and a `Set Text` label disagreeing on one screen.
 *
 * Its own module because both callers must reach it and must not reach each other: the node module
 * imports the data-pin resolver, and the resolver is where the pure node is answered.
 *
 * Comments in English per project convention.
 */

import { resolveLocalizationKeyWords } from "@shared/types/localization";
import type { GameLocalizationConfigSnapshot } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { readRuntimeLocale } from "@/lib/ui-editor/runtime/localization/runtimeLocale";

/**
 * Whether the running game's localization knows this key.
 *
 * A project without a source language ships its keys too (`keysOnlyLocalization`), so this answers
 * for every project; false only outside a running game.
 */
export function hasLocalizationKey(config: GameLocalizationConfigSnapshot | null, keyName: string): boolean {
    return Boolean(config?.keys && Object.prototype.hasOwnProperty.call(config.keys, keyName));
}

/**
 * The key's text in `locale`: its translation, walking the language's fallback chain, else its
 * source text. Null for a key {@link hasLocalizationKey} does not know, so each caller says for
 * itself what an unknown key shows.
 */
export function resolveLocalizationKeyText(
    config: GameLocalizationConfigSnapshot | null,
    locale: string,
    keyName: string,
): string | null {
    if (!config || !hasLocalizationKey(config, keyName)) {
        return null;
    }
    // The answer a keyed widget gives for the same key, from the same function.
    return resolveLocalizationKeyWords({ ...config, tables: config.tables ?? {} }, locale, keyName);
}

/**
 * The player's language, read synchronously, for a reader that cannot await the host's `getLocale`.
 *
 * The same reader every key-bound widget renders with (`runtimeLocale.ts` is installed from the very
 * runtime `GameLocalizationContext` reads), so a value-bound label and a label with a translation key
 * change language on the same frame. Falls back to the source language where no game installed one.
 */
export function readKeyTextLocale(config: GameLocalizationConfigSnapshot | null): string {
    return readRuntimeLocale().locale || config?.sourceLocale || "";
}
