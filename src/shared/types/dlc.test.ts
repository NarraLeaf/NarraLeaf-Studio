import { describe, expect, it } from "vitest";

import { APP_TAG_ID_RELEASE, LEGACY_APP_TAG_ID_RELEASE } from "./appTag";
import {
    DLC_ID_MAX_LENGTH,
    createEmptyDlcDocument,
    dlcForAppTag,
    findDlc,
    isValidDlcId,
    migrateProjectDlcDocument,
    normalizeDlcId,
    normalizeProjectDlc,
    normalizeProjectDlcs,
    uniqueDlcId,
    uniqueDlcName,
    type ProjectDlc,
} from "./dlc";

const dlc = (id: string, attachTo = APP_TAG_ID_RELEASE): ProjectDlc => ({ id, name: id, attachTo });

describe("normalizeDlcId", () => {
    it("folds what an author types into something that can be a filename", () => {
        expect(normalizeDlcId("Summer Route!")).toBe("summer_route");
        expect(normalizeDlcId("  After Story  ")).toBe("after_story");
        expect(normalizeDlcId("chapter-2")).toBe("chapter-2");
    });

    it("refuses what cannot be repaired into an id rather than inventing one", () => {
        // Nothing here starts with a letter, and a DLC whose id was invented is a file the author
        // cannot recognise beside their game.
        expect(normalizeDlcId("2024")).toBe("");
        expect(normalizeDlcId("---")).toBe("");
        expect(normalizeDlcId("")).toBe("");
        expect(normalizeDlcId(42)).toBe("");
    });

    it("leaves no trailing separator after the length cut", () => {
        const long = `${"a".repeat(DLC_ID_MAX_LENGTH - 1)} tail`;
        const id = normalizeDlcId(long);
        expect(id.length).toBeLessThanOrEqual(DLC_ID_MAX_LENGTH);
        expect(isValidDlcId(id)).toBe(true);
        expect(id.endsWith("_")).toBe(false);
    });
});

describe("uniqueDlcId", () => {
    it("numbers a taken id instead of refusing it", () => {
        expect(uniqueDlcId(["summer"], "Summer")).toBe("summer_2");
        expect(uniqueDlcId(["summer", "summer_2"], "summer")).toBe("summer_3");
    });

    it("stays within the length limit by shortening the base, not the number", () => {
        const base = "a".repeat(DLC_ID_MAX_LENGTH);
        const next = uniqueDlcId([base], base);
        expect(next.length).toBeLessThanOrEqual(DLC_ID_MAX_LENGTH);
        expect(next.endsWith("_2")).toBe(true);
    });
});

describe("uniqueDlcName", () => {
    it("is case-insensitive, because two rows differing only in case cannot be told apart", () => {
        expect(uniqueDlcName(["Summer Route"], "summer route")).toBe("summer route 2");
    });
});

describe("normalizeProjectDlc", () => {
    it("drops a record with no usable id", () => {
        expect(normalizeProjectDlc({ name: "Summer" })).toBeNull();
        expect(normalizeProjectDlc({ id: "2024", name: "Summer" })).toBeNull();
        expect(normalizeProjectDlc("summer")).toBeNull();
    });

    it("falls back to the id for a blank name, so no row is nameless", () => {
        expect(normalizeProjectDlc({ id: "summer" })?.name).toBe("summer");
    });

    it("attaches to the release variant when nothing says otherwise", () => {
        expect(normalizeProjectDlc({ id: "summer" })?.attachTo).toBe(APP_TAG_ID_RELEASE);
    });

    it("reads the variant id's old spelling as the release variant", () => {
        expect(normalizeProjectDlc({ id: "summer", attachTo: LEGACY_APP_TAG_ID_RELEASE })?.attachTo)
            .toBe(APP_TAG_ID_RELEASE);
    });
});

describe("normalizeProjectDlcs", () => {
    it("keeps the first of a duplicated id", () => {
        const list = normalizeProjectDlcs([
            { id: "summer", name: "First" },
            { id: "summer", name: "Second" },
        ]);
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe("First");
    });

    it("reads anything that is not a list as no DLC at all", () => {
        expect(normalizeProjectDlcs(undefined)).toEqual([]);
        expect(normalizeProjectDlcs({ summer: {} })).toEqual([]);
    });
});

describe("migrateProjectDlcDocument", () => {
    it("reads an unreadable document as a project that ships no DLC", () => {
        expect(migrateProjectDlcDocument(null).dlcs).toEqual([]);
        expect(migrateProjectDlcDocument("nonsense")).toEqual(createEmptyDlcDocument());
    });

    it("keeps meta so a document round-trips without losing its timestamps", () => {
        const meta = { createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" };
        expect(migrateProjectDlcDocument({ dlcs: [], meta }).meta).toEqual(meta);
    });
});

describe("lookups", () => {
    const stored = [dlc("summer"), dlc("winter", "demo-tag")];

    it("has no fallback: an unknown id is absent, not the first one", () => {
        expect(findDlc(stored, "summer")?.id).toBe("summer");
        expect(findDlc(stored, "nope")).toBeNull();
        expect(findDlc(stored, "")).toBeNull();
    });

    it("lists only what attaches to the variant being asked about", () => {
        expect(dlcForAppTag(stored, APP_TAG_ID_RELEASE).map(entry => entry.id)).toEqual(["summer"]);
        expect(dlcForAppTag(stored, "demo-tag").map(entry => entry.id)).toEqual(["winter"]);
        // No variant named is the release variant, the same reading every other resolver takes.
        expect(dlcForAppTag(stored, undefined).map(entry => entry.id)).toEqual(["summer"]);
    });
});
