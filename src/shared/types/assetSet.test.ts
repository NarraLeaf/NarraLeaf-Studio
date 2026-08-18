import { describe, expect, it } from "vitest";
import {
    assetSetCoordinateLabel,
    assetSetCoordinates,
    collectAssetTagVocabulary,
    deriveAssetSetDraft,
    formatAssetTag,
    isAssetSetComplete,
    isLegalAxisOrder,
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
    return { key, residency, values };
}

function set(overrides: Partial<AssetSet> = {}): AssetSet {
    return {
        id: "set-1",
        name: "Alice",
        type: "image",
        filter: ["char:alice"],
        axes: [axis("mood", "build", ["happy", "sad"]), axis("locale", "runtime", ["en", "ja"])],
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
    it("produces the product with the outermost axis varying slowest", () => {
        expect(assetSetCoordinates(set()).map(coordinate => `${coordinate.mood}/${coordinate.locale}`)).toEqual([
            "happy/en",
            "happy/ja",
            "sad/en",
            "sad/ja",
        ]);
    });

    it("promises nothing when an axis declares no values", () => {
        expect(assetSetCoordinates(set({ axes: [axis("mood", "build", [])] }))).toEqual([]);
    });

    it("labels a coordinate as the tags it is made of", () => {
        const coordinates = assetSetCoordinates(set());
        expect(assetSetCoordinateLabel(set(), coordinates[0])).toBe("mood:happy · locale:en");
    });
});

