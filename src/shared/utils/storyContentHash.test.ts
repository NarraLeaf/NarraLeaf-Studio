import { describe, expect, it } from "vitest";
import { computeStoryContentHash } from "./storyContentHash";

describe("computeStoryContentHash", () => {
    it("answers the same for the same content written in a different order", () => {
        // The failure this guards is not cosmetic: keyed on insertion order, saving an untouched
        // project would invalidate every save a player has.
        const a = { s1: { name: "one", rows: [1, 2] }, s2: { name: "two" } };
        const b = { s2: { name: "two" }, s1: { rows: [1, 2], name: "one" } };
        expect(computeStoryContentHash(a)).toBe(computeStoryContentHash(b));
    });

    it("moves when the story does", () => {
        const base = computeStoryContentHash({ s1: { rows: ["hello"] } });
        expect(computeStoryContentHash({ s1: { rows: ["hello!"] } })).not.toBe(base);
        expect(computeStoryContentHash({ s1: { rows: ["hello"] }, s2: {} })).not.toBe(base);
        // Array order is content: two rows swapped are a different story.
        expect(computeStoryContentHash({ s1: { rows: ["a", "b"] } }))
            .not.toBe(computeStoryContentHash({ s1: { rows: ["b", "a"] } }));
    });

    it("is blank when there is nothing to hash, which reads as 'cannot be compared'", () => {
        expect(computeStoryContentHash(undefined)).toBe("");
        expect(computeStoryContentHash(null)).toBe("");
        expect(computeStoryContentHash({})).toBe("");
    });

    it("is a fixed-width hex string", () => {
        expect(computeStoryContentHash({ s1: {} })).toMatch(/^[0-9a-f]{16}$/);
    });
});
