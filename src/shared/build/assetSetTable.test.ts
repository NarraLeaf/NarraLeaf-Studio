import { describe, expect, it } from "vitest";
import type { AssetSet, AssetSetCandidate } from "../types/assetSet";
import type { GameLocalizationBundle } from "../types/localization";
import { buildShippedAssetSetTable, collectAssetSetIds, resolveShippedAssetSetMember } from "./assetSetTable";

/**
 * The answers a package carries for content that has no row to write one into.
 *
 * Stated as what a package must not be able to do: name a variant this edition withheld, carry a set
 * id the runtime cannot resolve, or quietly take a side on a build axis nobody declared. The first
 * of those is the one that cannot be seen by looking at the game - the bytes are simply there.
 */

const SET_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = `${SET_ID}:ja`;
const EN = "aaaaaaaa-1111-4111-8111-111111111111";
const JA = "bbbbbbbb-1111-4111-8111-111111111111";
const ADULT = "dddddddd-1111-4111-8111-111111111111";
const ALLAGES = "eeeeeeee-1111-4111-8111-111111111111";

function localeSet(overrides: Partial<AssetSet> = {}): AssetSet {
    return {
        id: SET_ID,
        name: "Title art",
        type: "image",
        filter: ["cg:title"],
        axis: { kind: "locale", key: "locale", residency: "runtime", values: ["en", "ja"], fallback: "en" },
        ...overrides,
    };
}

function releaseSet(overrides: Partial<AssetSet> = {}): AssetSet {
    return {
        id: SET_ID,
        name: "Poster",
        type: "image",
        filter: ["cg:poster"],
        axis: { kind: "release", key: "release", residency: "build", values: ["main", "allages"], fallback: "main" },
        ...overrides,
    };
}

function library(entries: Array<[string, string[]]>): AssetSetCandidate[] {
    return entries.map(([id, tags]) => ({ id, type: "image", tags }));
}

function localization(): Pick<GameLocalizationBundle, "sourceLocale" | "locales"> {
    return {
        sourceLocale: "en",
        locales: [{ code: "en", displayName: "English" }, { code: "ja", displayName: "日本語" }],
    };
}

/** A character record shaped the way the bundle carries one: an id in a field, at some depth. */
function characterNaming(assetId: string): unknown {
    return [{ id: "c1", name: "Alice", appearance: { kind: "preset", poses: [{ id: "p1", assetId }] } }];
}

describe("collectAssetSetIds", () => {
    it("finds an id named anywhere in the payload, however deep", () => {
        expect([...collectAssetSetIds(characterNaming(SET_ID), [SET_ID])]).toEqual([SET_ID]);
    });

    it("does not report a parent set because a sub-set was named", () => {
        // A sub-set's id IS its parent's id plus a segment, so a bare substring match reports the
        // parent every time a child is used - and puts the parent's variants in a table nothing asked
        // for, which is bytes the package had no reason to carry.
        const found = collectAssetSetIds(characterNaming(CHILD_ID), [SET_ID, CHILD_ID]);
        expect([...found]).toEqual([CHILD_ID]);
    });

    it("says nothing when the project declares no sets", () => {
        expect(collectAssetSetIds(characterNaming(EN), []).size).toBe(0);
    });
});

