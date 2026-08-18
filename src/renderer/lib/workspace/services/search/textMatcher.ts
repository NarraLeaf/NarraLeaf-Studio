/**
 * The one text matcher both find surfaces run on.
 *
 * Two hosts ask the same question - the scene find bar ("where is this in the rows on screen?") and
 * the search panel's replace ("where is this in the project?") - and before this they answered it
 * with two different pieces of code. The moment either grew an option the other did not have, the
 * same query started meaning two things depending on which box it was typed into, which is the one
 * failure mode a find/replace feature cannot survive: the author reads a count in one place and
 * presses a button in the other.
 *
 * So the options live here, the compilation lives here, and both hosts hold a {@link CompiledMatcher}.
 * Compiling is not free (it builds three `RegExp`s); a host compiles once per (query, options) change
 * and reuses the result across every string it tests. A matcher is reusable and order-independent -
 * `lastIndex` is reset on entry to every call, never left dangling for the next one.
 *
 * Four things here are deliberate and each one is a bug that has been shipped by somebody:
 *
 *  - **plain matching is a regex too.** The obvious implementation folds case with `toLowerCase()`
 *    and scans with `indexOf`, but folding is not always length preserving (`İ` folds to two code
 *    units), and the offsets that come back then point into a string that is not the one being
 *    spliced. Escaping the literal and letting the `i` flag do the folding keeps every index an
 *    index into the original text.
 *  - **no `u` flag.** It is tempting (it would make `\p{…}` available inside author patterns) and it
 *    is wrong: `u` turns identity escapes into syntax errors, so ordinary patterns people type -
 *    `/\-/`, `/\ /` - stop compiling for no reason the author can see.
 *  - **whole word is not `\b`.** `\b` is defined over `[A-Za-z0-9_]`, which makes every CJK character
 *    a non-word character and therefore makes every position inside Japanese or Chinese prose a word
 *    boundary. This app is aimed squarely at that prose. The boundary test here is the same
 *    `[\p{L}\p{N}]` class the search index scores with (`isWordBoundary` in `searchIndexModel.ts`).
 *  - **a zero-width match must advance the scan.** `a*`, `\b` and `(?=x)` all match the empty string,
 *    and a `g` regex does not move `lastIndex` past an empty match on its own - `exec` returns the
 *    same one forever. Every loop below bumps by one code unit when it sees one.
 */

/** One hit, as offsets into the string that was searched. */
export interface TextRange {
  start: number;
  end: number;
}

export interface TextMatchOptions {
  caseSensitive: boolean;
  /** Both edges of a hit must sit against a non-word character (or the end of the string). */
  wholeWord: boolean;
  /** Read the query as a regular expression rather than as literal text. */
  regex: boolean;
}

export interface CompiledMatcher {
  /** Non-overlapping hits in order. Empty query, or an invalid pattern, yields []. */
  findRanges(text: string): TextRange[];
  /** Cheap existence check for candidate filtering. */
  test(text: string): boolean;
  /** The literal text a hit should be replaced with (expands `$1`..`$9`, `$&`, `$$` in regex mode). */
  expand(text: string, range: TextRange, replacement: string): string;
  /** Set when the pattern could not compile; {@link findRanges} then returns []. */
  error?: string;
}

/**
 * What counts as being "inside a word", for {@link TextMatchOptions.wholeWord}.
 *
 * Mirrors the class `searchIndexModel.isWordBoundary` scores with, on purpose: a hit that the index
 * calls word-initial and the matcher calls mid-word would rank one way and replace another.
 */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && WORD_CHARACTER.test(character);
}

/** A hit qualifies when neither side of it touches a word character. String edges count as edges. */
function isWholeWordAt(text: string, start: number, end: number): boolean {
  return !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end]);
}

function escapeLiteral(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `$$`, `$&` and `$1`..`$9` in a replacement template. Anything else stays literal. */
function expandTemplate(template: string, match: RegExpExecArray): string {
  return template.replace(/\$([$&1-9])/g, (_whole, token: string) => {
    if (token === "$") {
      return "$";
    }
    if (token === "&") {
      return match[0];
    }
    return match[Number(token)] ?? "";
  });
}

/** The answer for "nothing to look for": no hits, and a replacement that is taken literally. */
const NO_MATCHES: CompiledMatcher = {
  findRanges: () => [],
  test: () => false,
  expand: (_text, _range, replacement) => replacement
};

/**
 * Build a matcher for one query.
 *
 * An empty query and an uncompilable pattern land in the same place - no hits - because that is what
 * both hosts need to render: a `[` typed halfway through a character class must leave the field in
 * the danger colour and the row list empty, not throw out of a render.
 */
export function compileMatcher(query: string, options: TextMatchOptions): CompiledMatcher {
  if (!query) {
    return NO_MATCHES;
  }

  const source = options.regex ? query : escapeLiteral(query);
  const caseFlag = options.caseSensitive ? "" : "i";

  let scanner: RegExp;
  let probe: RegExp;
  let anchored: RegExp;
  try {
    // `g` scans, the bare one tests (no `lastIndex` to carry between calls), `y` re-reads one
    // known hit so `expand` can see its capture groups. No `u` - see the note at the top.
    scanner = new RegExp(source, `${caseFlag}g`);
    probe = new RegExp(source, caseFlag);
    anchored = new RegExp(source, `${caseFlag}y`);
  } catch (error) {
    return { ...NO_MATCHES, error: error instanceof Error ? error.message : String(error) };
  }

  const findRanges = (text: string): TextRange[] => {
    const ranges: TextRange[] = [];
    // Reset rather than trust: the previous call may have returned early, and a matcher that
    // remembered where it stopped would give different answers for the same string.
    scanner.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(text)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if (end === start) {
        // Zero width. Without this the same empty match comes back forever.
        scanner.lastIndex = start + 1;
      }
      if (!options.wholeWord || isWholeWordAt(text, start, end)) {
        ranges.push({ start, end });
      }
    }
    return ranges;
  };

  return {
    findRanges,
    test: (text: string): boolean => {
      if (!options.wholeWord) {
        return probe.test(text);
      }
      // A pattern can occur without occurring as a whole word, so the cheap probe is not an
      // answer here - only a scan is.
      return findRanges(text).length > 0;
    },
    expand: (text: string, range: TextRange, replacement: string): string => {
      if (!options.regex || !replacement.includes("$")) {
        return replacement;
      }
      anchored.lastIndex = range.start;
      const match = anchored.exec(text);
      if (!match) {
        return replacement;
      }
      return expandTemplate(replacement, match);
    }
  };
}
