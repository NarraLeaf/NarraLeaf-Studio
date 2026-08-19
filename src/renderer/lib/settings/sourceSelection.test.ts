import { describe, expect, it } from "vitest";
import {
    OFFICIAL_SOURCE_VALUE,
    isPresetSource,
    matchedSourcePreset,
} from "./sourceSelection";

const PRESETS = [OFFICIAL_SOURCE_VALUE, "https://mirror.example.com/index.json"];

describe("matchedSourcePreset", () => {
    it("reads an unset address as the official source", () => {
        expect(matchedSourcePreset("", PRESETS)).toBe(OFFICIAL_SOURCE_VALUE);
    });

    it("reads whitespace as the official source, as the readers do", () => {
        expect(matchedSourcePreset("   ", PRESETS)).toBe(OFFICIAL_SOURCE_VALUE);
    });

    it("matches the offered source an address equals", () => {
        expect(matchedSourcePreset("https://mirror.example.com/index.json", PRESETS))
            .toBe("https://mirror.example.com/index.json");
    });

    it("matches through surrounding whitespace", () => {
        expect(matchedSourcePreset("  https://mirror.example.com/index.json  ", PRESETS))
            .toBe("https://mirror.example.com/index.json");
    });

    it("leaves anything else unmatched rather than rounding it to an offered source", () => {
        expect(matchedSourcePreset("https://registry.internal/index.json", PRESETS)).toBeNull();
    });

    it("leaves a former preset unmatched once it is no longer offered", () => {
        expect(matchedSourcePreset("https://mirror.example.com/index.json", [OFFICIAL_SOURCE_VALUE]))
            .toBeNull();
    });
});

describe("isPresetSource", () => {
    it("is true for an offered source and false for a typed one", () => {
        expect(isPresetSource("", PRESETS)).toBe(true);
        expect(isPresetSource("https://mirror.example.com/index.json", PRESETS)).toBe(true);
        expect(isPresetSource("https://registry.internal/index.json", PRESETS)).toBe(false);
    });
});
