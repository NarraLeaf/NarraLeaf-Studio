import { describe, expect, it } from "vitest";
import { localizationDocumentSpec } from "@shared/documents/specs/localization";
import { resolveLocalizedUnitText } from "./localization";

describe("translation library loading", () => {
    it("retains every translation unit id from the stored document", () => {
        const raw = JSON.parse('{"schemaVersion":1,"locale":"ja","units":{"__proto__":{"target":"こんにちは","sourceHash":"hash","status":"translated"},"constructor":{"target":"さようなら","sourceHash":"other","status":"reviewed"}}}');
        const parsed = localizationDocumentSpec.parse(raw, {
            path: "editor/localization/ja.json",
            corrupt(reason): never { throw new Error(reason); },
        });

        expect(Object.keys(parsed.units)).toEqual(["__proto__", "constructor"]);
        expect(parsed.units.__proto__).toEqual({ target: "こんにちは", sourceHash: "hash", status: "translated" });
        expect(Object.getOwnPropertyDescriptor(parsed.units, "constructor")?.value.target).toBe("さようなら");
        expect(Object.getPrototypeOf(parsed.units)).toBe(Object.prototype);
    });

    it("does not read inherited functions for a missing unit id", () => {
        expect(resolveLocalizedUnitText({
            sourceLocale: "en",
            locales: [{ code: "en", displayName: "English" }, { code: "ja", displayName: "日本語" }],
            tables: { ja: {}, en: {} },
        }, "ja", "constructor")).toBeNull();
    });
});
