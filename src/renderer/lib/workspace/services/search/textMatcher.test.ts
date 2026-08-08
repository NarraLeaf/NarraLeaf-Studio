import { describe, expect, it } from "vitest";
import { compileMatcher, type TextMatchOptions } from "./textMatcher";

const PLAIN: TextMatchOptions = { caseSensitive: false, wholeWord: false, regex: false };

function options(overrides: Partial<TextMatchOptions> = {}): TextMatchOptions {
    return { ...PLAIN, ...overrides };
}

function found(text: string, query: string, overrides: Partial<TextMatchOptions> = {}): string[] {
    return compileMatcher(query, options(overrides))
        .findRanges(text)
        .map(range => text.slice(range.start, range.end));
}

describe("compileMatcher - literal queries", () => {
    it("finds non-overlapping hits, so 'aa' in 'aaaa' is two and not three", () => {
        expect(compileMatcher("aa", options({ caseSensitive: true })).findRanges("aaaa")).toEqual([
            { start: 0, end: 2 },
            { start: 2, end: 4 },
        ]);
    });

    it("folds case unless asked not to", () => {
        expect(found("Alice and alice", "alice")).toHaveLength(2);
        expect(compileMatcher("alice", options({ caseSensitive: true })).findRanges("Alice and alice"))
            .toEqual([{ start: 10, end: 15 }]);
    });

    it("treats regex syntax as literal text when regex mode is off", () => {
        expect(found("cost is $1.50 (net)", "$1.50")).toEqual(["$1.50"]);
        expect(found("a.b and axb", "a.b")).toEqual(["a.b"]);
    });

    it("matches nothing for an empty query", () => {
        expect(found("anything", "")).toEqual([]);
        expect(compileMatcher("", PLAIN).test("anything")).toBe(false);
    });

    it("is reusable and not order-dependent - the same string answers the same twice", () => {
        const matcher = compileMatcher("a", options({ caseSensitive: true }));
        expect(matcher.findRanges("banana")).toHaveLength(3);
        expect(matcher.findRanges("banana")).toHaveLength(3);
        expect(matcher.test("banana")).toBe(true);
        expect(matcher.findRanges("banana")).toHaveLength(3);
    });

    it("keeps offsets valid when case folding would change the haystack's length", () => {
        // "İ".toLowerCase() is two code units, so a folded copy of this string is one character
        // longer than the original - and every offset found in it is one too far along.
        const text = "Say İstanbul now";
        const ranges = compileMatcher("stanbul", PLAIN).findRanges(text);
        expect(ranges).toHaveLength(1);
        expect(text.slice(ranges[0].start, ranges[0].end)).toBe("stanbul");
        // The offset a fold-then-indexOf matcher would have produced, which would splice one
        // character to the right of the hit.
        expect(text.toLowerCase().indexOf("stanbul")).not.toBe(ranges[0].start);
    });
});

describe("compileMatcher - regex queries", () => {
    it("matches with a pattern and reports no error", () => {
        const matcher = compileMatcher("a\\d+", options({ regex: true }));
        expect(matcher.error).toBeUndefined();
        expect(matcher.findRanges("a12 b34 a5")).toEqual([
            { start: 0, end: 3 },
            { start: 8, end: 10 },
        ]);
    });

    it("never throws on an invalid pattern - it reports one and finds nothing", () => {
        for (const pattern of ["[", "(", "a{2,1}", "*"]) {
            const matcher = compileMatcher(pattern, options({ regex: true }));
            expect(matcher.error, pattern).toBeTypeOf("string");
            expect(matcher.findRanges("aaa")).toEqual([]);
            expect(matcher.test("aaa")).toBe(false);
            // A failed compile still has to answer the replacement question without throwing.
            expect(matcher.expand("aaa", { start: 0, end: 1 }, "x")).toBe("x");
        }
    });

    it("accepts the patterns the `u` flag would have rejected", () => {
        // `/\-/u` is a SyntaxError; people type it, and it must keep working.
        expect(compileMatcher("\\-", options({ regex: true })).error).toBeUndefined();
        expect(found("a-b", "\\-", { regex: true })).toEqual(["-"]);
    });

    it("terminates on a pattern that matches the empty string", () => {
        // Each of these matches zero characters. A `g` regex does not advance `lastIndex` past an
        // empty match on its own, so without the manual bump `exec` returns the same one forever.
        expect(compileMatcher("a*", options({ regex: true })).findRanges("aab")).toEqual([
            { start: 0, end: 2 },
            { start: 2, end: 2 },
            { start: 3, end: 3 },
        ]);
        expect(compileMatcher("(?=b)", options({ regex: true })).findRanges("abcb")).toEqual([
            { start: 1, end: 1 },
            { start: 3, end: 3 },
        ]);
        expect(compileMatcher("\\b", options({ regex: true })).findRanges("hi there")).toHaveLength(4);
    });

    it("folds case in regex mode too", () => {
        expect(found("Inko and INKO", "i\\w+o", { regex: true })).toEqual(["Inko", "INKO"]);
        expect(found("Inko and INKO", "i\\w+o", { regex: true, caseSensitive: true })).toEqual([]);
    });
});

