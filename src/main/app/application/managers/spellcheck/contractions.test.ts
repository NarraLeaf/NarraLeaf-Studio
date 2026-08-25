import { describe, expect, it } from "vitest";
import { isEnglishContraction, isEnglishSpellcheckLanguage } from "./contractions";

/**
 * The rule that lets a possessive-only word list rule on contractions.
 *
 * The list this exists for is real and measured: the shipped `en` list holds 104,433 words, 24,619
 * of them apostrophe forms, and every single one of those is a possessive. Not one contraction is in
 * it, which is why a line of dialogue - the thing this product is for - came back with `you've` and
 * `wasn't` underlined.
 *
 * The vocabulary below is what a possessive-only list actually knows, which is why the stems are
 * plain words and none of the contractions are.
 */

const VOCABULARY = new Set([
    "was", "is", "are", "do", "does", "did", "can", "won", "have", "has", "had",
    "you", "we", "they", "it", "there", "who", "that", "she", "he",
    "should", "could", "would", "let", "night", "anyo",
]);

const known = (word: string) => VOCABULARY.has(word.toLowerCase());
const accepts = (word: string) => isEnglishContraction(word, known);

describe("English words written with an apostrophe", () => {
    it("accepts a stem the checker knows plus a clitic", () => {
        expect(accepts("you've")).toBe(true);
        expect(accepts("you're")).toBe(true);
        expect(accepts("you'll")).toBe(true);
        expect(accepts("we'd")).toBe(true);
        expect(accepts("it's")).toBe(true);
        expect(accepts("there's")).toBe(true);
    });

    it("reads a negative both ways, because English writes it both ways", () => {
        // `wasn't` is `was` with `n't`; `can't` is `can` with `'t`. Neither reading can be preferred
        // without knowing the word, so both are tried.
        expect(accepts("wasn't")).toBe(true);
        expect(accepts("doesn't")).toBe(true);
        expect(accepts("can't")).toBe(true);
        expect(accepts("won't")).toBe(true);
    });

    it("accepts the negatives and the ordinary words whose stem is not a word", () => {
        expect(accepts("shan't")).toBe(true);
        expect(accepts("ain't")).toBe(true);
        expect(accepts("o'clock")).toBe(true);
        expect(accepts("ma'am")).toBe(true);
        expect(accepts("y'all")).toBe(true);
    });

    it("takes a typographic apostrophe as the same word", () => {
        expect(accepts("you’ve")).toBe(true);
        expect(accepts("wasn’t")).toBe(true);
        expect(accepts("O’clock")).toBe(true);
    });

    it("is case-insensitive, the way every other lookup here is", () => {
        expect(accepts("You've")).toBe(true);
        expect(accepts("WASN'T")).toBe(true);
    });

    it("accepts the possessive of a word the project taught the checker", () => {
        // The whole reason `known` is one predicate over both sets: a character's name takes a
        // possessive like any other noun, and the author should not have to add it twice.
        expect(accepts("Anyo's")).toBe(true);
        expect(accepts("Kamurocho's")).toBe(false);
    });

    it("still marks a stem that is not a word, and an apostrophe in the wrong place", () => {
        expect(accepts("frobnicate's")).toBe(false);
        expect(accepts("was'nt")).toBe(false);
        expect(accepts("you'xe")).toBe(false);
        // `'ve` on its own is not a word, and neither is a bare stem with nothing after it.
        expect(accepts("'ve")).toBe(false);
        expect(accepts("you'")).toBe(false);
    });

    it("says nothing about a word with no apostrophe, so every unknown word can be handed to it", () => {
        expect(accepts("dont")).toBe(false);
        expect(accepts("was")).toBe(false);
        expect(accepts("")).toBe(false);
    });

    it("applies to English and to nothing else", () => {
        expect(isEnglishSpellcheckLanguage("en")).toBe(true);
        expect(isEnglishSpellcheckLanguage("en-GB")).toBe(true);
        expect(isEnglishSpellcheckLanguage("EN-US")).toBe(true);
        // A French `l'homme` splits the other way round; a rule written for English answering for it
        // would accept anything with an apostrophe in it.
        expect(isEnglishSpellcheckLanguage("fr")).toBe(false);
        expect(isEnglishSpellcheckLanguage("zh-CN")).toBe(false);
    });
});
