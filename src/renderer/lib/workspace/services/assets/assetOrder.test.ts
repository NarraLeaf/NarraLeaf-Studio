import { describe, expect, it } from "vitest";
import { parseAssetOrderDocument, reconcileAssetOrder } from "./assetOrder";

/**
 * The asset browser's row order lives in these arrays. What is pinned here is that a stale, damaged
 * or entirely absent order can move a row but can never remove one — which is what lets the order
 * file be optional, and what lets an older Studio go on reading the shards it always read.
 */

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

function record(...ids: string[]): Record<string, { id: string }> {
    const out: Record<string, { id: string }> = {};
    for (const id of ids) {
        out[id] = { id };
    }
    return out;
}

describe("parseAssetOrderDocument", () => {
    it("reads both arrays", () => {
        expect(parseAssetOrderDocument({ assetIds: [C, A], groupIds: ["group_2"] }))
            .toEqual({ assetIds: [C, A], groupIds: ["group_2"] });
    });

    it("yields no opinion for anything unreadable, rather than an empty library", () => {
        for (const junk of [null, undefined, 42, "text", [A, B], {}, { assetIds: "nope", groupIds: 7 }]) {
            expect(parseAssetOrderDocument(junk)).toEqual({ assetIds: [], groupIds: [] });
        }
    });

    it("discards non-string entries instead of rejecting the whole file", () => {
        expect(parseAssetOrderDocument({ assetIds: [A, 7, null, B] }).assetIds).toEqual([A, B]);
    });
});

describe("reconcileAssetOrder", () => {
    it("keeps the listed order", () => {
        expect(reconcileAssetOrder([C, A, B], record(A, B, C))).toEqual([C, A, B]);
    });

    it("appends an asset the order never mentioned — a newly imported one — rather than hiding it", () => {
        // The failure this exists to prevent: an import that does not show up reads as a failed
        // import, the author imports it again, and the library now holds it twice.
        expect(reconcileAssetOrder([A, B], record(A, B, C))).toEqual([A, B, C]);
    });

    it("drops an id the record no longer has", () => {
        expect(reconcileAssetOrder([A, "deleted-long-ago", B], record(A, B))).toEqual([A, B]);
    });

    it("handles both directions of staleness at once", () => {
        expect(reconcileAssetOrder([C, "gone"], record(C, A, B))).toEqual([C, A, B]);
    });

    it("never lets a duplicated or non-string entry duplicate a row", () => {
        expect(reconcileAssetOrder([A, A, 7, null, B], record(A, B))).toEqual([A, B]);
    });

    it("treats a missing order as 'no opinion' rather than 'nothing is here'", () => {
        // This is the whole compatibility story: a project with no order file draws its shard's key
        // order, exactly as every build before the file existed did.
        expect(reconcileAssetOrder(undefined, record(A, B))).toEqual([A, B]);
        expect(reconcileAssetOrder([], record(A, B))).toEqual([A, B]);
    });

    it("is idempotent, so running it on every read and every write cannot drift", () => {
        const once = reconcileAssetOrder([C, "gone"], record(C, A, B));
        expect(reconcileAssetOrder(once, record(C, A, B))).toEqual(once);
    });

    it("always yields a permutation of the record's keys", () => {
        const source = record(A, B, C);
        for (const ids of [[], [B], [C, C, B], ["x", "y"], [A, B, C]]) {
            expect([...reconcileAssetOrder(ids, source)].sort()).toEqual([A, B, C].sort());
        }
    });
});
