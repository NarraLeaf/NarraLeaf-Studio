import { createTranslator, matchCatalogLocale } from "@shared/i18n";
import { translate } from "@/lib/i18n";
import type { UIWidgetDefaultWords } from "./types";

/**
 * The words a new widget is created with: a text's "Text", a button's "Button", a list's preview rows.
 *
 * They are player-facing words in the game being made, so they are written in the project's source
 * language - the language the author writes the game in - rather than in the language Studio's own
 * interface happens to be shown in: a Chinese game made in an English Studio gets 文本, an English game
 * made in a Chinese Studio gets Text. A widget's name, which only the author reads in the outline,
 * stays in the interface's language.
 *
 * A project whose source language Studio has no catalogue for, or that declares no language at all,
 * gets the interface's language - the words are placeholders the author replaces either way, and
 * English would be no more the game's language than the interface's is.
 *
 * Comments in English per project convention.
 */

/** The interface's language, for a caller with no project behind it. */
export const INTERFACE_DEFAULT_WORDS: UIWidgetDefaultWords = { t: key => translate(key) };

/** The words of new widgets in a project written in `sourceLocale`. */
export function widgetDefaultWordsFor(sourceLocale: string | null | undefined): UIWidgetDefaultWords {
    const locale = sourceLocale?.trim() ? matchCatalogLocale([sourceLocale]) : null;
    if (!locale) {
        return INTERFACE_DEFAULT_WORDS;
    }
    const translator = createTranslator(locale);
    return { t: key => translator.t(key) };
}
