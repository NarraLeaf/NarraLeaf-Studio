import { describe, expect, it } from "vitest";
import {
    applyPlainTextToUITextRuns,
    normalizeUITextRuns,
    resolveUITextRuns,
    setUITextRunMark,
    uiTextRunMarksInRange,
    uiTextRunsToPlain,
    type UITextRun,
} from "./textRuns";

describe("normalizeUITextRuns", () => {
    it("drops the arms a label has no answer for", () => {
        const runs = normalizeUITextRuns([
            { text: "before" },
            { pause: 500 },
            { event: { sound: { assetId: "a" } } },
            { interpolation: { kind: "variable", target: { scope: "saved", variableId: "v" } } },
            { text: "after", marks: { bold: true } },
        ]);
        expect(runs).toEqual([{ text: "before" }, { text: "after", marks: { bold: true } }]);
    });

    it("drops the two marks that only mean something to a typewriter", () => {
        expect(normalizeUITextRuns([
            { text: "a", marks: { cps: 20, fontSize: 40, bold: true } },
            { text: "b" },
        ])).toEqual([{ text: "a", marks: { bold: true } }, { text: "b" }]);
    });

    it("collapses to undefined when nothing is left that the plain string does not say", () => {
        expect(normalizeUITextRuns([{ text: "plain" }])).toBeUndefined();
        expect(normalizeUITextRuns([{ text: "a" }, { text: "b" }])).toBeUndefined();
        expect(normalizeUITextRuns([])).toBeUndefined();
        expect(normalizeUITextRuns("nope")).toBeUndefined();
    });

    it("keeps two annotated runs apart even when they share a reading", () => {
        const runs = normalizeUITextRuns([
            { text: "山", marks: { ruby: "やま" } },
            { text: "山", marks: { ruby: "やま" } },
        ]);
        expect(runs).toHaveLength(2);
    });

    it("clamps a size step to what the control offers", () => {
        expect(normalizeUITextRuns([{ text: "a", marks: { fontSizeStep: 99 } }, { text: "b" }]))
            .toEqual([{ text: "a", marks: { fontSizeStep: 6 } }, { text: "b" }]);
        expect(normalizeUITextRuns([{ text: "a", marks: { fontSizeStep: 0 } }, { text: "b" }]))
            .toBeUndefined();
    });
});

describe("resolveUITextRuns", () => {
    const runs: UITextRun[] = [{ text: "Hello " }, { text: "world", marks: { bold: true } }];

    it("draws the runs while they spell the text", () => {
        expect(resolveUITextRuns("Hello world", runs)).toBe(runs);
    });

    it("falls back to plain text when the string no longer agrees", () => {
        expect(resolveUITextRuns("Bonjour le monde", runs)).toBeNull();
        expect(resolveUITextRuns("Hello world", undefined)).toBeNull();
    });
});

describe("applyPlainTextToUITextRuns", () => {
    const runs: UITextRun[] = [
        { text: "Hello " },
        { text: "world", marks: { bold: true } },
        { text: "!" },
    ];

    it("keeps the marks the edit did not reach", () => {
        const next = applyPlainTextToUITextRuns(runs, "Hey there world!");
        expect(uiTextRunsToPlain(next!)).toBe("Hey there world!");
        expect(next).toContainEqual({ text: "world", marks: { bold: true } });
    });

    it("continues the run the text was typed into", () => {
        const next = applyPlainTextToUITextRuns(runs, "Hello worlds!");
        expect(next).toEqual([
            { text: "Hello " },
            { text: "worlds", marks: { bold: true } },
            { text: "!" },
        ]);
    });

    it("takes the reading off a run the edit cut into, and leaves its neighbours alone", () => {
        const annotated: UITextRun[] = [
            { text: "山田", marks: { ruby: "やまだ" } },
            { text: "太郎", marks: { ruby: "たろう" } },
        ];
        const next = applyPlainTextToUITextRuns(annotated, "山口太郎");
        expect(uiTextRunsToPlain(next!)).toBe("山口太郎");
        expect(next).toContainEqual({ text: "太郎", marks: { ruby: "たろう" } });
        expect(next!.some(run => run.marks?.ruby === "やまだ")).toBe(false);
    });

    it("survives a deletion that empties the label", () => {
        expect(applyPlainTextToUITextRuns(runs, "")).toBeUndefined();
    });

    it("returns the runs unchanged when the string still agrees", () => {
        expect(applyPlainTextToUITextRuns(runs, "Hello world!")).toEqual(runs);
    });
});

describe("setUITextRunMark", () => {
    it("marks a range of a label that had no runs at all", () => {
        const next = setUITextRunMark(undefined, "Hello world", 6, 11, "bold", true);
        expect(next).toEqual([{ text: "Hello " }, { text: "world", marks: { bold: true } }]);
    });

    it("leaves the rest of a marked run marked", () => {
        const runs: UITextRun[] = [{ text: "abcd", marks: { bold: true } }, { text: "e" }];
        const next = setUITextRunMark(runs, "abcde", 1, 3, "italic", true);
        expect(next).toEqual([
            { text: "a", marks: { bold: true } },
            { text: "bc", marks: { bold: true, italic: true } },
            { text: "d", marks: { bold: true } },
            { text: "e" },
        ]);
    });

    it("clears a mark and collapses back to plain text", () => {
        const runs: UITextRun[] = [{ text: "ab", marks: { bold: true } }, { text: "cd" }];
        expect(setUITextRunMark(runs, "abcd", 0, 2, "bold", undefined)).toBeUndefined();
    });
});

describe("uiTextRunMarksInRange", () => {
    const runs: UITextRun[] = [
        { text: "ab", marks: { bold: true, color: "#ff0000" } },
        { text: "cd", marks: { bold: true, color: "#00ff00" } },
    ];

    it("names only what every character in the range carries", () => {
        expect(uiTextRunMarksInRange(runs, "abcd", 0, 4)).toEqual({ bold: true });
        expect(uiTextRunMarksInRange(runs, "abcd", 0, 2)).toEqual({ bold: true, color: "#ff0000" });
    });

    it("says nothing about an empty range or a string the runs do not spell", () => {
        expect(uiTextRunMarksInRange(runs, "abcd", 2, 2)).toBeUndefined();
        expect(uiTextRunMarksInRange(runs, "translated", 0, 4)).toBeUndefined();
    });
});
