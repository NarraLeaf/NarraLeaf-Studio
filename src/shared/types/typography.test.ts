import {describe, expect, it} from "vitest";
import {
    entryServesLocale,
    normalizeProjectFontStack,
    PROJECT_FONT_STACK_MAX,
    projectFontStackIds,
    resolveProjectFontStackForLocale,
    sameProjectFontStack,
} from "./typography";

/**
 * The stack is read on the paint path of every piece of text in the product, in the editor and in
 * the shipped game alike, so what it may contain has to be settled here rather than guarded at each
 * of those places.
 */
describe("normalizeProjectFontStack", () => {
    it("keeps the author's order", () => {
        expect(projectFontStackIds(normalizeProjectFontStack([{assetId: "b"}, {assetId: "a"}])))
            .toEqual(["b", "a"]);
    });

    it("reads the bare string spelling a hand-edited file may use", () => {
        expect(projectFontStackIds(normalizeProjectFontStack(["a", {assetId: "b"}]))).toEqual(["a", "b"]);
    });

    it("drops blanks and trims", () => {
        expect(projectFontStackIds(normalizeProjectFontStack([{assetId: "  a  "}, {assetId: "   "}, {}, null])))
            .toEqual(["a"]);
    });

    // A repeated family is the same CSS list, so the second row would be one the author can only
    // delete: it does nothing, and nothing on screen tells it from the first.
    it("keeps the first of a duplicated id", () => {
        expect(projectFontStackIds(normalizeProjectFontStack([{assetId: "a"}, {assetId: "b"}, {assetId: "a"}])))
            .toEqual(["a", "b"]);
    });

    it("refuses to grow past the cap", () => {
        const raw = Array.from({length: PROJECT_FONT_STACK_MAX + 5}, (_, index) => ({assetId: `f${index}`}));
        expect(normalizeProjectFontStack(raw)).toHaveLength(PROJECT_FONT_STACK_MAX);
    });

    it("reads anything that is not a list as no stack at all", () => {
        expect(normalizeProjectFontStack(undefined)).toEqual([]);
        expect(normalizeProjectFontStack("a")).toEqual([]);
        expect(normalizeProjectFontStack({assetId: "a"})).toEqual([]);
    });

    it("normalizes a rung's language restriction", () => {
        expect(normalizeProjectFontStack([
            {assetId: "a", locales: [" ja ", "ja", "zh-Hans", 7, "", "not a tag!"]},
        ])).toEqual([{assetId: "a", locales: ["ja", "zh-Hans"]}]);
    });

    /**
     * A rung nobody can spell a language for goes on serving every language, where it is visible and
     * one edit from correct - rather than vanishing from every stack with nothing on screen to say
     * why.
     */
    it("turns a restriction that lost every tag into no restriction", () => {
        expect(normalizeProjectFontStack([{assetId: "a", locales: ["!", 3]}])).toEqual([{assetId: "a"}]);
        expect(normalizeProjectFontStack([{assetId: "a", locales: "ja"}])).toEqual([{assetId: "a"}]);
    });

    // Merging would silently widen a restriction the author put on the rung that stays.
    it("keeps the first spelling of a duplicate, restrictions and all", () => {
        expect(normalizeProjectFontStack([
            {assetId: "a", locales: ["ja"]},
            {assetId: "a", locales: ["zh-Hans"]},
        ])).toEqual([{assetId: "a", locales: ["ja"]}]);
    });
});

describe("sameProjectFontStack", () => {
    it("is order-sensitive - a reordered stack is a different stack", () => {
        const a = [{assetId: "a"}, {assetId: "b"}];
        const b = [{assetId: "b"}, {assetId: "a"}];
        expect(sameProjectFontStack(a, a)).toBe(true);
        expect(sameProjectFontStack(a, b)).toBe(false);
    });

    it("compares by content, not identity", () => {
        expect(sameProjectFontStack([{assetId: "a"}], [{assetId: "a"}])).toBe(true);
        expect(sameProjectFontStack([{assetId: "a"}], [])).toBe(false);
    });

    /** The same fonts restricted differently resolve differently for every language in the project. */
    it("reads a restriction as part of the answer", () => {
        expect(sameProjectFontStack([{assetId: "a"}], [{assetId: "a", locales: ["ja"]}])).toBe(false);
        expect(sameProjectFontStack(
            [{assetId: "a", locales: ["ja"]}],
            [{assetId: "a", locales: ["ja", "zh"]}],
        )).toBe(false);
        expect(sameProjectFontStack(
            [{assetId: "a", locales: ["ja", "zh"]}],
            [{assetId: "a", locales: ["zh", "ja"]}],
        )).toBe(false);
    });

    it("treats an absent restriction and an empty one as the same thing", () => {
        expect(sameProjectFontStack([{assetId: "a"}], [{assetId: "a", locales: []}])).toBe(true);
    });
});

describe("entryServesLocale", () => {
    it("matches on subtag boundaries", () => {
        const entry = { assetId: "a", locales: ["zh-Hant"] };
        expect(entryServesLocale(entry, "zh-Hant-HK")).toBe(true);
        expect(entryServesLocale(entry, "zh-Hant")).toBe(true);
        expect(entryServesLocale(entry, "zh-Hans")).toBe(false);
        expect(entryServesLocale(entry, "zh")).toBe(false);
    });

    it("serves every language of a broader tag", () => {
        expect(entryServesLocale({ assetId: "a", locales: ["zh"] }, "zh-Hans-CN")).toBe(true);
    });

    it("is case-insensitive, as language tags are", () => {
        expect(entryServesLocale({ assetId: "a", locales: ["ja"] }, "JA-JP")).toBe(true);
    });

    it("serves everything when the restriction is absent or empty", () => {
        expect(entryServesLocale({ assetId: "a" }, "ja")).toBe(true);
        expect(entryServesLocale({ assetId: "a", locales: [] }, "ja")).toBe(true);
    });
});

describe("resolveProjectFontStackForLocale", () => {
    const STACK = [
        { assetId: "jp", locales: ["ja"] },
        { assetId: "sc", locales: ["zh-Hans"] },
        { assetId: "display" },
    ];

    /** One list, one order, filtered - which is the whole reason there is no matrix to maintain. */
    it("keeps the author's order and leaves out the rungs for other languages", () => {
        expect(projectFontStackIds(resolveProjectFontStackForLocale(STACK, "ja"))).toEqual(["jp", "display"]);
        expect(projectFontStackIds(resolveProjectFontStackForLocale(STACK, "zh-Hans"))).toEqual(["sc", "display"]);
        expect(projectFontStackIds(resolveProjectFontStackForLocale(STACK, "en"))).toEqual(["display"]);
    });

    it("filters nothing without a language", () => {
        expect(resolveProjectFontStackForLocale(STACK, "")).toEqual(STACK);
        expect(resolveProjectFontStackForLocale(STACK, null)).toEqual(STACK);
        expect(resolveProjectFontStackForLocale(STACK, undefined)).toEqual(STACK);
    });

    it("can resolve to nothing, which is a project with no default font in that language", () => {
        expect(resolveProjectFontStackForLocale([{ assetId: "jp", locales: ["ja"] }], "en")).toEqual([]);
    });
});