describe("buildShippedAssetSetTable", () => {
    it("answers a runtime axis with every locale the project has", () => {
        const result = buildShippedAssetSetTable({
            payloads: [{ slice: "characters", payload: characterNaming(SET_ID) }],
            sets: [localeSet()],
            candidates: library([[EN, ["cg:title", "locale:en"]], [JA, ["cg:title", "locale:ja"]]]),
            localization: localization(),
        });
        expect(result.problems).toEqual([]);
        expect(result.table[SET_ID]).toEqual({ en: EN, ja: JA });
        expect([...result.referencedAssetIds].sort()).toEqual([EN, JA].sort());
    });

    it("carries only the member this edition keeps for a build axis", () => {
        // The whole point of a build axis. The withheld variant must not be nameable in the package:
        // the byte scan decides what to copy by looking for ids in the bytes, so an entry that listed
        // it would ship it.
        const result = buildShippedAssetSetTable({
            payloads: [{ slice: "the interface", payload: characterNaming(SET_ID) }],
            sets: [releaseSet()],
            candidates: library([
                [ADULT, ["cg:poster", "release:main"]],
                [ALLAGES, ["cg:poster", "release:allages"]],
            ]),
            localization: localization(),
            assetAxes: { release: "allages" },
        });
        expect(result.collapsedBuildAxis).toBe(true);
        expect(result.table[SET_ID]).toEqual({ en: ALLAGES, ja: ALLAGES });
        expect(JSON.stringify(result.table)).not.toContain(ADULT);
    });

    it("refuses a build axis this edition never took a position on", () => {
        // Refused rather than defaulted: an edition that never said where it stands is exactly the
        // case where guessing ships the wrong art.
        const result = buildShippedAssetSetTable({
            payloads: [{ slice: "characters", payload: characterNaming(SET_ID) }],
            sets: [releaseSet()],
            candidates: library([[ADULT, ["cg:poster", "release:main"]]]),
            localization: localization(),
        });
        expect(result.table[SET_ID]).toBeUndefined();
        expect(result.problems).toEqual([
            { kind: "axisUnset", setId: SET_ID, setName: "Poster", axisKey: "release", slice: "characters" },
        ]);
    });

    it("reports a locale with no file, and carries no half answer for it", () => {
        const result = buildShippedAssetSetTable({
            payloads: [{ slice: "characters", payload: characterNaming(SET_ID) }],
            sets: [localeSet({ axis: { kind: "locale", key: "locale", residency: "runtime", values: ["en", "ja"], fallback: "de" } })],
            candidates: library([[JA, ["cg:title", "locale:ja"]]]),
            localization: localization(),
        });
        expect(result.table[SET_ID]).toBeUndefined();
        expect(result.problems.map(problem => problem.kind)).toEqual(["unfilled"]);
    });

    it("resolves a set once however many slices name it", () => {
        const result = buildShippedAssetSetTable({
            payloads: [
                { slice: "characters", payload: characterNaming(SET_ID) },
                { slice: "the interface", payload: characterNaming(SET_ID) },
            ],
            sets: [localeSet()],
            candidates: library([[EN, ["cg:title", "locale:en"]], [JA, ["cg:title", "locale:ja"]]]),
            localization: localization(),
        });
        expect(Object.keys(result.table)).toEqual([SET_ID]);
        expect(result.problems).toEqual([]);
    });

    it("carries nothing for a set no shipped content names", () => {
        const result = buildShippedAssetSetTable({
            payloads: [{ slice: "characters", payload: characterNaming(EN) }],
            sets: [localeSet()],
            candidates: library([[EN, ["cg:title", "locale:en"]], [JA, ["cg:title", "locale:ja"]]]),
            localization: localization(),
        });
        expect(result.table).toEqual({});
        expect(result.referencedAssetIds.size).toBe(0);
    });
});

describe("resolveShippedAssetSetMember", () => {
    const table = { [SET_ID]: { en: EN, ja: JA } };

    it("answers with the player's language", () => {
        expect(resolveShippedAssetSetMember(table, SET_ID, "ja", "en")).toBe(JA);
    });

    it("falls back to the source language, and then to any answer", () => {
        // Every entry in the table was resolvable when the package was written, so having one and
        // drawing nothing is the worst of the available answers.
        expect(resolveShippedAssetSetMember(table, SET_ID, "de", "en")).toBe(EN);
        expect(resolveShippedAssetSetMember(table, SET_ID, "de", "fr")).toBe(EN);
    });

    it("says nothing about an ordinary asset id", () => {
        expect(resolveShippedAssetSetMember(table, EN, "en", "en")).toBeNull();
        expect(resolveShippedAssetSetMember(undefined, SET_ID, "en", "en")).toBeNull();
    });
});
