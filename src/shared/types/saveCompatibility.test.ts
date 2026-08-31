import { describe, expect, it } from "vitest";
import {
    DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION,
    SAVE_PROTOCOL_VERSION,
    buildSaveBuildStamp,
    buildSaveCompatibilityStamp,
    classifySaveCompatibility,
    normalizeSaveCompatibilityConfiguration,
    planSaveResume,
    readSaveCompatibilityStamp,
    type SaveBuildStamp,
    type SaveCompatibilityStamp,
} from "./saveCompatibility";

/** A save written in the prologue of a two-story project. */
function stamp(overrides: Partial<SaveCompatibilityStamp> = {}): SaveCompatibilityStamp {
    return {
        protocol: SAVE_PROTOCOL_VERSION,
        storyId: "story-prologue",
        storyHash: "hash-prologue",
        gameVersion: "1.0.0",
        ...overrides,
    };
}

/** The build that ships both of them. */
function build(overrides: Partial<SaveBuildStamp> = {}): SaveBuildStamp {
    return {
        protocol: SAVE_PROTOCOL_VERSION,
        storyHashes: { "story-prologue": "hash-prologue", "story-trial": "hash-trial" },
        gameVersion: "1.0.0",
        ...overrides,
    };
}

describe("classifySaveCompatibility", () => {
    it("separates the three axes", () => {
        expect(classifySaveCompatibility(stamp(), build())).toBe("identical");
        expect(classifySaveCompatibility(stamp(), build({ gameVersion: "1.1.0" }))).toBe("compatible");
        expect(classifySaveCompatibility(
            stamp(),
            build({ storyHashes: { "story-prologue": "hash-prologue-v2", "story-trial": "hash-trial" } }),
        )).toBe("incompatible");
        // The protocol outranks the other two: nothing can be read out of the record to compare.
        expect(classifySaveCompatibility(
            stamp({ protocol: 99, storyHash: "elsewhere", gameVersion: "2.0.0" }),
            build(),
        )).toBe("unsupported");
    });

    /**
     * The point of hashing per story: patching one route must not retire the saves of players on
     * another. Both saves are from the same build; only the trial's content moved.
     */
    it("leaves a save alone when a different story was patched", () => {
        const patched = build({
            storyHashes: { "story-prologue": "hash-prologue", "story-trial": "hash-trial-v2" },
        });
        expect(classifySaveCompatibility(stamp(), patched)).toBe("identical");
        expect(classifySaveCompatibility(
            stamp({ storyId: "story-trial", storyHash: "hash-trial" }),
            patched,
        )).toBe("incompatible");
    });

    it("reports what it cannot compare as unknown rather than as a difference", () => {
        expect(classifySaveCompatibility(null, build())).toBe("unknown");
        expect(classifySaveCompatibility(stamp(), null)).toBe("unknown");
        // A bundle that could not be hashed would otherwise report every save as another story.
        expect(classifySaveCompatibility(stamp({ storyHash: "" }), build())).toBe("unknown");
        expect(classifySaveCompatibility(stamp(), build({ storyHashes: {} }))).toBe("unknown");
        // Written before saves knew their story: there is nothing to look up.
        expect(classifySaveCompatibility(stamp({ storyId: "" }), build())).toBe("unknown");
        // A story this build does not ship - an uninstalled DLC is the ordinary way that happens.
        expect(classifySaveCompatibility(stamp({ storyId: "story-side" }), build())).toBe("unknown");
    });

    it("treats two builds that carry no version as one version", () => {
        expect(classifySaveCompatibility(stamp({ gameVersion: "" }), build({ gameVersion: "" }))).toBe("identical");
        expect(classifySaveCompatibility(stamp({ gameVersion: "" }), build())).toBe("compatible");
    });
});

