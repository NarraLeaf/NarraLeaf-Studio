import {describe, expect, it} from "vitest";
import {
    ASSETS_METADATA_DOCUMENT_PATH,
    AssetsMetadataShard,
    assetsMetadataSpec,
    LOCALIZATION_DOCUMENT_PATH,
    localizationDocumentSpec,
} from "@shared/documents/specs";
import {encodeCanonicalJson} from "@shared/documents/canonicalJson";
import {DocumentCorruptError, DocumentParseContext} from "@shared/documents/types";
import {
    LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
    LocalizationDocument,
    LocalizationUnit,
} from "@shared/types/localization";

/**
 * `spec.merge3` for the two formats D7 starts with, and the three properties the whole design
 * rests on:
 *
 *  - an absent base is an add/add and is NEVER read as an empty document, because an empty base
 *    turns every entry on both sides into an addition and merges the lot without asking;
 *  - a path with an open conflict holds base - mine when there is no base - so a half-resolved
 *    document is still a complete, writable document of its format;
 *  - decisions are addressed by the same `path` a `DocumentChange` carries, because comparing and
 *    resolving are one list seen twice.
 *
 * Round-trips go through `serialize`/`parse` where the spec has both. The asset shard's
 * `serialize` refuses by design (`AssetsService` owns writing that file), so its round-trip runs
 * through the canonical encoder and `parse` - which measures the same thing this test is about,
 * that the merged value is a complete document, and pins the refusal rather than working round it.
 */

const LOCALE_PATH = "editor/localization/zh-CN.json";
const IMAGE_SHARD = "assets/assets.metadata.image.json";

function contextFor(path: string, kind: "localization" | "assets-metadata", text: string): DocumentParseContext {
    return {
        path,
        corrupt(reason: string): never {
            throw new DocumentCorruptError({kind, path, reason, text});
        },
    };
}

function unit(target: string, overrides: Partial<LocalizationUnit> = {}): LocalizationUnit {
    return {target, sourceHash: "h", status: "translated", ...overrides};
}

function library(units: Record<string, LocalizationUnit>): LocalizationDocument {
    return {schemaVersion: LOCALIZATION_DOCUMENT_SCHEMA_VERSION, locale: "zh-CN", units};
}

function shard(assets: Record<string, Record<string, unknown>>): AssetsMetadataShard {
    return {type: "image", assets};
}

function asset(name: string, hash: string, overrides: Record<string, unknown> = {}) {
    return {id: name, type: "image", name, hash, ext: "png", source: "local", ...overrides};
}

/** The one thing that must be true of any merged document at any point: it can be written. */
function reparseLibrary(document: LocalizationDocument): LocalizationDocument {
    const text = localizationDocumentSpec.serialize(document);
    return localizationDocumentSpec.parse(JSON.parse(text), contextFor(LOCALE_PATH, "localization", text));
}

function reparseShard(document: AssetsMetadataShard): AssetsMetadataShard {
    // Not `assetsMetadataSpec.serialize` - see the note at the top of this file and the one on the
    // spec itself. The encoder is what a canonical write would use either way.
    const text = encodeCanonicalJson(document.assets);
    return assetsMetadataSpec.parse(JSON.parse(text), contextFor(IMAGE_SHARD, "assets-metadata", text));
}

describe("merge3 is declared where it can be reached", () => {
    it("carries onto the spec rather than being dropped by defineDocumentSpec", () => {
        // D1 declared `diff` on the spec interface and forgot it in the definition, so every
        // implementation written against it would have been dead code with nothing reporting it.
        // The same mistake for `merge3` costs more: the fallback is not a lesser change list, it is
        // the author resolving the whole file from one side.
        expect(typeof localizationDocumentSpec.merge3).toBe("function");
        expect(typeof assetsMetadataSpec.merge3).toBe("function");
        expect(localizationDocumentSpec.paths).toContain(LOCALIZATION_DOCUMENT_PATH);
        expect(assetsMetadataSpec.paths).toContain(ASSETS_METADATA_DOCUMENT_PATH);
    });
});

