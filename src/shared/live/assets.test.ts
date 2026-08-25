import { describe, expect, it } from "vitest";
import type { AssetMetadataEntry } from "@shared/documents/specs/assetsMetadata";
import { assetsDigest } from "./assets";

const RECORD: AssetMetadataEntry = {
    id: "asset-1",
    type: "image",
    name: "classroom.png",
    hash: "h1",
    ext: "png",
    source: "local",
    meta: {},
    tags: ["bg"],
    description: "",
};

describe("assetsDigest", () => {
    it("agrees for two copies built in different key orders", () => {
        // Two machines assemble a shard by different routes - one parsed off disk, one written
        // record by record as effects arrived - and a comparison that saw those as different would
        // report a disagreement nobody could act on.
        const mine = { a: RECORD, b: { ...RECORD, id: "asset-2", name: "hall.png" } };
        const theirs = {
            b: { name: "hall.png", type: "image", id: "asset-2", hash: "h1", ext: "png", source: "local", meta: {}, tags: ["bg"], description: "" },
            a: { description: "", tags: ["bg"], meta: {}, source: "local", ext: "png", hash: "h1", name: "classroom.png", type: "image", id: "asset-1" },
        };
        expect(assetsDigest(mine)).toBe(assetsDigest(theirs));
    });

    it("reads a key set to undefined as a key that is not there", () => {
        // ⚠ The one normalization, and it is not a convenience. `{ ...asset, ext: undefined }` is
        // what the asset services produce and `JSON.stringify` writes neither form, so the two are
        // the same file on disk - hashing them differently would eject a machine from the room over
        // a difference no document can hold. It also keeps this from being the digest that throws,
        // which inside an applier would take the session down.
        const { ext: _dropped, ...withoutExt } = RECORD;
        expect(assetsDigest({ a: { ...withoutExt, ext: undefined } })).toBe(assetsDigest({ a: withoutExt }));
    });

    it("notices a rename, a re-filing and a description, which is the whole point of computing it", () => {
        expect(assetsDigest({ a: RECORD })).not.toBe(assetsDigest({ a: { ...RECORD, name: "hall.png" } }));
        expect(assetsDigest({ a: RECORD })).not.toBe(assetsDigest({ a: { ...RECORD, groupId: "group-1" } }));
        expect(assetsDigest({ a: RECORD })).not.toBe(assetsDigest({ a: { ...RECORD, description: "the empty one" } }));
    });

    it("notices a record appearing or disappearing, so a missed operation cannot hide", () => {
        expect(assetsDigest({ a: RECORD })).not.toBe(assetsDigest({}));
    });

    it("hashes a shard nobody holds to a value rather than to nothing", () => {
        // The libraries' rule and the cast's: a workspace creates every shard as it starts, so
        // reaching an effect without one means this machine failed at something, and answering
        // "nothing was compared" would excuse exactly the case where two copies have parted company.
        expect(assetsDigest(null)).not.toBe(assetsDigest({}));
        expect(assetsDigest(null)).toEqual(expect.any(String));
    });

    it("is short enough to ride on every effect", () => {
        expect(assetsDigest({ a: RECORD })).toHaveLength(16);
    });
});
