/**
 * Which language the script is spellchecked in, and how that is decided.
 *
 * The checking itself is Chromium's: `session.setSpellCheckerLanguages` picks the language, and
 * Chromium fetches the hunspell pack for it on demand and caches it in the Electron profile. So
 * there is no downloader, no dictionary format and no cache here - only the decision of which
 * language to name, which is the one part Chromium cannot make.
 *
 * **Chromium ships no dictionary for Chinese or Japanese.** Neither language has spelling in the
 * hunspell sense, so for a project written in either, {@link resolveSpellcheckLanguage} answers
 * `null` and nothing is ever underlined. That is the correct outcome, not a failure, and the
 * settings row says so rather than showing a control that quietly does nothing.
 *
 * Comments in English per project convention.
 */

/** Global settings key holding the author's choice. */
export const SPELLCHECK_LANGUAGE_KEY = "editor.spellcheckLanguage";

/**
 * Follow the language the project's script is written in (`app.localization.sourceLocale`).
 *
 * The default, because the answer is already in the project and asking for it again is asking the
 * author to repeat themselves - and because the thing being checked is the source script, which is
 * in exactly that language by definition.
 */
export const SPELLCHECK_FOLLOW_PROJECT = "project";

/** Check nothing, whatever the project is written in. */
export const SPELLCHECK_OFF = "off";

export const SPELLCHECK_LANGUAGE_DEFAULT = SPELLCHECK_FOLLOW_PROJECT;

/** What spellchecking is currently doing, as the main process last applied it. */
export type SpellcheckStatus = {
    /**
     * The project's source language, or `""` when the project has not chosen one - and also when no
     * project has configured spellchecking in this session yet.
     */
    sourceLocale: string;
    /** The stored setting: {@link SPELLCHECK_FOLLOW_PROJECT}, {@link SPELLCHECK_OFF}, or a language. */
    setting: string;
    /** The language handed to Chromium, or `null` when nothing is being checked. */
    language: string | null;
    /** Every language this build of Chromium has a dictionary for. */
    available: string[];
};

/**
 * A right click on editable text, as Chromium saw it.
 *
 * The whole reason this crosses a process boundary is {@link misspelledWord}: the spellchecker runs
 * below the page, and the renderer cannot ask it anything. Everything else travels with it because
 * it arrives in the same event and the menu drawn from it needs the lot.
 */
export type SpellcheckContextMenuPayload = {
    /** Viewport coordinates of the click, for placing the menu. */
    x: number;
    y: number;
    /** The word under the pointer if it is misspelled, `""` if it is not (or is not a word). */
    misspelledWord: string;
    /** Chromium's replacements for {@link misspelledWord}. Often empty, which is a real answer. */
    suggestions: string[];
    /** What the standard editing rows may offer here, as Chromium reported it. */
    canCut: boolean;
    canCopy: boolean;
    canPaste: boolean;
};

/** The primary subtag of a language tag: `en-GB` -> `en`. Lower-cased, so comparisons are stable. */
function primarySubtag(code: string): string {
    const separator = code.indexOf("-");
    return (separator < 0 ? code : code.slice(0, separator)).toLowerCase();
}

/**
 * The language Chromium should be told to check in, or `null` for "check nothing".
 *
 * Three ways to answer `null`, and they are all ordinary rather than exceptional: the author turned
 * it off, the project has no source language yet, or the language has no hunspell dictionary at all
 * (Chinese and Japanese, among others).
 *
 * The match runs from exact to loose, because a locale code and a dictionary name agree less often
 * than they look. `en-GB` is named exactly; `de` is named exactly; a bare `en` is not, because the
 * list carries only the regional Englishes - so the last step takes the first of them, and the
 * settings row is where an author who wants a different one says which.
 */
export function resolveSpellcheckLanguage(
    setting: string | undefined,
    sourceLocale: string,
    available: readonly string[],
): string | null {
    if (setting === SPELLCHECK_OFF) {
        return null;
    }
    const desired = (!setting || setting === SPELLCHECK_FOLLOW_PROJECT ? sourceLocale : setting).trim();
    if (!desired) {
        return null;
    }

    const exact = available.find(candidate => candidate.toLowerCase() === desired.toLowerCase());
    if (exact) {
        return exact;
    }

    const primary = primarySubtag(desired);
    const bare = available.find(candidate => candidate.toLowerCase() === primary);
    if (bare) {
        return bare;
    }

    return available.find(candidate => primarySubtag(candidate) === primary) ?? null;
}

/**
 * Whether the author is following the project's language and that language has no dictionary.
 *
 * The one case the settings row has to state outright: the control is set to the answer that is
 * normally right, the project has a language, and no amount of the feature working would produce a
 * single underline. A language the author named themselves is not this case - if they asked for
 * German in a Japanese project, German is what they get.
 */
export function projectLanguageHasNoDictionary(status: SpellcheckStatus): boolean {
    const follows = !status.setting || status.setting === SPELLCHECK_FOLLOW_PROJECT;
    return follows
        && status.sourceLocale !== ""
        && resolveSpellcheckLanguage(SPELLCHECK_FOLLOW_PROJECT, status.sourceLocale, status.available) === null;
}
