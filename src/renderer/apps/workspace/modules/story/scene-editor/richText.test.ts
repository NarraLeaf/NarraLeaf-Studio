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
        // "Hello world" - bold over [0,8), then color over [4,11).
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

    it("styles an inline value chip like a word (marks apply to the atomic unit)", () => {
        const interp = { kind: "variable" as const, target: { scope: "scene" as const, variableId: "gold" } };
        let runs: StoryRichRun[] = [{ text: "You have " }, { interpolation: interp }];
        // The chip is a single unit at offset 9 → apply color + bold across [9,10).
        runs = applyMarkToRange(runs, 9, 10, marks => ({ ...marks, color: "#f00" }));
        runs = applyMarkToRange(runs, 9, 10, marks => ({ ...marks, bold: true }));
        expect(runs).toEqual([
            { text: "You have " },
            { interpolation: interp, marks: { bold: true, color: "#f00" } },
        ]);
        expect(rangeHasMark(runs, 9, 10, "bold")).toBe(true);
        // normalizeRuns preserves interpolation marks.
        expect(normalizeRuns(runs)).toEqual(runs);
    });

    it("splices a pause into the run stream and counts units", () => {
        expect(spliceRuns([{ text: "abcd" }], 2, 2, [{ pause: 300 }]))
            .toEqual([{ text: "ab" }, { pause: 300 }, { text: "cd" }]);
        expect(totalUnits([{ text: "ab" }, { pause: true }, { text: "c" }])).toBe(4);
    });

    describe("inline event runs", () => {
        const event = { event: { expression: { characterId: "c1", formName: "angry" } } } as const;

        it("projects to nothing in plain text (zero-width, like a pause)", () => {
            expect(richRunsToPlain([{ text: "a" }, event, { text: "b" }])).toBe("ab");
        });

        it("survives normalizeRuns intact — never mis-routed to a pause run", () => {
            // The union widened past pause/interp; without an explicit branch normalizeRuns would
            // corrupt an event into `{ pause: undefined }`.
            expect(normalizeRuns([{ text: "a" }, event, { text: "b" }]))
                .toEqual([{ text: "a" }, event, { text: "b" }]);
        });

        it("counts as one atomic unit and splices like a chip", () => {
            expect(totalUnits([{ text: "ab" }, event, { text: "c" }])).toBe(4);
            expect(spliceRuns([{ text: "abcd" }], 2, 2, [event]))
                .toEqual([{ text: "ab" }, event, { text: "cd" }]);
            // Deleting the event's single unit rejoins the surrounding text.
            expect(spliceRuns([{ text: "a" }, event, { text: "b" }], 1, 2, []))
                .toEqual([{ text: "ab" }]);
        });

        it("keeps an event run meaningful (never collapsed to plain)", () => {
            expect(richIfMeaningful([{ text: "x" }, event])).toEqual([{ text: "x" }, event]);
        });

        it("derives event runs from a rich segment", () => {
            expect(segmentToRuns({ textId: "t", role: "dialogue", value: "ab", rich: [{ text: "a" }, event, { text: "b" }] }))
                .toEqual([{ text: "a" }, event, { text: "b" }]);
        });
    });
});
