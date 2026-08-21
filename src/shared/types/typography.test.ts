import {describe, expect, it} from "vitest";
import {
    normalizeProjectFontStack,
    PROJECT_FONT_STACK_MAX,
    projectFontStackIds,
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
});
