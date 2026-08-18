/**
 * Finding the words in a run of plain text.
 *
 * The checker never sees a document, only a string, so this is the whole of its idea of structure.
 * Offsets are indices into that string; the caller that built it is the only thing that can map
 * them back onto whatever they came from.
 */

/** One candidate word and where it sat. */
export type TextWord = {
  start: number;
  end: number;
  word: string;
};

/**
 * A run of letters, with apostrophes and hyphens allowed inside it.
 *
 * Both are kept rather than split on, because both belong to the word in the languages this checks:
 * `don't` and `mother-in-law` are entries a word list carries, and splitting them would mark `t`
 * and `in` as words in their own right. Digits and underscores are matched so that a token
 * containing them is *seen* and then rejected whole - matching only letters would find `abc` inside
 * `abc123` and mark it.
 */
const TOKEN = /[\p{L}\p{M}\p{Nd}_'’-]+/gu;

/** A word must contain a letter, and must contain nothing that rules it out as prose. */
const HAS_LETTER = /\p{L}/u;
const NOT_A_WORD = /[\p{Nd}_]/u;

/**
 * Spans no spellchecker should touch: addresses, mail addresses, and file paths.
 *
 * A script that quotes a URL is quoting a string, not writing prose, and marking half of it as
 * misspellings is noise the author cannot act on - the correction would break the address.
 */
const OPAQUE = /(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|www\.)\S+|\S+@\S+\.\S+/g;

/** Trimmed from the ends of a token: they join words in the middle and punctuate them at the edge. */
const EDGE = /^[-'’]+|[-'’]+$/g;

/**
 * Every word in `text`, in order, with its offsets.
 *
 * What is deliberately not returned: anything shorter than two characters (a lone letter is a
 * label, an initial or a variable, never a spelling), anything holding a digit or an underscore
 * (identifiers, version numbers, filenames), and anything inside a URL, mail address or path.
 */
export function extractWords(text: string): TextWord[] {
  const opaque = opaqueSpans(text);
  const words: TextWord[] = [];
  let opaqueIndex = 0;

  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(text); match !== null; match = TOKEN.exec(text)) {
    const raw = match[0];
    const rawStart = match.index;

    // Both lists run left to right, so the cursor only ever moves forward.
    while (opaqueIndex < opaque.length && opaque[opaqueIndex].end <= rawStart) {
      opaqueIndex += 1;
    }
    if (opaqueIndex < opaque.length && opaque[opaqueIndex].start < rawStart + raw.length) {
      continue;
    }

    const leading = raw.length - raw.replace(/^[-'’]+/, "").length;
    const word = raw.replace(EDGE, "");
    if (word.length < 2 || !HAS_LETTER.test(word) || NOT_A_WORD.test(word)) {
      continue;
    }
    const start = rawStart + leading;
    words.push({ start, end: start + word.length, word });
  }

  return words;
}

function opaqueSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  OPAQUE.lastIndex = 0;
  for (let match = OPAQUE.exec(text); match !== null; match = OPAQUE.exec(text)) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}
