import { afterEach, describe, expect, it } from "vitest";
import {
    coerceUIPageParamValue,
    getActiveUIPageParams,
    getActiveUIPageParamsRevision,
    getUIPageParams,
    nextUIPageParamId,
    normalizeUIPageParams,
    setActiveUIPageParams,
    uiPageParamBlueprintValueType,
    uiPageParamDefaultValue,
    uiPageParamPinType,
    withUIPageParamDefaults,
} from "./pageParams";

afterEach(() => {
    setActiveUIPageParams([]);
});

describe("normalizeUIPageParams", () => {
    it("keeps declarations in author order, typed", () => {
        expect(normalizeUIPageParams([
            { id: "message", name: " message ", type: "string", defaultValue: "" },
            { id: "count", name: "count", type: "number", defaultValue: "3" },
            { id: "rows", name: "buttons", type: "json" },
        ])).toEqual([
            { id: "message", name: "message", type: "string", defaultValue: "" },
            { id: "count", name: "count", type: "number", defaultValue: 3 },
            { id: "rows", name: "buttons", type: "json" },
        ]);
    });

    it("drops what nothing could read it by, and a second claim on an id or a name", () => {
        expect(normalizeUIPageParams([
            { id: "a", name: "" },
            { id: "", name: "b" },
            { id: "has space", name: "c" },
            { id: "d", name: "d" },
            { id: "d", name: "again" },
            { id: "e", name: "d" },
            "not a param",
        ]).map(param => param.id)).toEqual(["d"]);
    });

    it("reads an unknown kind as a string", () => {
        expect(normalizeUIPageParams([{ id: "x", name: "x", type: "date" }])[0]?.type).toBe("string");
    });

    it("reads a Game UI as declaring nothing", () => {
        expect(getUIPageParams({ kind: "stageSurface", params: [{ id: "x", name: "x", type: "string" }] })).toEqual([]);
        expect(getUIPageParams({ kind: "appSurface", params: [{ id: "x", name: "x", type: "string" }] })).toHaveLength(1);
    });
});

describe("page parameter values", () => {
    it("turns a value into the declared kind the way an author would expect", () => {
        expect(coerceUIPageParamValue("number", "2.5")).toBe(2.5);
        expect(coerceUIPageParamValue("number", "two")).toBe(0);
        expect(coerceUIPageParamValue("boolean", "true")).toBe(true);
        expect(coerceUIPageParamValue("boolean", 0)).toBe(false);
        expect(coerceUIPageParamValue("string", 3)).toBe("3");
        expect(coerceUIPageParamValue("string", { a: 1 })).toBe("");
        expect(coerceUIPageParamValue("json", undefined)).toBeNull();
        expect(coerceUIPageParamValue("json", [1])).toEqual([1]);
    });

    it("reads the type's empty value when nothing is declared as the default", () => {
        expect(uiPageParamDefaultValue({ type: "string" })).toBe("");
        expect(uiPageParamDefaultValue({ type: "number" })).toBe(0);
        expect(uiPageParamDefaultValue({ type: "boolean" })).toBe(false);
        expect(uiPageParamDefaultValue({ type: "json" })).toBeNull();
    });

    it("lays the props a page was opened with over its defaults", () => {
        const surface = {
            kind: "appSurface" as const,
            params: [
                { id: "message", name: "message", type: "string", defaultValue: "Sure?" },
                { id: "count", name: "count", type: "number" },
            ],
        };
        expect(withUIPageParamDefaults(surface, { count: "4", extra: true })).toEqual({ message: "Sure?", count: 4, extra: true });
        expect(withUIPageParamDefaults(surface, undefined)).toEqual({ message: "Sure?", count: 0 });
        // A page that declares nothing reads its props untouched.
        const given = { a: 1 };
        expect(withUIPageParamDefaults({ kind: "appSurface" }, given)).toBe(given);
    });

    it("reads a text as a string, and a list as rows of the shape it names", () => {
        expect(coerceUIPageParamValue("text", 3)).toBe("3");
        expect(coerceUIPageParamValue("list", { a: 1 })).toEqual([]);
        expect(coerceUIPageParamValue("list", [{ a: 1 }])).toEqual([{ a: 1 }]);
        expect(uiPageParamDefaultValue({ type: "list" })).toEqual([]);
        expect(uiPageParamBlueprintValueType("text")).toBe("string");
        // Declared wide, typed narrow: a wire that carried rows before the page named their shape stays.
        expect(uiPageParamBlueprintValueType("list")).toBe("json");
        expect(uiPageParamPinType({ type: "list", struct: "nl.confirmButton" })).toBe("array<struct:nl.confirmButton>");
        expect(uiPageParamPinType({ type: "list" })).toBe("array");
        expect(normalizeUIPageParams([
            { id: "rows", name: "rows", type: "list", struct: " nl.confirmButton " },
            { id: "words", name: "words", type: "text", struct: "nl.confirmButton", defaultValue: 4 },
        ])).toEqual([
            { id: "rows", name: "rows", type: "list", struct: "nl.confirmButton" },
            { id: "words", name: "words", type: "text", defaultValue: "4" },
        ]);
    });

    it("names a new parameter after the first id that is free", () => {
        expect(nextUIPageParamId([])).toBe("param1");
        expect(nextUIPageParamId([{ id: "param1" }, { id: "param3" }])).toBe("param2");
    });
});

describe("the live declarations", () => {
    it("answers by page, and changes nothing when what is published did not change", () => {
        const surfaces = [
            { id: "confirm", kind: "appSurface" as const, params: [{ id: "message", name: "message", type: "string" }] },
            { id: "title", kind: "appSurface" as const },
        ];
        setActiveUIPageParams(surfaces);
        const revision = getActiveUIPageParamsRevision();
        expect(getActiveUIPageParams("confirm").map(param => param.name)).toEqual(["message"]);
        expect(getActiveUIPageParams("title")).toEqual([]);
        expect(getActiveUIPageParams(null)).toEqual([]);
        setActiveUIPageParams(JSON.parse(JSON.stringify(surfaces)));
        expect(getActiveUIPageParamsRevision()).toBe(revision);
        setActiveUIPageParams([{ id: "confirm", kind: "appSurface", params: [{ id: "message", name: "question", type: "string" }] }]);
        expect(getActiveUIPageParamsRevision()).toBe(revision + 1);
    });
});
