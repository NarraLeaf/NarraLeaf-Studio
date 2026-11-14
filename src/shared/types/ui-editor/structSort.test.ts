import { describe, expect, it } from "vitest";
import { sortItemsByField, type UIStructDef } from "./struct";

describe("sorting list rows by a field", () => {
    it("keeps rows without a value last in either direction, in their original order", () => {
        const struct: UIStructDef = { id: "scores", fields: [{ id: "score", key: "score", type: "number" }] };
        const rows = [
            { name: "two", score: 2 },
            { name: "missing" },
            { name: "one", score: 1 },
            { name: "empty", score: null },
        ];

        expect(sortItemsByField(rows, struct, "score", false)).toEqual([rows[2], rows[0], rows[1], rows[3]]);
        expect(sortItemsByField(rows, struct, "score", true)).toEqual([rows[0], rows[2], rows[1], rows[3]]);
        expect(rows.map(row => row.name)).toEqual(["two", "missing", "one", "empty"]);
    });

    it("sorts numeric fields as numbers when rows supply numeric strings", () => {
        const struct: UIStructDef = { id: "scores", fields: [{ id: "score", key: "score", type: "number" }] };
        const rows = [{ score: "10" }, { score: "2" }];

        expect(sortItemsByField(rows, struct, "score", false)).toEqual([rows[1], rows[0]]);
    });
});
