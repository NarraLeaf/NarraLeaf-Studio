import { describe, expect, it } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import {
    applyMarkToRange,
    normalizeRuns,
    rangeHasMark,
    richIfMeaningful,
    richRunsToPlain,
    segmentToRuns,
    spliceRuns,
    totalUnits,
} from "./richText";

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

    it("splits overlapping marks into a combined middle run (mixed words)", () => {
        // "Hello world" — bold over [0,8), then color over [4,11).
        let runs: StoryRichRun[] = [{ text: "Hello world" }];
        runs = applyMarkToRange(runs, 0, 8, marks => ({ ...marks, bold: true }));
        runs = applyMarkToRange(runs, 4, 11, marks => ({ ...marks, color: "#f00" }));
        expect(runs).toEqual([
            { text: "Hell", marks: { bold: true } },
            { text: "o wo", marks: { bold: true, color: "#f00" } },
            { text: "rld", marks: { color: "#f00" } },
        ]);
    });

    it("toggles a mark off when the whole range already carries it", () => {
        const runs: StoryRichRun[] = [{ text: "abc", marks: { bold: true } }];
        const active = rangeHasMark(runs, 0, 3, "bold");
        expect(active).toBe(true);
        expect(applyMarkToRange(runs, 0, 3, marks => ({ ...marks, bold: active ? undefined : true })))
            .toEqual([{ text: "abc" }]);
    });

    it("splices a pause into the run stream and counts units", () => {
        expect(spliceRuns([{ text: "abcd" }], 2, 2, [{ pause: 300 }]))
            .toEqual([{ text: "ab" }, { pause: 300 }, { text: "cd" }]);
        expect(totalUnits([{ text: "ab" }, { pause: true }, { text: "c" }])).toBe(4);
    });
});
