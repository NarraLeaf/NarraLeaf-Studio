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
            archs: {},
            outputDir: "/tmp/out",
            compression: "maximum",
            openWhenDone: true,
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
            archs: {},
            outputDir: "",
            compression: "maximum",
            openWhenDone: true,
        });
    });

    it("drops stored mobile platforms until the dialog offers them", () => {
        // ALL_BUILD_PLATFORMS deliberately excludes android/ios while the
        // mobile pipeline lands worker-first; the UI batch flips this along
        // with DIALOG_PLATFORMS. Until then a stored mobile selection (from a
        // newer Studio or a hand-edited state) must not resurface targets the
        // pipeline rejects.
        expect(normalizeBuildConfiguration({
            platforms: ["android"],
            formats: { android: ["apk"] },
        })).toBeNull();
        const mixed = normalizeBuildConfiguration({
            platforms: ["android", "web"],
            formats: { android: ["apk"], web: ["zip"] },
        });
        expect(mixed?.platforms).toEqual(["web"]);
    });

    it("returns null when every selected platform loses all its formats", () => {
        expect(normalizeBuildConfiguration({ platforms: ["macos"], formats: { macos: ["nsis"] } })).toBeNull();
    });

    it("defaults the output dir to empty (the caller supplies <project>/dist)", () => {
        const result = normalizeBuildConfiguration({ platforms: ["linux"], formats: { linux: ["appimage"] } });
        expect(result?.outputDir).toBe("");
    });

    // Projects built before arch/compression/openWhenDone existed have none of
    // these keys; each must fall back to what that build already did.
    it("falls back for a selection stored before the new fields existed", () => {
        const result = normalizeBuildConfiguration({
            platforms: ["windows"],
            formats: { windows: ["nsis"] },
            outputDir: "/tmp/out",
        });
        expect(result?.archs).toEqual({});
        expect(result?.compression).toBe("maximum");
        expect(result?.openWhenDone).toBe(true);
    });

    it("keeps a stored arch but drops one the platform does not offer", () => {
        const result = normalizeBuildConfiguration({
            platforms: ["windows", "macos"],
            formats: { windows: ["nsis"], macos: ["dmg"] },
            // universal is macOS-only; Windows must fall back to its first arch.
            archs: { windows: "universal", macos: "universal" },
        });
        expect(result?.archs).toEqual({ windows: "x64", macos: "universal" });
    });

    it("never stores an arch for the web export", () => {
        const result = normalizeBuildConfiguration({
            platforms: ["web"],
            formats: { web: ["zip"] },
            archs: { web: "x64" },
        });
        expect(result?.archs).toEqual({});
    });

    it("drops a junk compression level", () => {
        const result = normalizeBuildConfiguration({
            platforms: ["linux"],
            formats: { linux: ["appimage"] },
            compression: "ultra",
        });
        expect(result?.compression).toBe("maximum");
    });

    it("keeps a valid stored compression and openWhenDone", () => {
        const result = normalizeBuildConfiguration({
            platforms: ["linux"],
            formats: { linux: ["appimage"] },
            compression: "store",
            openWhenDone: false,
        });
        expect(result?.compression).toBe("store");
        expect(result?.openWhenDone).toBe(false);
    });
});
