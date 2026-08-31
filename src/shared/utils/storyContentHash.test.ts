import { describe, expect, it } from "vitest";
import { computeStoryContentHashes } from "./storyContentHash";

describe("computeStoryContentHashes", () => {
    it("answers the same for the same content written in a different order", () => {
        // The failure this guards is not cosmetic: keyed on insertion order, saving an untouched
        // project would invalidate every save a player has.
        const a = { s1: { name: "one", rows: [1, 2] }, s2: { name: "two" } };
        const b = { s2: { name: "two" }, s1: { rows: [1, 2], name: "one" } };
        expect(computeStoryContentHashes(a)).toEqual(computeStoryContentHashes(b));
    });

    it("moves when the story does", () => {
        const base = computeStoryContentHashes({ s1: { rows: ["hello"] } }).s1;
        expect(computeStoryContentHashes({ s1: { rows: ["hello!"] } }).s1).not.toBe(base);
        // Array order is content: two rows swapped are a different story.
        expect(computeStoryContentHashes({ s1: { rows: ["a", "b"] } }).s1)
            .not.toBe(computeStoryContentHashes({ s1: { rows: ["b", "a"] } }).s1);
    });

    /**
     * The whole reason this is a table rather than one number. A player saved on the prologue keeps
     * their slot when the trial is patched; before this, every save in the project was retired by
     * an edit to any of them.
     */
    it("moves only the story that changed", () => {
        const before = computeStoryContentHashes({ prologue: { rows: ["a"] }, trial: { rows: ["b"] } });
        const after = computeStoryContentHashes({ prologue: { rows: ["a"] }, trial: { rows: ["b", "c"] } });
        expect(after.prologue).toBe(before.prologue);
        expect(after.trial).not.toBe(before.trial);
    });

    /** Adding a story leaves the ones already there untouched - and their players' saves with them. */
    it("does not move a story because another was added", () => {
        const before = computeStoryContentHashes({ prologue: { rows: ["a"] } });
        const after = computeStoryContentHashes({ prologue: { rows: ["a"] }, side: {} });
        expect(after.prologue).toBe(before.prologue);
    });

    it("is empty when there is nothing to hash, which reads as 'cannot be compared'", () => {
        expect(computeStoryContentHashes(undefined)).toEqual({});
        expect(computeStoryContentHashes(null)).toEqual({});
        expect(computeStoryContentHashes({})).toEqual({});
    });

    it("is a fixed-width hex string per story", () => {
        expect(computeStoryContentHashes({ s1: {} }).s1).toMatch(/^[0-9a-f]{16}$/);
    });
});
