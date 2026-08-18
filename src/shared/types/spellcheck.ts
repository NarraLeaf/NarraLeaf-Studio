/**
 * Spellchecking: which language the script is checked in, what a dictionary is, and what the
 * checker answers.
 *
 * The checking is Studio's own and runs in the main process. That is a deliberate replacement for
 * Chromium's built-in spellchecker, which fetched its `.bdic` packs from Google's servers by itself
 * - a remote read that never passed through the main process, beside a codebase whose rule is that
 * every remote byte does (see `renderer-never-touches-network` and the project's network policy).
 * Studio now names the index it reads, verifies what comes back, and keeps it in a cache the author
 * can see and clear.
 *
 * A dictionary here is a **pre-expanded word list**: plain text, one word per line, gzipped. Not
 * hunspell - an affix engine would be a new runtime dependency, and the trade it would buy (smaller
 * files, morphological coverage) is not worth adding one for. Checking is therefore a set lookup and
 * suggesting is a bounded edit distance.
 *
 * **Languages that do not put spaces between words have no dictionary and never will.** Chinese and
 * Japanese have no spelling in the word-list sense, so {@link resolveSpellcheckLanguage} answers
 * `null` for them and nothing is ever marked. That is the correct outcome, not a failure, and the
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

/** At most this many replacements are offered for one misspelling. Past this it is a word list. */
export const SPELLCHECK_MAX_SUGGESTIONS = 5;

/**
 * How far {@link SPELLCHECK_MAX_SUGGESTIONS} may reach: two edits, counting a transposition as one.
 *
 * Three would make the search an order of magnitude wider and start answering with words that share
 * nothing an author would recognise as their mistake.
 */
export const SPELLCHECK_MAX_EDIT_DISTANCE = 2;

/**
 * One misspelling, as offsets into the text that was checked.
 *
 * Plain-text offsets and not DOM positions: the checker never sees the document, only a string, and
 * the caller that produced the string is the only thing that can map a range back onto whatever it
 * came from.
 */
export type SpellcheckRange = {
  /** Index of the first character of the word. */
  start: number;
  /** Index one past its last character. */
  end: number;
  /** The word itself, so a caller can act on it without slicing the text again. */
  word: string;
};

/** A dictionary Studio has on disk and can check against right now. */
export type InstalledSpellcheckDictionary = {
  /** Language tag, e.g. `en-GB`. The name of the file in the cache, so it is path-safe. */
  code: string;
  /** Display name as the index gave it, e.g. `English (United Kingdom)`. */
  name: string;
  /** Bytes on disk, compressed. What the cache list shows and what removing it frees. */
  bytes: number;
};

/**
 * A dictionary the index offers.
 *
 * {@link license} travels with it and is not optional: only permissively licensed word lists are
 * hosted, and "permissive" is a claim that has to be displayable next to the thing it describes.
 */
export type AvailableSpellcheckDictionary = {
  code: string;
  name: string;
  /** Compressed size, so the download can be described before it starts. */
  bytes: number;
  /** SPDX-style identifier, shown beside the entry. */
  license: string;
};

/** What spellchecking is currently doing, as the main process last worked it out. */
export type SpellcheckStatus = {
  /**
   * The project's source language, or `""` when the project has not chosen one - and also when no
   * project has configured spellchecking in this session yet.
   */
  sourceLocale: string;
  /** The stored setting: {@link SPELLCHECK_FOLLOW_PROJECT}, {@link SPELLCHECK_OFF}, or a language. */
  setting: string;
  /** The language being checked, or `null` when nothing is. */
  language: string | null;
  /** Every language a dictionary is installed for. Empty until the author downloads one. */
  available: string[];
};

/** The primary subtag of a language tag: `en-GB` -> `en`. Lower-cased, so comparisons are stable. */
function primarySubtag(code: string): string {
  const separator = code.indexOf("-");
  return (separator < 0 ? code : code.slice(0, separator)).toLowerCase();
}

/**
 * The language to check in, or `null` for "check nothing".
 *
 * Three ways to answer `null`, and they are all ordinary rather than exceptional: the author turned
 * it off, the project has no source language yet, or no dictionary is installed for the language
 * this project is written in.
 *
 * The match runs from exact to loose, because a locale code and a dictionary name agree less often
 * than they look. `en-GB` is named exactly; `de` is named exactly; a bare `en` is not, if only the
 * regional Englishes are installed - so the last step takes the first of them, and the settings row
 * is where an author who wants a different one says which.
 */
export function resolveSpellcheckLanguage(
  setting: string | undefined,
  sourceLocale: string,
  available: readonly string[]
): string | null {
  if (setting === SPELLCHECK_OFF) {
    return null;
  }
  const desired = (
    !setting || setting === SPELLCHECK_FOLLOW_PROJECT ? sourceLocale : setting
  ).trim();
  if (!desired) {
    return null;
  }

  const exact = available.find((candidate) => candidate.toLowerCase() === desired.toLowerCase());
  if (exact) {
    return exact;
  }

  const primary = primarySubtag(desired);
  const bare = available.find((candidate) => candidate.toLowerCase() === primary);
  if (bare) {
    return bare;
  }

  return available.find((candidate) => primarySubtag(candidate) === primary) ?? null;
}

/**
 * Whether the author is following the project's language and no dictionary covers it.
 *
 * The one case the settings row has to state outright: the control is set to the answer that is
 * normally right, the project has a language, and no amount of the feature working would produce a
 * single underline. A language the author named themselves is not this case - if they asked for
 * German in a Japanese project, German is what they get.
 */
export function projectLanguageHasNoDictionary(status: SpellcheckStatus): boolean {
  const follows = !status.setting || status.setting === SPELLCHECK_FOLLOW_PROJECT;
  return (
    follows &&
    status.sourceLocale !== "" &&
    resolveSpellcheckLanguage(SPELLCHECK_FOLLOW_PROJECT, status.sourceLocale, status.available) ===
      null
  );
}