describe("localization merge3", () => {
    const base = library({
        greeting: unit("你好"),
        farewell: unit("再见"),
        untouched: unit("不变"),
    });

    it("merges a key only one side touched, with nothing to decide", () => {
        const mine = library({...base.units, greeting: unit("您好")});
        const theirs = library({...base.units, farewell: unit("拜拜")});

        const merged = localizationDocumentSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(merged.document.units.greeting.target).toBe("您好");
        expect(merged.document.units.farewell.target).toBe("拜拜");
        expect(merged.document.units.untouched.target).toBe("不变");
        expect(merged.decisions.map(one => [one.path.join("/"), one.outcome])).toEqual([
            ["units/greeting", "auto-mine"],
            ["units/farewell", "auto-theirs"],
        ]);
        // Round-trip: what came out is a document, not a merge artefact.
        expect(reparseLibrary(merged.document)).toStrictEqual(merged.document);
    });

    it("conflicts on one key and shows both translations, holding base until it is settled", () => {
        const mine = library({...base.units, greeting: unit("您好")});
        const theirs = library({...base.units, greeting: unit("嗨")});

        const merged = localizationDocumentSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(1);
        const [row] = merged.decisions;
        expect(row.path).toEqual(["units", "greeting"]);
        expect(row.outcome).toBe("conflict");
        // The entire question the author is being asked: both translations, verbatim, so the
        // surface can put them side by side.
        expect((row.mine.value as LocalizationUnit).target).toBe("您好");
        expect((row.theirs.value as LocalizationUnit).target).toBe("嗨");
        // Base, not a side. Holding a side would be taking the decision, and nothing would say so.
        expect(merged.document.units.greeting.target).toBe("你好");
        // Half resolved and still serializable - the property that lets an author stop midway.
        expect(reparseLibrary(merged.document)).toStrictEqual(merged.document);
    });

    it("does not call two sides that agree a conflict", () => {
        const both = unit("您好");
        const mine = library({...base.units, greeting: both});
        const theirs = library({...base.units, greeting: {...both}});

        const merged = localizationDocumentSpec.merge3!(base, mine, theirs);

        expect(merged.decisions).toEqual([]);
        expect(merged.conflicts).toBe(0);
        expect(merged.document.units.greeting.target).toBe("您好");
    });

    it("takes a deletion the other side did not touch", () => {
        const mine = library({greeting: base.units.greeting, untouched: base.units.untouched});
        const theirs = library({...base.units});

        const merged = localizationDocumentSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(merged.decisions.map(one => one.outcome)).toEqual(["auto-mine"]);
        expect(Object.keys(merged.document.units).sort()).toEqual(["greeting", "untouched"]);
    });

    it("conflicts when one side deleted a key the other edited", () => {
        const mine = library({farewell: base.units.farewell, untouched: base.units.untouched});
        const theirs = library({...base.units, greeting: unit("嗨")});

        const merged = localizationDocumentSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(1);
        expect(merged.decisions[0].mine.present).toBe(false);
        expect(merged.decisions[0].theirs.present).toBe(true);
        // Base again: the deletion is not accepted and neither is the edit.
        expect(merged.document.units.greeting.target).toBe("你好");
    });

    it("treats an absent base as add/add rather than as an empty document", () => {
        // The failure this guards: an empty base makes every unit on both sides an addition, all
        // of them merge automatically, and the author is handed a library neither of them wrote.
        const mine = library({greeting: unit("您好"), onlyMine: unit("只有我")});
        const theirs = library({greeting: unit("嗨"), onlyTheirs: unit("只有他们")});

        const merged = localizationDocumentSpec.merge3!(undefined, mine, theirs);

        expect(merged.decisions.every(one => one.outcome === "conflict")).toBe(true);
        expect(merged.conflicts).toBe(3);
        // No base to hold, so mine - the one value already in this author's tree - and nothing of
        // theirs slipped in unasked.
        expect(merged.document.units.greeting.target).toBe("您好");
        expect(merged.document.units.onlyMine.target).toBe("只有我");
        expect(merged.document.units.onlyTheirs).toBeUndefined();
        expect(reparseLibrary(merged.document)).toStrictEqual(merged.document);
    });

    it("is pure: neither side is mutated and nothing throws on an empty document", () => {
        const mine = library({greeting: unit("您好")});
        const theirs = library({});
        const before = JSON.stringify([mine, theirs]);

        expect(() => localizationDocumentSpec.merge3!(undefined, theirs, theirs)).not.toThrow();
        localizationDocumentSpec.merge3!(base, mine, theirs);

        expect(JSON.stringify([mine, theirs])).toBe(before);
    });
});

