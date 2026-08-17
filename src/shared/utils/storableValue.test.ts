import { describe, expect, it } from "vitest";
import { readWrappedStorableValue, readWrappedStorableNamespace } from "./storableValue";

describe("readWrappedStorableValue", () => {
    // The bug this exists for: the wrapper stored as the value. An object is truthy, so a
    // condition on a boolean flag took its other branch with nothing reporting anything.
    it("returns the value, not the wrapper", () => {
        expect(readWrappedStorableValue({ type: "any", data: true })).toBe(true);
        expect(readWrappedStorableValue({ type: "any", data: 0 })).toBe(0);
        expect(readWrappedStorableValue({ type: "any", data: "" })).toBe("");
        expect(readWrappedStorableValue({ type: "any", data: ["a", "b"] })).toEqual(["a", "b"]);
    });

    it("revives a Date, whichever way the engine annotated it", () => {
        const iso = "2026-08-16T10:20:30.000Z";
        expect(readWrappedStorableValue({ type: "date", data: iso })).toEqual(new Date(iso));
        expect(readWrappedStorableValue({ type: "any", data: iso, dates: [[]] })).toEqual(new Date(iso));
    });

    it("revives Dates and undefineds buried inside a value", () => {
        const iso = "2026-08-16T10:20:30.000Z";
        const value = readWrappedStorableValue({
            type: "any",
            data: { party: [{ name: "yuko", metAt: iso }], note: null },
            dates: [["party", 0, "metAt"]],
            undefineds: [["note"]],
        }) as { party: { metAt: Date }[]; note: undefined };
        expect(value.party[0].metAt).toEqual(new Date(iso));
        expect(value.note).toBeUndefined();
        expect("note" in value).toBe(true);
    });

    it("passes a value that carries no wrapper through untouched", () => {
        // A save written before the wrapper existed, and anything a caller hands over raw.
        expect(readWrappedStorableValue(true)).toBe(true);
        expect(readWrappedStorableValue(["a"])).toEqual(["a"]);
        expect(readWrappedStorableValue(undefined)).toBeUndefined();
        expect(readWrappedStorableValue({ data: 1 })).toEqual({ data: 1 });
    });

    it("skips an annotation that does not resolve rather than inventing the branch", () => {
        expect(readWrappedStorableValue({ type: "any", data: { a: 1 }, dates: [["b", "c"]] }))
            .toEqual({ a: 1 });
    });
});

describe("readWrappedStorableNamespace", () => {
    it("unwraps every value in a namespace", () => {
        expect(readWrappedStorableNamespace({
            "flag-id": { type: "any", data: true },
            "name-id": { type: "any", data: "yuko" },
        })).toEqual({ "flag-id": true, "name-id": "yuko" });
    });

    it("answers empty for anything that is not a namespace", () => {
        expect(readWrappedStorableNamespace(undefined)).toEqual({});
        expect(readWrappedStorableNamespace([1, 2])).toEqual({});
    });
});
