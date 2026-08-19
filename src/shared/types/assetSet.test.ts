import { describe, expect, it } from "vitest";
import {
    assetSetCoordinateLabel,
    assetSetCoordinates,
    collectAssetTagVocabulary,
    formatAssetTag,
    isAssetSetComplete,
    childAssetSets,
    isLegalNesting,
    topLevelAssetSets,
    normalizeProjectAssetSets,
    parseAssetTag,
    resolveAssetSetContents,
    resolveAssetSetMember,
    uniqueAssetSetName,
    validateAssetSet,
    type AssetSet,
    type AssetSetAxis,
    type AssetSetCandidate,
} from "./assetSet";

function axis(key: string, residency: AssetSetAxis["residency"], values: string[]): AssetSetAxis {
    return { kind: key === "locale" ? "locale" : "release", key, residency, values };
}

function set(overrides: Partial<AssetSet> = {}): AssetSet {
    return {
        id: "set-1",
        name: "Alice",
        type: "image",
        filter: ["char:alice"],
        axis: axis("mood", "build", ["happy", "sad"]),
        ...overrides,
    };
}

function candidate(id: string, tags: string[], type = "image"): AssetSetCandidate {
    return { id, type, tags };
}

describe("parseAssetTag", () => {
    it("reads a category and a value", () => {
        expect(parseAssetTag("locale:ja")).toEqual({ category: "locale", value: "ja" });
    });

    it("splits at the first colon so a value may contain one", () => {
        expect(parseAssetTag("source:https://example.com")).toEqual({
            category: "source",
            value: "https://example.com",
        });
    });

    it("treats a plain label as no coordinate", () => {
        expect(parseAssetTag("draft")).toBeNull();
    });

    it("refuses a half-written pair, which would otherwise match on emptiness", () => {
        expect(parseAssetTag(":ja")).toBeNull();
        expect(parseAssetTag("locale:")).toBeNull();
        expect(parseAssetTag("locale:   ")).toBeNull();
    });
});

describe("assetSetCoordinates", () => {
    it("produces one coordinate per value, in author order", () => {
        expect(assetSetCoordinates(set()).map(coordinate => coordinate.mood)).toEqual(["happy", "sad"]);
    });

    it("promises nothing when an axis declares no values", () => {
        expect(assetSetCoordinates(set({ axis: axis("mood", "build", []) }))).toEqual([]);
    });

    it("labels a coordinate as the tag it is made of", () => {
        const coordinates = assetSetCoordinates(set());
        expect(assetSetCoordinateLabel(set(), coordinates[0])).toBe("mood:happy");
    });
});

describe("resolution", () => {
    const library = [
        candidate("a", ["char:alice", "mood:happy"]),
        candidate("c", ["char:alice", "mood:sad"]),
    ];

    it("resolves a coordinate to the one asset carrying its tags", () => {
        expect(resolveAssetSetMember(set(), { mood: "happy" }, library)).toBe("a");
    });

    it("answers nothing for a coordinate the library has no file for", () => {
        expect(resolveAssetSetMember(set(), { mood: "sad" }, [library[0]])).toBeNull();
    });

    it("answers nothing rather than picking when two files match", () => {
        const ambiguous = [...library, candidate("d", ["char:alice", "mood:happy"])];
        expect(resolveAssetSetMember(set(), { mood: "happy" }, ambiguous)).toBeNull();
    });

    it("ignores a file of another type", () => {
        const wrongType = [candidate("z", ["char:alice", "mood:happy"], "audio")];
        expect(resolveAssetSetMember(set(), { mood: "happy" }, wrongType)).toBeNull();
    });

    it("holds the fixed filter against every member", () => {
        const otherCharacter = [candidate("z", ["char:bob", "mood:happy"])];
        expect(resolveAssetSetMember(set(), { mood: "happy" }, otherCharacter)).toBeNull();
    });

    it("reads a spaced tag as the same coordinate, since the two are typed by different people", () => {
        const spaced = [candidate("a", ["char: alice", "mood:happy "])];
        expect(resolveAssetSetMember(set(), { mood: "happy" }, spaced)).toBe("a");
    });

    it("separates the holes from the duplicates", () => {
        const contents = resolveAssetSetContents(set(), [
            candidate("a", ["char:alice", "mood:happy"]),
            candidate("d", ["char:alice", "mood:happy"]),
        ]);
        expect(contents.cells).toHaveLength(2);
        expect(contents.missing.map(cell => cell.label)).toEqual(["mood:sad"]);
        expect(contents.ambiguous.map(cell => cell.assetIds)).toEqual([["a", "d"]]);
        expect(isAssetSetComplete(set(), library)).toBe(true);
    });

    it("is complete when every coordinate resolves to exactly one file", () => {
        expect(isAssetSetComplete(set(), library)).toBe(true);
    });

    it("counts a value answered by a sub-set as answered rather than as a hole", () => {
        const child = set({
            id: "child",
            filter: ["char:alice", "mood:sad"],
            axis: axis("locale", "runtime", ["en", "ja"]),
        });
        const contents = resolveAssetSetContents(set(), [library[0]], [set(), child]);
        expect(contents.missing).toEqual([]);
        expect(contents.cells[1].childSetIds).toEqual(["child"]);
    });

    it("lets a sub-set answer its value even though its files carry this set's tags too", () => {
        // Every file under `child` also carries `mood:happy`, which is what makes it a member of the
        // set above. Counting those as this set's own answers would report every nested set as
        // ambiguous with its own contents.
        const child = set({
            id: "child",
            filter: ["char:alice", "mood:happy"],
            axis: axis("locale", "runtime", ["en"]),
        });
        const contents = resolveAssetSetContents(set(), library, [set(), child]);
        expect(contents.ambiguous).toEqual([]);
        expect(contents.cells[0].childSetIds).toEqual(["child"]);
    });
});

