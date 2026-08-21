import { describe, expect, it } from "vitest";
import {
    clearReachedEndings,
    ENDINGS_PERSISTENCE_KEY,
    isEndingReached,
    markEndingReached,
    normalizeEndingIds,
    readReachedEndings,
} from "./endingsRecord";

/**
 * The endings unlock record. Two of its rules are worth more than the rest and are what these hold:
 * a mark reads THROUGH to the store before it writes, and a repeat writes nothing at all.
 */

function store(initial: unknown = undefined) {
    const map = new Map<string, unknown>();
    if (initial !== undefined) {
        map.set(ENDINGS_PERSISTENCE_KEY, initial);
    }
    const writes: unknown[] = [];
    return {
        writes,
        persistence: {
            get: (key: string) => map.get(key),
            getAsync: async (key: string) => map.get(key),
            set: (key: string, value: unknown) => {
                writes.push(value);
                map.set(key, value);
            },
        },
    };
}

describe("normalizeEndingIds", () => {
    it("keeps strings in order, drops everything else, and dedupes", () => {
        expect(normalizeEndingIds(["a", 1, "", "b", null, "a"])).toEqual(["a", "b"]);
    });

    it("reads a value that is not an array as no endings at all", () => {
        expect(normalizeEndingIds(undefined)).toEqual([]);
        expect(normalizeEndingIds("a")).toEqual([]);
    });
});

describe("markEndingReached", () => {
    it("records the id", async () => {
        const { persistence, writes } = store();
        await markEndingReached(persistence, "ending-1");
        expect(readReachedEndings(persistence)).toEqual(["ending-1"]);
        expect(writes).toHaveLength(1);
    });

    it("reads the stored record before writing, so an earlier playthrough is not lost", async () => {
        // The session map is empty until something touches the key, and the FIRST ending of a run is
        // reached before anything has. A write built on the map alone would drop every ending the
        // player already had.
        const map = new Map<string, unknown>();
        const persistence = {
            get: (key: string) => map.get(key),
            getAsync: async () => ["ending-old"],
            set: (key: string, value: unknown) => {
                map.set(key, value);
            },
        };
        await markEndingReached(persistence, "ending-new");
        expect(readReachedEndings(persistence)).toEqual(["ending-old", "ending-new"]);
    });

    it("writes nothing when the ending is already recorded", async () => {
        // A replayed ending must not rewrite the file on every pass.
        const { persistence, writes } = store(["ending-1"]);
        await markEndingReached(persistence, "ending-1");
        expect(writes).toEqual([]);
    });

    it("ignores an empty id rather than recording one", async () => {
        const { persistence, writes } = store();
        await markEndingReached(persistence, "");
        expect(writes).toEqual([]);
    });
});

describe("isEndingReached", () => {
    it("answers for a recorded id, and answers false for anything else", () => {
        const { persistence } = store(["ending-1"]);
        expect(isEndingReached(persistence, "ending-1")).toBe(true);
        expect(isEndingReached(persistence, "ending-2")).toBe(false);
        // An empty id is "not reached", never an error: a half-wired gallery row stays locked
        // instead of taking the page down.
        expect(isEndingReached(persistence, "")).toBe(false);
    });
});

describe("clearReachedEndings", () => {
    it("leaves the record empty", async () => {
        const { persistence } = store(["ending-1", "ending-2"]);
        await clearReachedEndings(persistence);
        expect(readReachedEndings(persistence)).toEqual([]);
    });
});
