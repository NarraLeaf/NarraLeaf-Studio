import { describe, expect, it } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import {
    applyMarkToRange,
    normalizeRuns,
    rangeHasMark,
    rangeMarkRuby,
    richIfMeaningful,
    richRunsToPlain,
    rubyRunAt,
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

    describe("ruby", () => {
        it("annotates the selected characters and splits the run at its edges", () => {
            const runs = applyMarkToRange([{ text: "漢字を読む" }], 0, 2, marks => ({ ...marks, ruby: "かんじ" }), { textOnly: true });
            expect(runs).toEqual([
                { text: "漢字", marks: { ruby: "かんじ" } },
                { text: "を読む" },
            ]);
        });

        it("keeps two readings apart even when they are adjacent", () => {
            // normalizeRuns merges on equal marks, so differing readings must stay two runs - one
            // merged run would put a single reading over both words.
            expect(normalizeRuns([
                { text: "漢", marks: { ruby: "かん" } },
                { text: "字", marks: { ruby: "じ" } },
            ])).toEqual([
                { text: "漢", marks: { ruby: "かん" } },
                { text: "字", marks: { ruby: "じ" } },
            ]);
        });

        it("leaves an inline value chip in the range unannotated", () => {
            // A reading is written for characters the author can see. The chip's are decided at run
            // time, and every run compiles to its own Word, so annotating it would draw the reading
            // a second time over the value.
            const interp = { kind: "variable" as const, target: { scope: "scene" as const, variableId: "name" } };
            const runs: StoryRichRun[] = [{ text: "御名" }, { interpolation: interp }];
            expect(applyMarkToRange(runs, 0, 3, marks => ({ ...marks, ruby: "みな" }), { textOnly: true })).toEqual([
                { text: "御名", marks: { ruby: "みな" } },
                { interpolation: interp },
            ]);
            // Without the flag the same call reaches the chip, which is right for colour and bold.
            expect(applyMarkToRange(runs, 0, 3, marks => ({ ...marks, bold: true }))).toEqual([
                { text: "御名", marks: { bold: true } },
                { interpolation: interp, marks: { bold: true } },
            ]);
        });

        it("reports one reading for a range only when every character shares it", () => {
            const runs: StoryRichRun[] = [
                { text: "漢字", marks: { ruby: "かんじ" } },
                { text: "を" },
            ];
            expect(rangeMarkRuby(runs, 0, 2)).toBe("かんじ");
            expect(rangeMarkRuby(runs, 0, 3)).toBeUndefined();
            expect(rangeMarkRuby(runs, 2, 3)).toBeUndefined();
        });

        it("ignores chips when reading a range, so one beside the words does not deny the reading", () => {
            const interp = { kind: "variable" as const, target: { scope: "scene" as const, variableId: "n" } };
            expect(rangeMarkRuby([{ text: "漢", marks: { ruby: "かん" } }, { interpolation: interp }], 0, 2)).toBe("かん");
        });

        it("finds the annotated run under a collapsed caret, and nothing under an unannotated one", () => {
            const runs: StoryRichRun[] = [
                { text: "その" },
                { text: "漢字", marks: { ruby: "かんじ" } },
                { text: "を" },
            ];
            expect(rubyRunAt(runs, 3)).toEqual({ start: 2, end: 4, ruby: "かんじ" });
            expect(rubyRunAt(runs, 1)).toBeNull();
            expect(rubyRunAt(runs, 5)).toBeNull();
        });

        it("gives a caret on a seam to the run it just left", () => {
            // Typing the last character of an annotated word leaves the caret at its end. The reading
            // the author was working on is the one behind them, not the one they have not reached.
            const runs: StoryRichRun[] = [
                { text: "漢", marks: { ruby: "かん" } },
                { text: "字", marks: { ruby: "じ" } },
            ];
            expect(rubyRunAt(runs, 1)?.ruby).toBe("かん");
            // At the very start there is nothing behind the caret, so the run ahead answers.
            expect(rubyRunAt(runs, 0)?.ruby).toBe("かん");
            expect(rubyRunAt(runs, 2)?.ruby).toBe("じ");
        });

        it("removes the reading without disturbing the marks beside it", () => {
            const runs: StoryRichRun[] = [{ text: "漢字", marks: { bold: true, ruby: "かんじ" } }];
            expect(applyMarkToRange(runs, 0, 2, marks => ({ ...marks, ruby: undefined }), { textOnly: true }))
                .toEqual([{ text: "漢字", marks: { bold: true } }]);
        });

        it("keeps an annotated run out of the plain-text collapse", () => {
            expect(richIfMeaningful([{ text: "漢字", marks: { ruby: "かんじ" } }]))
                .toEqual([{ text: "漢字", marks: { ruby: "かんじ" } }]);
        });
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