describe("collectAssetTagVocabulary", () => {
    it("groups values by category in first-seen order and skips plain labels", () => {
        const vocabulary = collectAssetTagVocabulary([
            candidate("a", ["mood:happy", "draft", "locale:en"]),
            candidate("b", ["mood:sad", "mood:happy"]),
        ]);
        expect([...vocabulary.keys()]).toEqual(["mood", "locale"]);
        expect(vocabulary.get("mood")).toEqual(["happy", "sad"]);
    });
});

describe("nesting", () => {
    const outer = set({ id: "outer", filter: ["char:alice"], axis: axis("mood", "build", ["happy", "sad"]) });
    const inner = set({
        id: "inner",
        filter: ["char:alice", "mood:sad"],
        axis: axis("locale", "runtime", ["en", "ja"]),
    });

    it("reads a set declaring one more tag as hanging under that value", () => {
        expect(childAssetSets(outer, "sad", [outer, inner]).map(entry => entry.id)).toEqual(["inner"]);
        expect(childAssetSets(outer, "happy", [outer, inner])).toEqual([]);
    });

    it("does not read a set two tags deeper as a direct child", () => {
        const deeper = set({
            id: "deeper",
            filter: ["char:alice", "mood:sad", "locale:ja"],
            axis: axis("outfit", "build", ["school"]),
        });
        expect(childAssetSets(outer, "sad", [outer, inner, deeper]).map(entry => entry.id)).toEqual(["inner"]);
    });

    it("answers which sets stand on their own", () => {
        expect(topLevelAssetSets([outer, inner]).map(entry => entry.id)).toEqual(["outer"]);
    });

    it("refuses a build axis under a runtime one, and allows the reverse", () => {
        expect(isLegalNesting(axis("mood", "build", []), axis("locale", "runtime", []))).toBe(true);
        expect(isLegalNesting(axis("locale", "runtime", []), axis("mood", "build", []))).toBe(false);
    });

    it("reports the inversion on the inner set, which is the one that can be moved", () => {
        const runtimeOuter = { ...outer, axis: axis("mood", "runtime", ["happy", "sad"]) };
        const buildInner = { ...inner, axis: axis("locale", "build", ["en", "ja"]) };
        expect(validateAssetSet(buildInner, [runtimeOuter, buildInner])).toContainEqual({
            kind: "residencyInversion",
            axisKey: "locale",
            outerAxisKey: "mood",
        });
        expect(validateAssetSet(runtimeOuter, [runtimeOuter, buildInner])).toEqual([]);
    });
});