describe("assets-metadata merge3", () => {
    const base = shard({
        "a-1": asset("alice.png", "h1"),
        "a-2": asset("bob.png", "h2"),
    });

    it("merges two people importing different assets with no conflict at all", () => {
        // The commonest collaboration case in the system, and the one that has to be free.
        const mine = shard({...base.assets, "a-3": asset("mine.png", "h3")});
        const theirs = shard({...base.assets, "a-4": asset("theirs.png", "h4")});

        const merged = assetsMetadataSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(Object.keys(merged.document.assets)).toEqual(["a-1", "a-2", "a-3", "a-4"]);
        expect(merged.decisions.map(one => [one.path.join("/"), one.outcome, one.label?.key])).toEqual([
            ["assets/a-3", "auto-mine", "documentDiff.assets.added"],
            ["assets/a-4", "auto-theirs", "documentDiff.assets.added"],
        ]);
        expect(merged.decisions[0].subject).toBe("mine.png");
        expect(reparseShard(merged.document)).toStrictEqual(merged.document);
    });

    /**
     * Order is appended, never conflicted.
     *
     * The shard's key order IS the asset browser's row order, but it is recovered import order
     * rather than something the author arranged - there is no reorder gesture in the panel and
     * every insertion appends. So two sides that both appended have not disagreed about anything,
     * and mine keeps its positions while theirs' new ids land after them.
     */
    it("appends the other side's imports instead of interleaving or conflicting over order", () => {
        const mine = shard({"a-1": base.assets["a-1"], "a-2": base.assets["a-2"], "m-1": asset("m.png", "hm")});
        const theirs = shard({"t-1": asset("t.png", "ht"), "a-1": base.assets["a-1"], "a-2": base.assets["a-2"]});

        const merged = assetsMetadataSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(0);
        expect(Object.keys(merged.document.assets)).toEqual(["a-1", "a-2", "m-1", "t-1"]);
    });

    it("conflicts when both sides changed the same asset, and holds base meanwhile", () => {
        const mine = shard({...base.assets, "a-1": asset("alice.png", "h1", {tags: ["hero"]})});
        const theirs = shard({...base.assets, "a-1": asset("alice-renamed.png", "h1")});

        const merged = assetsMetadataSpec.merge3!(base, mine, theirs);

        expect(merged.conflicts).toBe(1);
        expect(merged.decisions[0].path).toEqual(["assets", "a-1"]);
        expect(merged.decisions[0].label?.key).toBe("documentDiff.assets.changed");
        // Not a field-by-field merge: `hash` is the digest of the bytes stored under this id, and a
        // record built from one side's hash and the other's name describes a file that is not there.
        expect(merged.document.assets["a-1"]).toStrictEqual(base.assets["a-1"]);
        expect(reparseShard(merged.document)).toStrictEqual(merged.document);
    });

    it("words a removal as a removal and an addition as an addition", () => {
        const mine = shard({"a-1": base.assets["a-1"]});
        const theirs = shard({...base.assets});

        const merged = assetsMetadataSpec.merge3!(base, mine, theirs);

        expect(merged.decisions.map(one => [one.outcome, one.label?.key])).toEqual([
            ["auto-mine", "documentDiff.assets.removed"],
        ]);
        expect(merged.document.assets["a-2"]).toBeUndefined();
    });

    it("treats an absent base as add/add rather than as an empty shard", () => {
        const mine = shard({"a-1": asset("alice.png", "h1")});
        const theirs = shard({"a-9": asset("zoe.png", "h9")});

        const merged = assetsMetadataSpec.merge3!(undefined, mine, theirs);

        expect(merged.conflicts).toBe(2);
        expect(Object.keys(merged.document.assets)).toEqual(["a-1"]);
        expect(reparseShard(merged.document)).toStrictEqual(merged.document);
    });

    it("still refuses to serialize through the spec, so the write-back path cannot use it yet", () => {
        // Pinned rather than assumed: D4 made `serialize` throw because `AssetsService` owns
        // writing this file, and a merge write-back that reached for it would fail at the last
        // step. Whoever adopts the shard for writing has to revisit this test and D6's pipeline.
        const merged = assetsMetadataSpec.merge3!(base, base, base);
        expect(() => assetsMetadataSpec.serialize(merged.document)).toThrow(/read-only/);
    });
});
