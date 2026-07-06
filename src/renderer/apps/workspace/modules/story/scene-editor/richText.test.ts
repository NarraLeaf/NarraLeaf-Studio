import { describe, expect, it } from "vitest";
import { normalizeRuns, richIfMeaningful, richRunsToPlain, segmentToRuns } from "./richText";

describe("richText", () => {
    it("projects rich runs to plain text (pauses contribute nothing)", () => {
        expect(richRunsToPlain([
            { text: "Hello " },
            { text: "world", marks: { bold: true } },
            { pause: 300 },
        ])).toBe("Hello world");
    });

    it("merges adjacent runs with equal marks and drops empty runs", () => {
        expect(normalizeRuns([
            { text: "a", marks: { bold: true } },
            { text: "b", marks: { bold: true } },
            { text: "" },
            { text: "c" },
        ])).toEqual([
            { text: "ab", marks: { bold: true } },
            { text: "c" },
        ]);
    });

    it("collapses effectively-plain content to undefined", () => {
        expect(richIfMeaningful([{ text: "plain" }])).toBeUndefined();
        expect(richIfMeaningful([])).toBeUndefined();
        expect(richIfMeaningful([{ text: "x", marks: { italic: true } }])).toEqual([{ text: "x", marks: { italic: true } }]);
        expect(richIfMeaningful([{ text: "x" }, { pause: true }])).toEqual([{ text: "x" }, { pause: true }]);
    });

    it("derives editing runs from plain or rich segments", () => {
        expect(segmentToRuns({ textId: "t", role: "dialogue", value: "hi" })).toEqual([{ text: "hi" }]);
        expect(segmentToRuns({
            textId: "t",
            role: "dialogue",
            value: "hi",
            rich: [{ text: "hi", marks: { bold: true } }],
        })).toEqual([{ text: "hi", marks: { bold: true } }]);
    });
});
