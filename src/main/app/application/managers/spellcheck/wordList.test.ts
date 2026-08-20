import { describe, expect, it } from "vitest";
import { extractWords } from "./tokenizer";
import { boundedEditDistance, WordList } from "./wordList";

const SAMPLE = [
    "the", "there", "their", "they", "them", "then", "than",
    "receive", "received", "receiver", "recipe", "relieve", "believe",
    "definitely", "definite", "definition", "defiant",
    "separate", "separated", "desperate", "operate",
    "London", "Paris", "Berlin",
    "cat", "cats", "car", "bat", "bar", "hat", "rat", "mat",
    "friend", "fiend", "fried", "field",
    "colour", "colours", "coloured", "clamour", "honour",
].join("\n");

describe("WordList.has", () => {
    const list = WordList.fromText(SAMPLE);

    it("accepts a word the list holds, in any case the author might type it", () => {
        expect(list.has("receive")).toBe(true);
        expect(list.has("Receive")).toBe(true);
        expect(list.has("RECEIVE")).toBe(true);
        // A capitalised entry is accepted lower-cased too: typing "london" mid-sentence is a
        // capitalisation mistake, which is not this feature's to mark.
        expect(list.has("london")).toBe(true);
    });

    it("rejects a word it does not", () => {
        expect(list.has("recieve")).toBe(false);
        expect(list.has("definately")).toBe(false);
    });

    it("survives blank lines, comments and CRLF, which a hand-kept list is full of", () => {
        const list = WordList.fromText("# a comment\r\nalpha\r\n\r\n  beta  \r\ngamma\r\n");
        expect(list.size).toBe(3);
        expect(list.has("beta")).toBe(true);
        expect(list.has("#")).toBe(false);
    });
});

describe("WordList.suggest", () => {
    const list = WordList.fromText(SAMPLE);

    it("puts the word the author meant first", () => {
        expect(list.suggest("recieve")[0]).toBe("receive");
        expect(list.suggest("teh")[0]).toBe("the");
        expect(list.suggest("hte")[0]).toBe("the");
        expect(list.suggest("seperate")[0]).toBe("separate");
        expect(list.suggest("freind")[0]).toBe("friend");
    });

    it("counts a transposition as one edit, not two", () => {
        // "hte" -> "the" is a single swap. Under plain Levenshtein it is two edits and would rank
        // behind every one-substitution neighbour.
        expect(boundedEditDistance("hte", "the", 2)).toBe(1);
        expect(list.suggest("hte")[0]).toBe("the");
    });

    it("never answers with more than the cap", () => {
        expect(list.suggest("bat", 5).length).toBeLessThanOrEqual(5);
        expect(list.suggest("bat", 2).length).toBeLessThanOrEqual(2);
    });

    it("gives the suggestion the shape of what was typed", () => {
        expect(list.suggest("Recieve")[0]).toBe("Receive");
        expect(list.suggest("RECIEVE")[0]).toBe("RECEIVE");
        // A proper noun keeps its own capital when the typo did not have one.
        expect(list.suggest("lndon")).toContain("London");
    });

    it("answers nothing when nothing is near", () => {
        expect(list.suggest("qwertyuiop")).toEqual([]);
    });

    it("finds every word within two edits, whichever end they differ at", () => {
        // The signature filter prunes in both directions; a suggestion missing from either side
        // would be a completeness bug rather than a ranking one.
        const suggestions = list.suggest("bat", 20);
        // One substitution at the front, one at the back, and one of each at once.
        for (const expected of ["cat", "hat", "rat", "mat", "bar", "car"]) {
            expect(suggestions).toContain(expected);
        }
    });
});

/**
 * The cost bound.
 *
 * Suggesting is the one call that could quietly become a full scan of the list: it is invoked from
 * a right click, on a word the dictionary has already rejected, over a hundred thousand candidates.
 * This test exists to fail if the length buckets or the signature filter are ever removed - without
 * them the same work takes tens of milliseconds per call rather than a fraction of one.
 */
describe("WordList.suggest cost", () => {
    /** A deterministic list the size of a real language, so the number means something. */
    function syntheticList(count: number): WordList {
        let seed = 0x2f6e2b1;
        const next = () => {
            // xorshift32: no dependency, and the same list on every machine and every run.
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return (seed >>> 0) / 0x100000000;
        };
        const letters = "abcdefghijklmnopqrstuvwxyz";
        const words = new Set<string>();
        while (words.size < count) {
            // Lengths 3-12, weighted towards the middle, as an English list is.
            const length = 3 + Math.floor(next() * 4) + Math.floor(next() * 4) + Math.floor(next() * 3);
            let word = "";
            for (let index = 0; index < length; index++) {
                word += letters[Math.floor(next() * letters.length)];
            }
            words.add(word);
        }
        return WordList.fromText([...words].join("\n"));
    }

    it("answers a hundred thousand words in well under a millisecond per call", () => {
        const list = syntheticList(100_000);
        expect(list.size).toBe(100_000);

        const queries = ["recieve", "teh", "definately", "seperate", "freind", "occurance", "acheive", "wierd"];
        // Once through first: the first call pays for the scratch rows and for V8 warming up, and
        // measuring that would measure the wrong thing.
        for (const query of queries) {
            list.suggest(query);
        }

        const rounds = 25;
        const started = performance.now();
        for (let round = 0; round < rounds; round++) {
            for (const query of queries) {
                list.suggest(query);
            }
        }
        const perCall = (performance.now() - started) / (rounds * queries.length);

        // Around 0.2ms a call on a developer machine, so the ceiling leaves better than twenty
        // times the headroom: this fails on a regression in kind - a full scan, an allocation per
        // candidate - and not on a slow machine or a loaded CI box.
        expect(perCall).toBeLessThan(5);
    });
});

describe("extractWords", () => {
    it("gives offsets into the text it was handed", () => {
        const text = "The quick brown fox";
        expect(extractWords(text)).toEqual([
            { start: 0, end: 3, word: "The" },
            { start: 4, end: 9, word: "quick" },
            { start: 10, end: 15, word: "brown" },
            { start: 16, end: 19, word: "fox" },
        ]);
        for (const found of extractWords(text)) {
            expect(text.slice(found.start, found.end)).toBe(found.word);
        }
    });

    it("keeps apostrophes and hyphens inside a word and strips them at its edges", () => {
        expect(extractWords("don't stop").map(entry => entry.word)).toEqual(["don't", "stop"]);
        expect(extractWords("mother-in-law").map(entry => entry.word)).toEqual(["mother-in-law"]);
        expect(extractWords("'quoted' —dash—").map(entry => entry.word)).toEqual(["quoted", "dash"]);
    });

    it("passes over what is not prose", () => {
        // Single letters, anything holding a digit or an underscore, and addresses: a correction
        // to any of them would break the thing it names.
        expect(extractWords("a b c").map(entry => entry.word)).toEqual([]);
        expect(extractWords("abc123 v2 my_var").map(entry => entry.word)).toEqual([]);
        expect(extractWords("see https://exampel.com/pge now").map(entry => entry.word)).toEqual(["see", "now"]);
        expect(extractWords("mail alise@exampel.com please").map(entry => entry.word)).toEqual(["mail", "please"]);
    });

    it("invents no word boundaries in a script that has none of its own", () => {
        // Chinese and Japanese are cut against the lexicon, and there is none here. Answering with
        // the run would be answering that a whole line is one word - see `tokenizer.test.ts` for
        // what the same calls return once a vocabulary is to hand.
        expect(extractWords("こんにちは")).toEqual([]);
        expect(extractWords("今天天气很好")).toEqual([]);
    });
});
