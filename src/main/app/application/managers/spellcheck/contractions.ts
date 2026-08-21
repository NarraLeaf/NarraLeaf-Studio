/**
 * English words written with an apostrophe, and why a word list alone cannot rule on them.
 *
 * The word lists this checker reads are pre-expanded: every form a word takes is a line of its own,
 * which is what lets checking be a set lookup with no affix engine behind it. The English list is
 * built from SCOWL, and SCOWL keeps contractions in a category of their own - one this list was
 * merged without. So it carries 24,619 apostrophe forms, every one of them a possessive (`abacus's`),
 * and not one contraction: `don't`, `wasn't`, `you've` and `I'm` are all absent, and a line of
 * dialogue is mostly made of them.
 *
 * Rather than a longer list, a rule. An apostrophe in English joins a word to something that is not
 * a word - a clitic - and the spelling question is about the part in front of it. That is exactly
 * what an affix engine would do with the same input, and it holds for a word the project taught
 * itself too: `Anyo's` is right whenever `Anyo` is.
 *
 * English only, and the caller decides that. A French `l'homme` or an Italian `dell'arte` splits the
 * other way round, and a rule written for one language answering for another is worse than no rule.
 *
 * Comments in English per project convention.
 */

/**
 * What may follow the apostrophe.
 *
 * Closed, and short, because each of these is a form of a word rather than a word: `'ve` is `have`
 * worn down, `'ll` is `will`. `t` is not here - it is the one that needs the letter before the
 * apostrophe to be read as well, and is handled on its own below.
 */
const CLITICS = new Set(["s", "re", "ve", "ll", "d", "m"]);

/**
 * Words that carry an apostrophe and are not a stem plus a clitic.
 *
 * What is left over once the rule below has done its work: negatives whose stem is not a word
 * (`shan't` is not `shan`), and the handful of ordinary words that are spelled with an apostrophe.
 * Deliberately closed and small - it holds what English has, not what an author might type. A
 * dropped-g spelling (`nothin'`) is not here on purpose: it is a voice the author chose, the
 * tokenizer hands it over with the apostrophe trimmed, and the project dictionary is where a script
 * that uses it says so once.
 */
const LEXICALIZED = new Set([
    "ain't",
    "shan't",
    "y'all",
    "o'clock",
    "ma'am",
    "ne'er",
    "e'er",
    "'tis",
    "'twas",
]);

/** Both shapes an author's apostrophe can take. A typographic one is the same word. */
function straighten(word: string): string {
    return word.replace(/’/g, "'");
}

/**
 * Whether an English word written with an apostrophe is spelled correctly, given what the checker
 * already knows.
 *
 * `known` is asked about the part in front of the apostrophe and must answer for everything the
 * checker accepts - the language's own list *and* the project's terms - which is what makes a
 * character name's possessive right without the author teaching it twice.
 *
 * `false` for anything with no apostrophe in it, so a caller can hand every unknown word here.
 */
export function isEnglishContraction(word: string, known: (candidate: string) => boolean): boolean {
    const lower = straighten(word).toLowerCase();
    if (!lower.includes("'")) {
        return false;
    }
    if (LEXICALIZED.has(lower)) {
        return true;
    }

    const apostrophe = lower.lastIndexOf("'");
    const stem = lower.slice(0, apostrophe);
    const tail = lower.slice(apostrophe + 1);
    if (!stem || !tail) {
        return false;
    }

    if (tail === "t") {
        // Two readings, and English uses both: `can't` is `can` with `'t`, `wasn't` is `was` with
        // `n't`. Neither can be preferred without knowing the word, so both are tried - and a
        // stretch that is neither (`was'nt`, a misplaced apostrophe) is still marked.
        return known(stem) || (stem.endsWith("n") && stem.length > 1 && known(stem.slice(0, -1)));
    }

    return CLITICS.has(tail) && known(stem);
}

/**
 * Whether a resolved dictionary language is English, and so whether the rule above applies.
 *
 * The subtag rather than the whole code: the list is downloaded as `en` and the language resolves to
 * whatever the project's source locale spells, `en`, `en-GB` or `en-US`, and all three are the same
 * language for this purpose.
 */
export function isEnglishSpellcheckLanguage(language: string): boolean {
    return language.toLowerCase().split("-")[0] === "en";
}