describe("validateAssetSet", () => {
    it("passes a set that declares an axis with values", () => {
        expect(validateAssetSet(set())).toEqual([]);
    });

    it("reports an axis that promises nothing, and a set that names no axis at all", () => {
        expect(validateAssetSet(set({ axis: axis("mood", "build", []) }))).toContainEqual({
            kind: "emptyAxisValues",
            axisKey: "mood",
        });
        expect(validateAssetSet(set({ axis: { kind: "release", key: "", residency: "build", values: [] } }))).toContainEqual({ kind: "noAxes" });
    });

    it("reports a repeated value on one axis", () => {
        expect(validateAssetSet(set({ axis: axis("mood", "build", ["happy", "happy"]) })))
            .toContainEqual({ kind: "duplicateAxisValue", axisKey: "mood", value: "happy" });
    });
});

describe("normalizeProjectAssetSets", () => {
    it("answers an empty document for anything unreadable", () => {
        expect(normalizeProjectAssetSets(null).sets).toEqual([]);
        expect(normalizeProjectAssetSets([]).sets).toEqual([]);
        expect(normalizeProjectAssetSets({ sets: "no" }).sets).toEqual([]);
    });

    it("drops a record with no id or no type, which could not be resolved or filed", () => {
        const locale = { key: "locale", residency: "runtime", values: ["en"] };
        const document = normalizeProjectAssetSets({
            sets: [
                { id: "", type: "image", axis: locale },
                { id: "a", type: "", axis: locale },
                { id: "b", type: "image", axis: locale },
            ],
        });
        expect(document.sets.map(entry => entry.id)).toEqual(["b"]);
    });

    it("reads a set stored the old way, and makes its inner axes the sub-sets they now are", () => {
        const document = normalizeProjectAssetSets({
            sets: [{
                id: "a",
                name: "Title",
                type: "image",
                filter: ["set:a"],
                axes: [
                    { key: "release", residency: "build", values: ["release", "demo"] },
                    { key: "locale", residency: "runtime", values: ["en", "ja"] },
                ],
            }],
        });
        expect(document.sets.map(entry => entry.id)).toEqual(["a", "a:release", "a:demo"]);
        expect(document.sets[0].axis).toMatchObject({ kind: "release", key: "release" });
        expect(document.sets[1]).toMatchObject({
            filter: ["set:a", "release:release"],
            axis: { kind: "locale", key: "locale", residency: "runtime", values: ["en", "ja"] },
        });
        expect(childAssetSets(document.sets[0], "demo", document.sets).map(entry => entry.id)).toEqual(["a:demo"]);
    });

    it("drops a set indexed by something that is no longer a kind, rather than mis-resolving it", () => {
        const document = normalizeProjectAssetSets({
            sets: [
                { id: "a", type: "image", axis: { key: "mood", residency: "build", values: ["happy"] } },
                { id: "b", type: "image", axis: { key: "locale", residency: "runtime", values: ["en"] } },
            ],
        });
        expect(document.sets.map(entry => entry.id)).toEqual(["b"]);
    });

    it("derives residency from the kind rather than reading whatever was stored", () => {
        const document = normalizeProjectAssetSets({
            sets: [{ id: "a", type: "image", axis: { key: "locale", residency: "whenever", values: ["en"] } }],
        });
        expect(document.sets[0].axis.residency).toBe("runtime");
    });

    it("keeps the folder a set was made in, and omits it when there is none", () => {
        const locale = { key: "locale", residency: "runtime", values: ["en"] };
        const document = normalizeProjectAssetSets({
            sets: [
                { id: "a", type: "image", axis: locale, groupId: " g1 " },
                { id: "b", type: "image", axis: locale, groupId: "  " },
            ],
        });
        expect(document.sets[0].groupId).toBe("g1");
        expect(document.sets[1]).not.toHaveProperty("groupId");
    });

    it("drops a record that names no axis at all", () => {
        expect(normalizeProjectAssetSets({ sets: [{ id: "a", type: "image" }] }).sets).toEqual([]);
    });
});

describe("uniqueAssetSetName", () => {
    it("numbers a name already in use", () => {
        expect(uniqueAssetSetName("Alice", ["Alice"])).toBe("Alice 2");
        expect(uniqueAssetSetName("Alice", ["Alice", "Alice 2"])).toBe("Alice 3");
    });

    it("compares without case, since two names differing only in case read as one", () => {
        expect(uniqueAssetSetName("alice", ["Alice"])).toBe("alice 2");
    });
});

describe("formatAssetTag", () => {
    it("writes the spelling the parser reads back", () => {
        expect(parseAssetTag(formatAssetTag(" locale ", " ja "))).toEqual({ category: "locale", value: "ja" });
    });
});

