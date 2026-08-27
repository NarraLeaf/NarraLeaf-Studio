import { describe, expect, it } from "vitest";
import { APP_TAG_SCHEMA_VERSION, type ProjectAppTagDocument } from "@shared/types/appTag";
import { BRAND_SCHEMA_VERSION, type ProjectBrandDocument } from "@shared/types/brand";
import { DLC_SCHEMA_VERSION, type ProjectDlcDocument } from "@shared/types/dlc";
import { appTagsDigest, brandDigest, dlcDigest, insertLiveRecordBefore } from "./config";

function appTags(patch: Partial<ProjectAppTagDocument> = {}): ProjectAppTagDocument {
    return { schemaVersion: APP_TAG_SCHEMA_VERSION, tags: [], ...patch };
}

function dlcs(patch: Partial<ProjectDlcDocument> = {}): ProjectDlcDocument {
    return { schemaVersion: DLC_SCHEMA_VERSION, dlcs: [], ...patch };
}

function brand(patch: Partial<ProjectBrandDocument> = {}): ProjectBrandDocument {
    return { schemaVersion: BRAND_SCHEMA_VERSION, colors: [], fonts: [], ...patch };
}

describe("the fingerprints of the three configuration tables", () => {
    it("answers a value for a table this window does not hold, rather than nothing", () => {
        // All three services read their file as the workspace starts, so arriving without one means
        // this machine has failed at something. Answering null would rule `unproven` on exactly the
        // effect that proves two copies have parted company.
        expect(appTagsDigest(null)).toEqual(expect.any(String));
        expect(appTagsDigest(null)).not.toBe(appTagsDigest(appTags()));
        expect(dlcDigest(null)).not.toBe(dlcDigest(dlcs()));
        expect(brandDigest(null)).not.toBe(brandDigest(brand()));
    });

    it("ignores the schema version, so a machine that migrated on load is not ejected", () => {
        const migrated = appTags({ schemaVersion: (APP_TAG_SCHEMA_VERSION - 1) as never });
        expect(appTagsDigest(migrated)).toBe(appTagsDigest(appTags()));
    });

    it("ignores the DLC document's timestamps, which every save stamps from its own clock", () => {
        // `DlcService.save` writes `meta.updatedAt` unconditionally, so two machines holding the same
        // list would otherwise disagree the moment one of them saved a moment later.
        const stamped = dlcs({ meta: { createdAt: "2020-01-01T00:00:00.000Z", updatedAt: "2026-08-26T09:00:00.000Z" } });
        expect(dlcDigest(stamped)).toBe(dlcDigest(dlcs()));
    });

    it("sees a row that changed, in every table", () => {
        expect(appTagsDigest(appTags({ tags: [{ id: "t", name: "Demo", overrides: {} }] })))
            .not.toBe(appTagsDigest(appTags({ tags: [{ id: "t", name: "Trial", overrides: {} }] })));
        expect(dlcDigest(dlcs({ dlcs: [{ id: "a", name: "A", attachTo: "release" }] })))
            .not.toBe(dlcDigest(dlcs({ dlcs: [{ id: "a", name: "A", attachTo: "demo" }] })));
        expect(brandDigest(brand({ colors: [{ id: "c", value: "#000000" }] })))
            .not.toBe(brandDigest(brand({ colors: [{ id: "c", value: "#000001" }] })));
    });

    it("sees a rearrangement, which is the reason the unit is the whole document", () => {
        // The one thing a per-row digest would say nothing at all about: `move-brand-color` changes
        // no row, and the order is what the panel draws.
        const first = brand({ colors: [{ id: "a", value: "#000000" }, { id: "b", value: "#FFFFFF" }] });
        const second = brand({ colors: [{ id: "b", value: "#FFFFFF" }, { id: "a", value: "#000000" }] });
        expect(brandDigest(first)).not.toBe(brandDigest(second));
    });

    it("sees the project's own half of the variants, key by key", () => {
        const base = appTags();
        expect(appTagsDigest(appTags({ pluginConfig: { steam: { appid: "480" } } }))).not.toBe(appTagsDigest(base));
        expect(appTagsDigest(appTags({ assetAxes: { rating: "teen" } }))).not.toBe(appTagsDigest(base));
        expect(appTagsDigest(appTags({ reachableScenes: { menu: [] } }))).not.toBe(appTagsDigest(base));
        expect(appTagsDigest(appTags({ endingSurfaceId: "credits" }))).not.toBe(appTagsDigest(base));
    });

    it("reads an absent key and an empty one as the same fact, because the document does", () => {
        // The normalizer deletes an empty record rather than storing `{}`, so a machine that wrote
        // the key and a machine that removed it hold the same document.
        expect(appTagsDigest(appTags({ pluginConfig: undefined }))).toBe(appTagsDigest(appTags()));
    });

    it("does not depend on the order the fields were written in", () => {
        // The canonical encoder, for the reason every digest in this feature uses it: two copies of
        // one record may have been assembled by different code paths, and `JSON.stringify` would
        // call them different over key order alone.
        const left = appTags({ tags: [{ id: "t", name: "Demo", overrides: { version: "1.0", displayName: "D" } }] });
        const right = appTags({ tags: [{ id: "t", overrides: { displayName: "D", version: "1.0" }, name: "Demo" }] });
        expect(appTagsDigest(left)).toBe(appTagsDigest(right));
    });
});

describe("where a creation that undoes a deletion puts the record back", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];

    it("puts it in front of the row it sat in front of", () => {
        expect(insertLiveRecordBefore(rows, { id: "x" }, "b").map(row => row.id))
            .toEqual(["a", "x", "b", "c"]);
    });

    it("appends when nothing names a neighbour, which is an ordinary creation", () => {
        expect(insertLiveRecordBefore(rows, { id: "x" }).map(row => row.id)).toEqual(["a", "b", "c", "x"]);
    });

    it("appends when the neighbour has gone too, rather than guessing a position", () => {
        // The end is the honest answer: the record is back and nothing else moved, where an index
        // would put it somewhere nobody chose.
        expect(insertLiveRecordBefore(rows, { id: "x" }, "gone").map(row => row.id))
            .toEqual(["a", "b", "c", "x"]);
    });

    it("leaves the list it was given alone", () => {
        insertLiveRecordBefore(rows, { id: "x" }, "b");
        expect(rows.map(row => row.id)).toEqual(["a", "b", "c"]);
    });
});
