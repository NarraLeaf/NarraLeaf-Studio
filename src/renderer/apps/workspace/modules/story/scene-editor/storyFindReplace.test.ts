import { describe, expect, it } from "vitest";
import type { StoryTextSegment } from "@shared/types/story";
import { compileMatcher } from "@/lib/workspace/services/search/textMatcher";
import {
    findRangesInText,
    plainOffsetToUnit,
    replaceAllInSegment,
    replaceInSegment,
    replaceRangesInSegment,
    segmentPlainText,
} from "./storyFindReplace";

/**
 * The failure this suite exists to prevent is a replacement that quietly damages a styled line —
 * losing a bold clause, eating a pause token, or cutting at the wrong offset because plain-text
 * positions and run-unit positions are not the same thing on a line that carries a token.
 */

function plain(value: string): StoryTextSegment {
    return { textId: "t1", role: "dialogue", value };
}

describe("findRangesInText", () => {
    it("finds every non-overlapping hit", () => {
        expect(findRangesInText("aaaa", "aa", { caseSensitive: true })).toEqual([
            { start: 0, end: 2 },
            { start: 2, end: 4 },
        ]);
    });

    it("ignores case unless asked", () => {
        expect(findRangesInText("Alice and alice", "alice", { caseSensitive: false })).toHaveLength(2);
        expect(findRangesInText("Alice and alice", "alice", { caseSensitive: true })).toEqual([{ start: 10, end: 15 }]);
    });

    it("matches nothing on an empty query, rather than everything", () => {
        expect(findRangesInText("anything", "", { caseSensitive: false })).toEqual([]);
    });

    it("carries the shared matcher's options through", () => {
        expect(findRangesInText("cat catalog", "cat", { caseSensitive: true, wholeWord: true }))
            .toEqual([{ start: 0, end: 3 }]);
        expect(findRangesInText("a1 b2", "\\w\\d", { caseSensitive: true, regex: true })).toEqual([
            { start: 0, end: 2 },
            { start: 3, end: 5 },
        ]);
    });
});

describe("replaceInSegment", () => {
    it("rewrites a plain segment and leaves it plain", () => {
        const next = replaceInSegment(plain("Hello Alice"), { start: 6, end: 11 }, "Zoe");
        expect(next.value).toBe("Hello Zoe");
        expect(next.rich).toBeUndefined();
    });

    it("keeps the marks the match sat in", () => {
        const segment: StoryTextSegment = {
            textId: "t1",
            role: "dialogue",
            value: "Hello Alice!",
            rich: [{ text: "Hello " }, { text: "Alice", marks: { bold: true } }, { text: "!" }],
        };
        const next = replaceInSegment(segment, { start: 6, end: 11 }, "Zoe");
        expect(segmentPlainText(next)).toBe("Hello Zoe!");
        expect(next.rich).toEqual([{ text: "Hello " }, { text: "Zoe", marks: { bold: true } }, { text: "!" }]);
    });

    it("survives a match that crosses a style boundary", () => {
        const segment: StoryTextSegment = {
            textId: "t1",
            role: "dialogue",
            value: "good morning",
            rich: [{ text: "good " }, { text: "morning", marks: { italic: true } }],
        };
        const next = replaceInSegment(segment, { start: 0, end: 12 }, "evening");
        expect(segmentPlainText(next)).toBe("evening");
    });

    it("keeps a pause token that sits after the match", () => {
        const segment: StoryTextSegment = {
            textId: "t1",
            role: "dialogue",
            value: "Alice went home",
            rich: [{ text: "Alice" }, { pause: true }, { text: " went home" }],
        };
        const next = replaceInSegment(segment, { start: 0, end: 5 }, "Zoe");
        expect(segmentPlainText(next)).toBe("Zoe went home");
        expect(next.rich).toContainEqual({ pause: true });
    });

    it("cuts at the right place on the far side of a pause", () => {
        // The bug this pins: "home" starts at plain offset 11 but unit offset 12, because the pause
        // occupies a unit and no characters. Replacing at 11 in unit space would eat a space.
        const segment: StoryTextSegment = {
            textId: "t1",
            role: "dialogue",
            value: "Alice went home",
            rich: [{ text: "Alice" }, { pause: true }, { text: " went home" }],
        };
        const next = replaceInSegment(segment, { start: 11, end: 15 }, "away");
        expect(segmentPlainText(next)).toBe("Alice went away");
        expect(next.rich).toContainEqual({ pause: true });
    });

    it("deletes when the replacement is empty", () => {
        const next = replaceInSegment(plain("Hello Alice"), { start: 5, end: 11 }, "");
        expect(next.value).toBe("Hello");
    });
});

describe("plainOffsetToUnit", () => {
    it("counts a token as a unit with no characters", () => {
        const runs = [{ text: "ab" }, { pause: true as const }, { text: "cd" }];
        expect(plainOffsetToUnit(runs, 0)).toBe(0);
        expect(plainOffsetToUnit(runs, 2)).toBe(2);
        // Offset 3 is the "c": past the pause, so one unit further along than the plain offset.
        expect(plainOffsetToUnit(runs, 3)).toBe(4);
    });
});

describe("replaceAllInSegment", () => {
    it("applies back to front so earlier offsets stay valid", () => {
        const segment = plain("one two one two");
        const ranges = findRangesInText(segment.value, "one", { caseSensitive: true });
        const next = replaceAllInSegment(segment, ranges, "three");
        expect(next.value).toBe("three two three two");
    });

    it("handles a replacement longer than the text it replaces", () => {
        const segment = plain("a a a");
        const ranges = findRangesInText(segment.value, "a", { caseSensitive: true });
        expect(replaceAllInSegment(segment, ranges, "bbb").value).toBe("bbb bbb bbb");
    });
});

describe("replaceRangesInSegment", () => {
    it("gives each hit its own replacement, which is what `$1` needs", () => {
        const matcher = compileMatcher("(\\w)(\\d)", { caseSensitive: true, wholeWord: false, regex: true });
        const segment = plain("a1 and b2");
        const ranges = matcher.findRanges(segment.value);
        const next = replaceRangesInSegment(segment, ranges, range =>
            matcher.expand(segment.value, range, "$2$1"),
        );
        expect(next.value).toBe("1a and 2b");
    });

    it("splices per hit without disturbing the marks or tokens around them", () => {
        const segment: StoryTextSegment = {
            textId: "t1",
            role: "dialogue",
            value: "cat and cat",
            rich: [{ text: "cat" }, { pause: true }, { text: " and " }, { text: "cat", marks: { bold: true } }],
        };
        const ranges = findRangesInText(segmentPlainText(segment), "cat", { caseSensitive: true });
        const next = replaceRangesInSegment(segment, ranges, (_range, index) => `dog${index}`);
        expect(segmentPlainText(next)).toBe("dog0 and dog1");
        expect(next.rich).toContainEqual({ pause: true });
        expect(next.rich).toContainEqual({ text: "dog1", marks: { bold: true } });
    });
});
