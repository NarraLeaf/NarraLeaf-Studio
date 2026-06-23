import { describe, expect, it } from "vitest";
import {
    addJsonArrayItem,
    addJsonObjectField,
    coerceJsonValueToSchema,
    moveJsonArrayItem,
    normalizeJsonValue,
    removeJsonArrayItem,
    renameJsonObjectField,
    summarizeJsonValue,
    validateJsonValueAgainstSchema,
} from "./blueprintJsonValue";
import type { BlueprintJsonValueSchema } from "@/lib/ui-editor/blueprint-nodes/types";

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

    it("validates and coerces fixed object schemas", () => {
        const vector2dSchema: BlueprintJsonValueSchema = {
            kind: "object",
            allowExtraFields: false,
            fields: [
                { key: "x", kind: "number", required: true },
                { key: "y", kind: "number", required: true },
            ],
        };

        expect(validateJsonValueAgainstSchema({ x: 1, y: 2 }, vector2dSchema)).toEqual({ ok: true });
        expect(validateJsonValueAgainstSchema({ x: 1 }, vector2dSchema)).toMatchObject({
            ok: false,
            message: "$.y is required",
        });
        expect(validateJsonValueAgainstSchema({ x: 1, y: "2" }, vector2dSchema)).toMatchObject({
            ok: false,
            message: "$.y must be number",
        });
        expect(validateJsonValueAgainstSchema({ x: 1, y: 2, z: 3 }, vector2dSchema)).toMatchObject({
            ok: false,
            message: "$.z is not allowed",
        });
        expect(coerceJsonValueToSchema({ x: 1, z: 3 }, vector2dSchema)).toEqual({ x: 1, y: 0 });
    });
});
