import { describe, expect, it } from "vitest";
import { clampIndex, fuzzyMatch, rankFuzzyList, wrapIndex } from "./fuzzyListModel";

describe("fuzzyMatch", () => {
    it("matches an empty query with a neutral score", () => {
        const result = fuzzyMatch("", "Open Settings");
        expect(result.matched).toBe(true);
        expect(result.score).toBe(0);
        expect(result.positions).toEqual([]);
    });

    it("matches a subsequence case-insensitively and records positions", () => {
        const result = fuzzyMatch("os", "Open Settings");
        expect(result.matched).toBe(true);
        // "O" at 0, "S" at 5
        expect(result.positions).toEqual([0, 5]);
    });

    it("does not match when characters are out of order", () => {
        expect(fuzzyMatch("so", "Open Settings").matched).toBe(false);
    });

    it("does not match when a character is absent", () => {
        expect(fuzzyMatch("xyz", "Open Settings").matched).toBe(false);
    });

    it("scores a consecutive run above a scattered match", () => {
        const consecutive = fuzzyMatch("set", "Settings");
        const scattered = fuzzyMatch("set", "Save Existing Tab");
        expect(consecutive.matched).toBe(true);
        expect(scattered.matched).toBe(true);
        expect(consecutive.score).toBeGreaterThan(scattered.score);
    });

    it("rewards a word-boundary match over a mid-word one", () => {
        // "s" lands on the boundary "S" of "Save"; "a" lands mid-word.
        const boundary = fuzzyMatch("s", "Save");
        const midWord = fuzzyMatch("a", "Save");
        expect(boundary.score).toBeGreaterThan(midWord.score);
    });
});

describe("rankFuzzyList", () => {
    const items = ["Open Settings", "Open Project", "Close Panel", "Save Document"];

    it("returns all items in original order for an empty query", () => {
        const ranked = rankFuzzyList(items, "", (item) => item);
        expect(ranked.map((r) => r.item)).toEqual(items);
    });

    it("returns all items in original order for a whitespace-only query", () => {
        const ranked = rankFuzzyList(items, "   ", (item) => item);
        expect(ranked.map((r) => r.item)).toEqual(items);
    });

    it("filters to matching items", () => {
        const ranked = rankFuzzyList(items, "open", (item) => item);
        expect(ranked.map((r) => r.item)).toEqual(["Open Settings", "Open Project"]);
    });

    it("ranks a stronger match first", () => {
        const ranked = rankFuzzyList(items, "save", (item) => item);
        expect(ranked[0]?.item).toBe("Save Document");
    });

    it("preserves input order for equally-scored items", () => {
        const ranked = rankFuzzyList(items, "open", (item) => item);
        // Both start with "Open " so the query scores identically; input order breaks the tie.
        expect(ranked.map((r) => r.item)).toEqual(["Open Settings", "Open Project"]);
    });

    it("matches against secondary fields but prefers a primary-field hit", () => {
        const commands = [
            { title: "Toggle Sidebar", category: "View" },
            { title: "Reveal in Explorer", category: "Navigate" },
        ];
        const ranked = rankFuzzyList(commands, "view", (c) => [c.title, c.category]);
        expect(ranked).toHaveLength(1);
        expect(ranked[0]?.item.title).toBe("Toggle Sidebar");
        // The hit was in the secondary field, so no highlight positions are surfaced.
        expect(ranked[0]?.fieldIndex).toBe(1);
        expect(ranked[0]?.positions).toEqual([]);
    });

    it("ranks a title match above a category-only match", () => {
        const commands = [
            { title: "Save Document", category: "File" },
            { title: "Open Recent", category: "Saved Projects" },
        ];
        const ranked = rankFuzzyList(commands, "save", (c) => [c.title, c.category]);
        expect(ranked[0]?.item.title).toBe("Save Document");
    });
});

describe("wrapIndex", () => {
    it("wraps past the end back to the start", () => {
        expect(wrapIndex(3, 3)).toBe(0);
        expect(wrapIndex(4, 3)).toBe(1);
    });

    it("wraps before the start to the end", () => {
        expect(wrapIndex(-1, 3)).toBe(2);
    });

    it("returns 0 for an empty list", () => {
        expect(wrapIndex(2, 0)).toBe(0);
    });
});

describe("clampIndex", () => {
    it("clamps within bounds", () => {
        expect(clampIndex(5, 3)).toBe(2);
        expect(clampIndex(-2, 3)).toBe(0);
        expect(clampIndex(1, 3)).toBe(1);
    });

    it("returns 0 for an empty list", () => {
        expect(clampIndex(2, 0)).toBe(0);
    });
});