describe("resolution", () => {
    const library = [
        candidate("a", ["char:alice", "mood:happy", "locale:en"]),
        candidate("b", ["char:alice", "mood:happy", "locale:ja"]),
        candidate("c", ["char:alice", "mood:sad", "locale:en"]),
    ];

    it("resolves a coordinate to the one asset carrying its tags", () => {
        expect(resolveAssetSetMember(set(), { mood: "happy", locale: "ja" }, library)).toBe("b");
    });

    it("answers nothing for a coordinate the library has no file for", () => {
        expect(resolveAssetSetMember(set(), { mood: "sad", locale: "ja" }, library)).toBeNull();
    });

    it("answers nothing rather than picking when two files match", () => {
        const ambiguous = [...library, candidate("d", ["char:alice", "mood:happy", "locale:ja"])];
        expect(resolveAssetSetMember(set(), { mood: "happy", locale: "ja" }, ambiguous)).toBeNull();
    });

    it("ignores a file of another type", () => {
        const wrongType = [candidate("z", ["char:alice", "mood:happy", "locale:en"], "audio")];
        expect(resolveAssetSetMember(set(), { mood: "happy", locale: "en" }, wrongType)).toBeNull();
    });

    it("holds the fixed filter against every member", () => {
        const otherCharacter = [candidate("z", ["char:bob", "mood:happy", "locale:en"])];
        expect(resolveAssetSetMember(set(), { mood: "happy", locale: "en" }, otherCharacter)).toBeNull();
    });

    it("reads a spaced tag as the same coordinate, since the two are typed by different people", () => {
        const spaced = [candidate("a", ["char: alice", "mood:happy ", "locale : en"])];
        expect(resolveAssetSetMember(set(), { mood: "happy", locale: "en" }, spaced)).toBe("a");
    });

    it("separates the holes from the duplicates", () => {
        const contents = resolveAssetSetContents(set(), [
            ...library,
            candidate("d", ["char:alice", "mood:happy", "locale:en"]),
        ]);
        expect(contents.cells).toHaveLength(4);
        expect(contents.missing.map(cell => cell.label)).toEqual(["mood:sad · locale:ja"]);
        expect(contents.ambiguous.map(cell => cell.assetIds)).toEqual([["a", "d"]]);
        expect(isAssetSetComplete(set(), library)).toBe(false);
    });

    it("is complete when every coordinate resolves to exactly one file", () => {
        const full = [...library, candidate("d", ["char:alice", "mood:sad", "locale:ja"])];
        expect(isAssetSetComplete(set(), full)).toBe(true);
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

describe("validateAssetSet", () => {
    it("passes a build axis enclosing a runtime axis", () => {
        expect(validateAssetSet(set())).toEqual([]);
        expect(isLegalAxisOrder(set().axes)).toBe(true);
    });

    it("reports a build axis placed inside a runtime axis", () => {
        const inverted = set({
            axes: [axis("locale", "runtime", ["en"]), axis("mood", "build", ["happy"])],
        });
        expect(validateAssetSet(inverted)).toContainEqual({
            kind: "residencyInversion",
            axisKey: "mood",
            outerAxisKey: "locale",
        });
        expect(isLegalAxisOrder(inverted.axes)).toBe(false);
    });

    it("names the outermost runtime axis once rather than every build axis under it", () => {
        const inverted = set({
            axes: [
                axis("locale", "runtime", ["en"]),
                axis("platform", "runtime", ["win"]),
                axis("mood", "build", ["happy"]),
            ],
        });
        const inversions = validateAssetSet(inverted).filter(problem => problem.kind === "residencyInversion");
        expect(inversions).toEqual([
            { kind: "residencyInversion", axisKey: "mood", outerAxisKey: "locale" },
        ]);
    });

    it("reports an axis that promises nothing, and a set with no axes at all", () => {
        expect(validateAssetSet(set({ axes: [axis("mood", "build", [])] }))).toContainEqual({
            kind: "emptyAxisValues",
            axisKey: "mood",
        });
        expect(validateAssetSet(set({ axes: [] }))).toContainEqual({ kind: "noAxes" });
    });

    it("reports a repeated value on one axis", () => {
        expect(validateAssetSet(set({ axes: [axis("mood", "build", ["happy", "happy"])] })))
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
        const document = normalizeProjectAssetSets({
            sets: [{ id: "", type: "image" }, { id: "a", type: "" }, { id: "b", type: "image" }],
        });
        expect(document.sets.map(entry => entry.id)).toEqual(["b"]);
    });

    it("keeps the outer of two axes over one tag category", () => {
        const document = normalizeProjectAssetSets({
            sets: [{
                id: "a",
                type: "image",
                axes: [
                    { key: "mood", residency: "build", values: ["happy"] },
                    { key: "mood", residency: "runtime", values: ["sad"] },
                ],
            }],
        });
        expect(document.sets[0].axes).toEqual([{ key: "mood", residency: "build", values: ["happy"] }]);
    });

    it("reads an unreadable residency as build, which is the answer that keeps bytes out", () => {
        const document = normalizeProjectAssetSets({
            sets: [{ id: "a", type: "image", axes: [{ key: "mood", residency: "whenever", values: ["x"] }] }],
        });
        expect(document.sets[0].axes[0].residency).toBe("build");
    });

    it("preserves an illegal order rather than reordering an author's axes silently", () => {
        const document = normalizeProjectAssetSets({
            sets: [{
                id: "a",
                type: "image",
                axes: [
                    { key: "locale", residency: "runtime", values: ["en"] },
                    { key: "mood", residency: "build", values: ["happy"] },
                ],
            }],
        });
        expect(document.sets[0].axes.map(entry => entry.key)).toEqual(["locale", "mood"]);
        expect(isLegalAxisOrder(document.sets[0].axes)).toBe(false);
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

describe("deriveAssetSetDraft", () => {
    it("fixes what every file agrees on and makes an axis of what they vary along", () => {
        const draft = deriveAssetSetDraft([
            candidate("a", ["char:alice", "mood:happy", "locale:en"]),
            candidate("b", ["char:alice", "mood:happy", "locale:ja"]),
            candidate("c", ["char:alice", "mood:sad", "locale:en"]),
        ]);
        expect(draft.filter).toEqual(["char:alice"]);
        expect(draft.axes).toEqual([
            { key: "mood", residency: "build", values: ["happy", "sad"] },
            { key: "locale", residency: "build", values: ["en", "ja"] },
        ]);
    });

    it("starts every axis at build, the residency that keeps bytes out of a package", () => {
        const draft = deriveAssetSetDraft([
            candidate("a", ["locale:en"]),
            candidate("b", ["locale:ja"]),
        ]);
        expect(draft.axes.map(entry => entry.residency)).toEqual(["build"]);
    });

    it("drops a category only some files carry, which is neither fixed nor an axis", () => {
        const draft = deriveAssetSetDraft([
            candidate("a", ["char:alice", "mood:happy"]),
            candidate("b", ["char:alice"]),
        ]);
        expect(draft.filter).toEqual(["char:alice"]);
        expect(draft.axes).toEqual([]);
    });

    it("ignores plain labels, which index nothing", () => {
        const draft = deriveAssetSetDraft([
            candidate("a", ["draft", "char:alice"]),
            candidate("b", ["draft", "char:alice"]),
        ]);
        expect(draft.filter).toEqual(["char:alice"]);
    });
});
