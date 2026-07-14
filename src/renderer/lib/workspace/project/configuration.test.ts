import { describe, expect, it } from "vitest";
import { normalizeBuildConfiguration } from "./configuration";

describe("normalizeBuildConfiguration", () => {
    it("returns null for empty / malformed input", () => {
        expect(normalizeBuildConfiguration(undefined)).toBeNull();
        expect(normalizeBuildConfiguration({})).toBeNull();
        expect(normalizeBuildConfiguration({ platforms: [] })).toBeNull();
        expect(normalizeBuildConfiguration({ platforms: ["atari"] })).toBeNull();
    });

    it("keeps known platforms and drops formats a platform does not support", () => {
        const result = normalizeBuildConfiguration({
            platforms: ["macos", "windows", "bogus"],
            formats: {
                macos: ["dmg", "nsis", "zip"], // nsis is not a macOS format
                windows: ["nsis"],
                bogus: ["zip"],
            },
            outputDir: "/tmp/out",
        });
        expect(result).toEqual({
            platforms: ["windows", "macos"],
            formats: {
                windows: ["nsis"],
                macos: ["zip", "dmg"],
            },
            outputDir: "/tmp/out",
        });
    });

    it("drops a platform that ends up with no valid formats (keeps platforms/formats in sync)", () => {
        const result = normalizeBuildConfiguration({
            platforms: ["windows", "macos"],
            formats: {
                windows: ["nsis"],
                macos: ["nsis"], // nsis invalid for macos → macos has no formats
            },
        });
        expect(result).toEqual({
            platforms: ["windows"],
            formats: { windows: ["nsis"] },
            outputDir: "",
        });
    });

    it("returns null when every selected platform loses all its formats", () => {
        expect(normalizeBuildConfiguration({ platforms: ["macos"], formats: { macos: ["nsis"] } })).toBeNull();
    });

    it("defaults the output dir to empty (the caller supplies <project>/dist)", () => {
        const result = normalizeBuildConfiguration({ platforms: ["linux"], formats: { linux: ["appimage"] } });
        expect(result?.outputDir).toBe("");
    });
});
