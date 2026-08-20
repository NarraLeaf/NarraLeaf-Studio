import { describe, expect, it } from "vitest";
import { containsSegmentedScript, extractWords } from "./tokenizer";
import { WordList } from "./wordList";

/**
 * Word-finding in Chinese and Japanese.
 *
 * The fixtures are word lists in the shipped format, small enough to reason about: every assertion
 * below can be checked by hand against the entries above it, which is the only way a segmentation
 * test says anything. The real lists hold a hundred thousand entries and would make every one of
 * these pass or fail for reasons nobody could see.
 */

/** Enough Chinese to write two sentences, including the single-character words. */
const CHINESE = WordList.fromText([
    "今天", "天气", "很好", "喜欢", "学校", "老师", "上海", "上海市", "市长",
    "天", "好", "很", "我", "你", "是", "的", "上", "人",
].join("\n"));

/** Japanese, holding one verb twice over: as it is written, and as a stem. */
const JAPANESE = WordList.fromText([
    "今日", "天気", "学校", "先生", "食べる", "食べ", "飲み", "私", "本",
].join("\n"));

describe("containsSegmentedScript", () => {
    it("names the scripts that write without spaces, and no others", () => {
        expect(containsSegmentedScript("今天")).toBe(true);
        expect(containsSegmentedScript("こんにちは")).toBe(true);
        expect(containsSegmentedScript("コーヒー")).toBe(true);
        expect(containsSegmentedScript("the quick brown fox")).toBe(false);
        expect(containsSegmentedScript("Größe")).toBe(false);
    });
});

describe("extractWords in Chinese", () => {
    it("cuts a sentence into words instead of answering with the run", () => {
        const text = "今天天气很好";
        const found = extractWords(text, CHINESE);

        expect(found.map(entry => entry.word)).toEqual(["今天", "天气", "很好"]);
        // The failure this guards against is not a wrong cut but no cut at all: a Han run returned
        // whole is a paragraph marked as one misspelling.
        expect(found.some(entry => entry.word === text)).toBe(false);
        for (const entry of found) {
            expect(text.slice(entry.start, entry.end)).toBe(entry.word);
        }
    });

    it("finds nothing at all without a lexicon", () => {
        // No vocabulary, no word boundaries, and therefore nothing that can be judged.
        expect(extractWords("今天天气很好")).toEqual([]);
        expect(extractWords("こんにちは")).toEqual([]);
    });

    it("reports the stretch a mistyped character leaves that would not join up", () => {
        // 汽 for 气. Both characters are entries, so neither is unknown - what gives the mistake
        // away is that the cut could join neither of them to anything, leaving two standing
        // together where the language would have made a word. The mark covers both: the wrong
        // character alone is not what an author is shown, and cannot be, without knowing which
        // of the two was meant.
        const found = extractWords("今天天汽很好", CHINESE);

        expect(found).toEqual([
            { start: 0, end: 2, word: "今天" },
            { start: 2, end: 4, word: "天汽" },
            { start: 4, end: 6, word: "很好" },
        ]);
    });

    it("joins consecutive unknown characters into one run", () => {
        // A name is unknown along its whole length, and the author's answer to it is to teach the
        // project the name. That only works if the marked run is the name and not its first
        // character.
        const found = extractWords("艾莉西亚喜欢学校", CHINESE);

        expect(found).toEqual([
            { start: 0, end: 4, word: "艾莉西亚" },
            { start: 4, end: 6, word: "喜欢" },
            { start: 6, end: 8, word: "学校" },
        ]);
    });

    it("cuts a run the greedy answer would strand a character in", () => {
        // Longest-match from the left takes 上海市 and leaves 长, which is not an entry, so it
        // would report a run in a phrase that is entirely made of words. The cut that covers
        // everything is 上海 and 市长, and it is the one taken.
        expect(extractWords("上海市长", CHINESE).map(entry => entry.word)).toEqual(["上海", "市长"]);
    });

    it("covers a run that can be cut two ways, whichever way it takes", () => {
        // 上海市 / 长 and 上海 / 市长 are both readings of the same four characters. Which one is
        // meant needs the sentence around it, which is out of reach here; what matters is that
        // every character ends up inside a word, so nothing is marked either way.
        const found = extractWords("上海市长", CHINESE);
        expect(found.map(entry => entry.word).join("")).toBe("上海市长");
        expect(found.every(entry => CHINESE.has(entry.word))).toBe(true);
    });

    it("passes over an iteration mark, which repeats a character rather than spelling one", () => {
        expect(extractWords("人々", CHINESE).map(entry => entry.word)).toEqual(["人"]);
    });
});

