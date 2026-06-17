import { describe, expect, it } from "vitest";
import {
    addJsonArrayItem,
    addJsonObjectField,
    moveJsonArrayItem,
    normalizeJsonValue,
    removeJsonArrayItem,
    renameJsonObjectField,
    summarizeJsonValue,
} from "./blueprintJsonValue";

describe("blueprintJsonValue helpers", () => {
    it("normalizes values into JSON-safe data", () => {
        const circular: Record<string, unknown> = { name: "loop" };
        circular.self = circular;

        expect(
            normalizeJsonValue({
                ok: true,
                missing: undefined,
                badNumber: Number.POSITIVE_INFINITY,
                fn: () => undefined,
                circular,
            }),
        ).toMatchObject({
            ok: true,
            missing: null,
            badNumber: null,
            fn: expect.any(String),
            circular: { name: "loop", self: null },
        });
    });

    it("adds and renames object fields without committing invalid keys", () => {
        const added = addJsonObjectField({ field: 1 }, "field");
        expect(added.key).toBe("field2");
        expect(added.value).toEqual({ field: 1, field2: null });

        expect(renameJsonObjectField(added.value, "field2", "name")).toEqual({
            value: { field: 1, name: null },
            committed: true,
        });
        expect(renameJsonObjectField(added.value, "field2", "")).toMatchObject({
            value: added.value,
            committed: false,
            error: "empty",
        });
        expect(renameJsonObjectField(added.value, "field2", "field")).toMatchObject({
            value: added.value,
            committed: false,
            error: "duplicate",
        });
    });

    it("adds, removes, and moves array items", () => {
        expect(addJsonArrayItem([1])).toEqual([1, null]);
        expect(removeJsonArrayItem([1, 2, 3], 1)).toEqual([1, 3]);
        expect(moveJsonArrayItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    });

    it("summarizes JSON values for compact node cards", () => {
        expect(summarizeJsonValue({ a: 1, b: 2, c: 3, d: 4 })).toBe("{ a, b, c, +1 }");
        expect(summarizeJsonValue([1, 2])).toBe("[2 items]");
        expect(summarizeJsonValue("abcdefghijklmnopqrstuvwxyz0123456789")).toBe(
            "\"abcdefghijklmnopqrstuvwxyz0123456...\"",
        );
    });
});