describe("compileMatcher - whole word", () => {
    it("rejects a hit that has a word character on either side", () => {
        expect(found("cat catalog concat cat.", "cat", { wholeWord: true })).toEqual(["cat", "cat"]);
    });

    it("counts the string edges as boundaries", () => {
        expect(found("cat", "cat", { wholeWord: true })).toEqual(["cat"]);
    });

    it("treats digits as word characters, matching the index's boundary rule", () => {
        expect(found("v2 v2x", "v2", { wholeWord: true })).toEqual(["v2"]);
    });

    it("uses [\\p{L}\\p{N}] rather than \\b, so CJK prose behaves", () => {
        // Every one of these characters is a letter, so a hit with prose on either side is not a
        // whole word. `\b` is defined over [A-Za-z0-9_] and would have called all four a match.
        expect(found("早上好吗", "早上好", { wholeWord: true })).toEqual([]);
        expect(found("早上好。", "早上好", { wholeWord: true })).toEqual(["早上好"]);
        expect(found("「早上好」，因子。", "早上好", { wholeWord: true })).toEqual(["早上好"]);
        expect(found("おはようございます", "おはよう", { wholeWord: true })).toEqual([]);
    });

    it("applies in regex mode as well as plain mode", () => {
        expect(found("cat catalog", "c.t", { wholeWord: true, regex: true })).toEqual(["cat"]);
    });

    it("makes `test` agree with `findRanges` rather than with the bare pattern", () => {
        const matcher = compileMatcher("cat", options({ wholeWord: true }));
        expect(matcher.test("catalog")).toBe(false);
        expect(matcher.test("one cat")).toBe(true);
    });
});

describe("compileMatcher - expand", () => {
    it("takes the replacement literally in plain mode, dollars and all", () => {
        const matcher = compileMatcher("cost", PLAIN);
        expect(matcher.expand("cost here", { start: 0, end: 4 }, "$1 price")).toBe("$1 price");
    });

    it("expands capture groups in regex mode", () => {
        const matcher = compileMatcher("(\\w+)@(\\w+)", options({ regex: true }));
        const text = "write to inko@studio now";
        const range = matcher.findRanges(text)[0];
        expect(matcher.expand(text, range, "$2/$1")).toBe("studio/inko");
    });

    it("expands $& and $$", () => {
        const matcher = compileMatcher("\\d+", options({ regex: true }));
        const text = "chapter 12";
        const range = matcher.findRanges(text)[0];
        expect(matcher.expand(text, range, "[$&]")).toBe("[12]");
        expect(matcher.expand(text, range, "$$$&")).toBe("$12");
    });

    it("expands an unmatched group to nothing and leaves unknown tokens alone", () => {
        const matcher = compileMatcher("(a)|(b)", options({ regex: true }));
        const text = "b";
        const range = matcher.findRanges(text)[0];
        expect(matcher.expand(text, range, "[$1][$2]")).toBe("[][b]");
        expect(matcher.expand(text, range, "$x")).toBe("$x");
    });

    it("expands each hit against its own match, not against the first", () => {
        const matcher = compileMatcher("(\\w)(\\d)", options({ regex: true }));
        const text = "a1 b2";
        const [first, second] = matcher.findRanges(text);
        expect(matcher.expand(text, first, "$2$1")).toBe("1a");
        expect(matcher.expand(text, second, "$2$1")).toBe("2b");
    });
});