describe("extractWords in Japanese", () => {
    it("keeps a kanji and its okurigana together", () => {
        // 食べる is one entry, so nothing is left over.
        expect(extractWords("今日は食べる", JAPANESE).map(entry => entry.word)).toEqual(["今日", "食べる"]);
    });

    it("keeps them together when the list holds only the stem", () => {
        // The inflected forms are open-ended and a pre-expanded list carries the stem. The kanji is
        // covered by 食べ and the inflection that follows costs nothing, so a conjugated verb is
        // not reported - which is the false finding this whole arrangement exists to avoid.
        expect(extractWords("食べます", JAPANESE).map(entry => entry.word)).toEqual(["食べ"]);
        expect(extractWords("飲みました", JAPANESE).map(entry => entry.word)).toEqual(["飲み"]);
    });

    it("reports the kanji run between the kana, and nothing else", () => {
        // 汽 for 気. The particles either side are untouched, and the finding is exactly the run
        // that segments into no word.
        expect(extractWords("今日は天汽です", JAPANESE)).toEqual([
            { start: 0, end: 2, word: "今日" },
            { start: 3, end: 5, word: "天汽" },
        ]);
    });

    it("reports nothing in a stretch of kana", () => {
        // Hiragana here is inflection and particles; katakana is a loanword or a name. Neither is a
        // candidate a word list can rule on, so neither is marked.
        expect(extractWords("こんにちは", JAPANESE)).toEqual([]);
        expect(extractWords("アリス", JAPANESE)).toEqual([]);
        expect(extractWords("コーヒー", JAPANESE)).toEqual([]);
    });

    it("reads a Latin word out of a line that is otherwise Japanese", () => {
        const found = extractWords("私はAliceです", JAPANESE);
        expect(found.map(entry => entry.word)).toEqual(["私", "Alice"]);
        for (const entry of found) {
            expect("私はAliceです".slice(entry.start, entry.end)).toBe(entry.word);
        }
    });
});

describe("extractWords with a lexicon to hand", () => {
    it("reads a language that separates its words exactly as it did without one", () => {
        const text = "the quick brwn fox, don't stop at mother-in-law or https://exampel.com/pge";
        expect(extractWords(text, CHINESE)).toEqual(extractWords(text));
    });
});

/**
 * The cost bound.
 *
 * Segmenting is on the typing path: every row is cut again a fraction of a second after the author
 * stops, against a list of a hundred thousand entries. The work is linear in the length of the line
 * and in how far a segment may reach, and this fails if either of those ever stops being true - a
 * cut that tries every division of a run rather than every ending of one is the shape to watch for,
 * and it is exponential.
 */
describe("segmentation cost", () => {
    /** A deterministic list the size of a real language, so the number means something. */
    function syntheticList(count: number): WordList {
        let seed = 0x51a7c3d;
        const next = () => {
            // xorshift32: no dependency, and the same list on every machine and every run.
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return (seed >>> 0) / 0x100000000;
        };
        const character = () => String.fromCodePoint(0x4e00 + Math.floor(next() * 0x51a0));
        const words = new Set<string>();
        while (words.size < count) {
            // One to four characters, weighted towards two, as a Han list is.
            const length = 1 + Math.floor(next() * 2) + Math.floor(next() * 3);
            let word = "";
            for (let index = 0; index < length; index++) {
                word += character();
            }
            words.add(word);
        }
        return WordList.fromText([...words].join("\n"));
    }

    it("cuts a long line against a hundred thousand entries in well under a millisecond", () => {
        const list = syntheticList(100_000);
        expect(list.size).toBe(100_000);

        // A long line of dialogue, in sentences, which is what a row of a scene holds.
        const entries = [...new Set(["今天天气很好", "他说的话我一句也没有听懂", "这是一个很长的句子"])];
        const line = entries.join("，") + "。" + entries.join("、") + "。";

        // Once through first: the first call pays for V8 warming up, and measuring that would
        // measure the wrong thing.
        for (let round = 0; round < 5; round++) {
            extractWords(line, list);
        }

        const rounds = 200;
        const started = performance.now();
        for (let round = 0; round < rounds; round++) {
            extractWords(line, list);
        }
        const perCall = (performance.now() - started) / rounds;

        // Far under this on a developer machine, so the ceiling leaves room for a loaded box and
        // fails only on a regression in kind.
        expect(perCall).toBeLessThan(5);
    });
});
