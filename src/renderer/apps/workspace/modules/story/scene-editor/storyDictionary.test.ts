import { describe, expect, it } from "vitest";
import type { StoryRichRun } from "@shared/types/story";
import { dictionaryNeedles } from "@shared/dictionary/dictionaryMatch";
import { DEFAULT_DICTIONARY_OPTIONS, normalizeDictionaryEntries } from "@shared/types/dictionary";
import { dictionaryMarkAtUnit, dictionaryMarks, sameDictionaryMarks } from "./storyDictionary";

/**
 * The dictionary read against a row of runs.
 *
 * What this exists to pin down is the mapping. A row is units, an answer is characters, and an inline
 * chip is one unit and no characters of its own - so an offset taken from the plain text and spent in
 * the unit model lands further left the more chips the line holds. The other half is the ruby already
 * on the row, which is the difference between offering a reading and offering it on every term the
 * author has already annotated by hand.
 */

const needles = (raw: unknown[]) => dictionaryNeedles(normalizeDictionaryEntries(raw), DEFAULT_DICTIONARY_OPTIONS);

describe("reading a story row against the project dictionary", () => {
    it("places a variant in the unit model", () => {
        const runs: StoryRichRun[] = [{ text: "The colour of it" }];

        const marks = dictionaryMarks(runs, needles([{ term: "color", variants: ["colour"] }]));

        expect(marks).toHaveLength(1);
        expect(marks[0]).toMatchObject({ kind: "variant", unitStart: 4, unitEnd: 10, replacement: "color" });
    });

    it("counts an inline chip as one unit, so a mark after one is not shifted left", () => {
        const runs: StoryRichRun[] = [
            { text: "Hi " },
            { pause: 200 },
            { text: " the colour of it" },
        ];

        const marks = dictionaryMarks(runs, needles([{ term: "color", variants: ["colour"] }]));

        // "Hi " is 3 units, the chip is the 4th, then " the " - so the word starts at unit 9.
        expect(marks[0]).toMatchObject({ unitStart: 9, unitEnd: 15 });
    });

    it("offers a reading on a term the row has not annotated", () => {
        const runs: StoryRichRun[] = [{ text: "神楽坂に着いた" }];

        const marks = dictionaryMarks(runs, needles([{ term: "神楽坂", reading: "かぐらざか" }]));

        expect(marks).toHaveLength(1);
        expect(marks[0]).toMatchObject({ kind: "reading", unitStart: 0, unitEnd: 3, reading: "かぐらざか" });
    });

    it("says nothing about a term the row has already annotated", () => {
        const runs: StoryRichRun[] = [
            { text: "神楽坂", marks: { ruby: "かぐらざか" } },
            { text: "に着いた" },
        ];

        expect(dictionaryMarks(runs, needles([{ term: "神楽坂", reading: "かぐらざか" }]))).toEqual([]);
    });

    it("says nothing at all when the dictionary has nothing to look for", () => {
        expect(dictionaryMarks([{ text: "anything" }], [])).toEqual([]);
        expect(dictionaryMarks([{ text: "   " }], needles([{ term: "a", variants: ["b"] }]))).toEqual([]);
    });

    it("finds the mark under a unit, both edges included", () => {
        const marks = dictionaryMarks([{ text: "The colour of it" }], needles([{ term: "color", variants: ["colour"] }]));

        expect(dictionaryMarkAtUnit(marks, 4)).not.toBeNull();
        expect(dictionaryMarkAtUnit(marks, 10)).not.toBeNull();
        expect(dictionaryMarkAtUnit(marks, 11)).toBeNull();
    });

    it("knows when an answer says the same thing as the last one", () => {
        const list = needles([{ term: "color", variants: ["colour"] }]);
        const first = dictionaryMarks([{ text: "The colour of it" }], list);
        const same = dictionaryMarks([{ text: "The colour of it" }], list);
        const moved = dictionaryMarks([{ text: "Ah, the colour of it" }], list);

        expect(sameDictionaryMarks(first, same)).toBe(true);
        expect(sameDictionaryMarks(first, moved)).toBe(false);
    });
});