describe("readSaveCompatibilityStamp", () => {
    it("accepts a complete stamp and nothing else", () => {
        expect(readSaveCompatibilityStamp(stamp())).toEqual(stamp());
        expect(readSaveCompatibilityStamp(undefined)).toBeNull();
        expect(readSaveCompatibilityStamp({ protocol: 1, storyHash: "a" })).toBeNull();
        expect(readSaveCompatibilityStamp({ protocol: "1", storyHash: "a", gameVersion: "b" })).toBeNull();
    });

    /** Every record written before the story id existed is complete otherwise, and must still read. */
    it("reads a record written before saves carried a story", () => {
        expect(readSaveCompatibilityStamp({ protocol: 1, storyHash: "a", gameVersion: "1.0.0" })).toEqual({
            protocol: 1,
            storyId: "",
            storyHash: "a",
            gameVersion: "1.0.0",
        });
    });

    it("stamps a blank story hash rather than refusing to build one", () => {
        expect(buildSaveCompatibilityStamp({})).toEqual({
            protocol: SAVE_PROTOCOL_VERSION,
            storyId: "",
            storyHash: "",
            gameVersion: "",
        });
        expect(buildSaveBuildStamp({})).toEqual({
            protocol: SAVE_PROTOCOL_VERSION,
            storyHashes: {},
            gameVersion: "",
        });
    });
});

describe("normalizeSaveCompatibilityConfiguration", () => {
    it("falls back per field, and the two halves do not take the same fallback", () => {
        expect(normalizeSaveCompatibilityConfiguration(undefined)).toEqual(DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION);
        // Same story is not a risk, so it resumes. A different story is, so the player is put back
        // where the save stopped rather than dropped into a position that may have moved.
        expect(DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION).toEqual({ compatible: "resume", incompatible: "resumeScene" });
        expect(normalizeSaveCompatibilityConfiguration({ compatible: "discard", incompatible: "nonsense" }))
            .toEqual({ compatible: "discard", incompatible: "resumeScene" });
    });
});

describe("planSaveResume", () => {
    const policy = { compatible: "discard", incompatible: "resumeScene" } as const;

    it("leaves an unstamped save loading exactly as it always did", () => {
        expect(planSaveResume(null, build(), policy)).toEqual({
            compatibility: "unknown",
            plan: { action: "resume" },
        });
    });

    it("never lets the policy speak for a record it cannot read", () => {
        expect(planSaveResume(stamp({ protocol: 99 }), build(), { compatible: "resume", incompatible: "force" }))
            .toEqual({ compatibility: "unsupported", plan: { action: "discard", reason: "protocol" } });
    });

    it("applies the author's answer per case", () => {
        expect(planSaveResume(stamp({ gameVersion: "0.9.0" }), build(), policy).plan)
            .toEqual({ action: "discard", reason: "policy" });
        expect(planSaveResume(stamp({ storyHash: "hash-prologue-v1" }), build(), policy).plan)
            .toEqual({ action: "relaunch" });
        expect(planSaveResume(stamp({ storyHash: "hash-prologue-v1" }), build(), {
            compatible: "resume",
            incompatible: "force",
        }).plan).toEqual({ action: "resume" });
    });

    it("says nothing about how precisely a relaunch can land", () => {
        // That is a question about whether the row is still in the story, which nothing here can
        // see. The host answers it at the moment of the relaunch; see `SaveRelaunchLanding`.
        expect(planSaveResume(stamp({ storyHash: "hash-prologue-v1" }), build(), policy).plan)
            .toEqual({ action: "relaunch" });
        // A same-story save never reaches the incompatible half whatever it is set to.
        expect(planSaveResume(stamp({ gameVersion: "2.0.0" }), build(), {
            compatible: "resume",
            incompatible: "resumeScene",
        }).plan).toEqual({ action: "resume" });
    });

    it("identical saves are never touched by either setting", () => {
        expect(planSaveResume(stamp(), build(), { compatible: "discard", incompatible: "discard" }).plan)
            .toEqual({ action: "resume" });
    });
});
