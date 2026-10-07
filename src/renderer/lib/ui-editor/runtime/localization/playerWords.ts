/**
 * Studio's own words that a player can read: the placeholder drawn where a page or a component
 * cannot be, the label of a choice option the author left empty, a notice the game raises about a
 * save it could not load. Nobody wrote them in the project, so they come from Studio's catalogue -
 * and they are read in the middle of the author's game, so they are in the game's language.
 *
 * The game's language is the one every other word on screen is in: the language the player picked,
 * or matched from the system on first launch, or else the project's source language (see
 * `GameLocalizationRuntime.getLocale`). From there this walks the same chain a translated line walks
 * - the language, then the fallbacks the project declares for it, then the source language - and
 * takes the first one Studio has a catalogue for. A French player of a game written in Chinese, with
 * no French catalogue in Studio, reads these words in Chinese, as they read the rest of that game.
 *
 * Only when no language in that chain has a catalogue - or the game has no language at all, because
 * the project sets none - do the words fall back to `translate`: the editor's interface language in
 * Studio and in Dev Mode, the shell's language in a shipped game - which is this same answer when
 * there is one, so there it is the machine's language.
 *
 * Three readers, matching the three the game's own text has: the React hook beside
 * `useLocalizedWidgetText` (`usePlayerWords`), the story compiler's resolver, and
 * {@link translateForPlayer} for code that runs outside both.
 */

import { createTranslator, matchCatalogLocale } from "@shared/i18n";
import type { InterpolationParams, LocaleCode, TranslationKey, Translator } from "@shared/i18n";
import {
    isKeysOnlyLocalization,
    resolveLocaleChain,
    type GameLocalizationBundle,
} from "@shared/types/localization";
import { translate } from "@/lib/i18n";
import { readRuntimeLocale } from "./runtimeLocale";

/**
 * The catalogue language Studio's words are drawn in for a game being played in `locale`, or null
 * when nothing in the game's chain has one.
 *
 * `locale` is the game's current language; blank means the source language, which is what a game
 * with nothing stored is being read in.
 */
export function playerWordsLocale(
    bundle: Pick<GameLocalizationBundle, "sourceLocale" | "locales">,
    locale: string | null | undefined,
): LocaleCode | null {
    if (isKeysOnlyLocalization(bundle)) {
        return null;
    }
    const current = locale?.trim() ?? "";
    const chain = current ? resolveLocaleChain(bundle, current) : [];
    return matchCatalogLocale([...chain, bundle.sourceLocale]);
}

const translators = new Map<LocaleCode, Translator>();

function translatorFor(locale: LocaleCode): Translator {
    let translator = translators.get(locale);
    if (!translator) {
        translator = createTranslator(locale);
        translators.set(locale, translator);
    }
    return translator;
}

/** `key` in the catalogue language {@link playerWordsLocale} chose, or through `translate` when it chose none. */
export function translatePlayerWords(
    locale: LocaleCode | null,
    key: TranslationKey,
    params?: InterpolationParams,
): string {
    return locale ? translatorFor(locale).t(key, params) : translate(key, params);
}

/**
 * The catalogue language {@link playerWordsLocale} chooses for the game running in this window right
 * now, or null outside a running game or when it chooses none.
 *
 * The one answer both readers outside React take: {@link translateForPlayer}, and the shipped game's
 * shell, which speaks the same language as these words (`src/runtime/renderer/shellLocale.ts`).
 */
export function runningGamePlayerWordsLocale(): LocaleCode | null {
    const { locale, sourceLocale, locales } = readRuntimeLocale();
    return sourceLocale === undefined
        ? null
        : playerWordsLocale({ sourceLocale, locales: [...(locales ?? [])] }, locale);
}

/**
 * `key` in the running game's language, for code that is neither a component nor the story compiler.
 *
 * Read at the moment of the call, so a caller that keeps the words should ask again rather than hold
 * on to them. Outside a running game - the editor, a host that installed no language source - it is
 * `translate`.
 */
export function translateForPlayer(key: TranslationKey, params?: InterpolationParams): string {
    return translatePlayerWords(runningGamePlayerWordsLocale(), key, params);
}
