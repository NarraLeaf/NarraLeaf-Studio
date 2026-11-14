import { describe, expect, it } from "vitest";
import { findItemIndexByField, type UIStructDef } from "./struct";

const row: UIStructDef = {
    id: "row",
    fields: [
        { id: "json-id", key: "details", type: "json" },
        { id: "number-id", key: "score", type: "number" },
        { id: "image-id", key: "image", type: "image" },
    ],
};

describe("findItemIndexByField", () => {
    it("matches JSON fields by content independently of object property order", () => {
        const items = [
            { details: { name: "Other" } },
            { details: { name: "Ada", stats: { score: 7, rank: 2 } } },
        ];
        expect(findItemIndexByField(items, row, "json-id", { stats: { rank: 2, score: 7 }, name: "Ada" })).toBe(1);
        expect(findItemIndexByField(items, row, "json-id", { stats: { rank: 2, score: 8 }, name: "Ada" })).toBe(-1);
    });

    it("keeps arrays ordered and follows the shared handling of missing values", () => {
        const items = [{ details: { values: [1, 2], missing: undefined } }];
        expect(findItemIndexByField(items, row, "json-id", { missing: null, values: [1, 2] })).toBe(0);
        expect(findItemIndexByField(items, row, "json-id", { missing: null, values: [2, 1] })).toBe(-1);
        expect(findItemIndexByField(items, row, "json-id", { values: [1, 2] })).toBe(-1);
    });

    it("coerces values to the declared field type before comparing", () => {
        const items = [{ score: "5", image: "cover" }];
        expect(findItemIndexByField(items, row, "number-id", 5)).toBe(0);
        expect(findItemIndexByField(items, row, "image-id", { kind: "imageAsset", assetId: "cover" })).toBe(0);
        expect(findItemIndexByField(items, row, "unknown", 5)).toBe(-1);
    });
});
