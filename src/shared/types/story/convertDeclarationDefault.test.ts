import { describe, expect, it } from "vitest";
import { convertDeclarationDefault } from "./declarations";

describe("convertDeclarationDefault", () => {
    it("keeps a value that reads the same way in the new type", () => {
        expect(convertDeclarationDefault("5", "number")).toBe(5);
        expect(convertDeclarationDefault(5, "string")).toBe("5");
        expect(convertDeclarationDefault("true", "boolean")).toBe(true);
        expect(convertDeclarationDefault("假", "boolean")).toBe(false);
        expect(convertDeclarationDefault(true, "number")).toBe(1);
        expect(convertDeclarationDefault(0, "boolean")).toBe(false);
    });

    it("falls back to the type's default only when the value has no reading there", () => {
        expect(convertDeclarationDefault("abc", "number")).toBe(0);
        expect(convertDeclarationDefault("", "number")).toBe(0);
        expect(convertDeclarationDefault("maybe", "boolean")).toBe(false);
        expect(convertDeclarationDefault(undefined, "string")).toBe("");
    });
});
