import {describe, expect, it} from "vitest";
import {
    carryCapitalisation,
    findDictionaryMatches,
    standsAlone,
} from "@shared/dictionary/dictionaryMatch";
import {
    DEFAULT_DICTIONARY_OPTIONS,
    normalizeDictionaryEntries,
    type ProjectDictionaryOptions,
} from "@shared/types/dictionary";

/**
 * Reading a line against the dictionary.
 *
 * The interesting failures are all about where a match may be claimed: inside a longer Latin word
 * (never), inside a longer run of kanji (always, because that is how the script is written), over
 * text somebody has already annotated (never), and over characters another match has taken.
 */

const entries = (...raw: Parameters<typeof normalizeDictionaryEntries>[0][]) =>
    normalizeDictionaryEntries(raw);

const options = (patch: Partial<ProjectDictionaryOptions> = {}): ProjectDictionaryOptions => ({
    ...DEFAULT_DICTIONARY_OPTIONS,
    ...patch,
});

describe("finding what the dictionary has to say about a line", () => {
    it("marks a variant and offers the term the project writes", () => {
        const found = findDictionaryMatches(
            "The colour of the sky",
            entries({term: "color", variants: ["colour"]}),
            options(),
        );

        expect(found).toEqual([{
            kind: "variant",
            start: 4,
            end: 10,
            text: "colour",
            term: "color",
            replacement: "color",
        }]);
    });

    it("does not find a term inside a longer Latin word", () => {
        expect(findDictionaryMatches(
            "colourless and recoloured",
            entries({term: "color", variants: ["colour"]}),
            options(),
        )).toEqual([]);
    });

    it("finds a term inside a longer run of kanji, because that is how the script is written", () => {
        const found = findDictionaryMatches(
            "神楽坂に着いた",
            entries({term: "神楽坂", reading: "かぐらざか"}),
            options(),
        );

        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({kind: "reading", start: 0, end: 3, reading: "かぐらざか"});
    });

    it("matches a variant whatever its case, and carries the capitalisation into the replacement", () => {
        const found = findDictionaryMatches(
            "Colour is not the word",
            entries({term: "color", variants: ["colour"]}),
            options(),
        );

        expect(found[0]).toMatchObject({text: "Colour", replacement: "Color"});
        expect(carryCapitalisation("color", "Colour")).toBe("Color");
        expect(carryCapitalisation("Kamurocho", "kamurocho")).toBe("Kamurocho");
    });

    it("says nothing about a term written the way the project writes it", () => {
        expect(findDictionaryMatches(
            "The color of the sky",
            entries({term: "color", variants: ["colour"]}),
            options(),
        )).toEqual([]);
    });

    it("offers a reading only where the line has not annotated the term itself", () => {
        const dictionary = entries({term: "神楽坂", reading: "かぐらざか"});
        const line = "神楽坂と神楽坂";
        // The first occurrence carries a ruby of the author's own; the second does not.
        const found = findDictionaryMatches(line, dictionary, options(), (start) => start === 0);

        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({start: 4, end: 7});
    });

    it("says nothing when the check that would say it is switched off", () => {
        const dictionary = entries({term: "color", reading: "カラー", variants: ["colour"]});

        expect(findDictionaryMatches("colour", dictionary, options({checkVariants: false}))).toEqual([]);
        expect(findDictionaryMatches("color", dictionary, options({suggestReadings: false}))).toEqual([]);
    });

    it("lets a variant win over a reading on the same characters", () => {
        // `colour` is both this project's wrong spelling of `color` and, in a dictionary that also
        // records a reading for it, a term with one. The line is written the wrong way there, so
        // offering to annotate it would be work the author has to undo.
        const dictionary = entries(
            {term: "color", variants: ["colour"]},
            {term: "colour", reading: "カラー"},
        );

        // `colour` is another entry's own term, so it is not treated as a variant at all: the
        // project writes both spellings, and marking one as the wrong way to write the other is the
        // worse of the two readings.
        const found = findDictionaryMatches("colour", dictionary, options());
        expect(found).toHaveLength(1);
        expect(found[0].kind).toBe("reading");
    });

    it("takes the longer of two matches that start together", () => {
        const found = findDictionaryMatches(
            "神楽坂真琴が来た",
            entries({term: "神楽坂", reading: "かぐらざか"}, {term: "神楽坂真琴", reading: "かぐらざかまこと"}),
            options(),
        );

        expect(found).toHaveLength(1);
        expect(found[0]).toMatchObject({term: "神楽坂真琴", start: 0, end: 5});
    });

    it("knows where a word may begin and end", () => {
        expect(standsAlone("a colour b", 2, 8)).toBe(true);
        expect(standsAlone("colourless", 0, 6)).toBe(false);
        expect(standsAlone("神楽坂に", 0, 3)).toBe(true);
    });
});
