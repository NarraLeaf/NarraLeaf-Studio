import { describe, expect, it } from "vitest";
import {
    DEFAULT_SAVE_COMPATIBILITY_CONFIGURATION,
    SAVE_PROTOCOL_VERSION,
    buildSaveCompatibilityStamp,
    classifySaveCompatibility,
    normalizeSaveCompatibilityConfiguration,
    planSaveResume,
    readSaveCompatibilityStamp,
    type SaveCompatibilityStamp,
} from "./saveCompatibility";

function stamp(overrides: Partial<SaveCompatibilityStamp> = {}): SaveCompatibilityStamp {
    return { protocol: SAVE_PROTOCOL_VERSION, storyHash: "story-a", gameVersion: "1.0.0", ...overrides };
}

describe("classifySaveCompatibility", () => {
    it("separates the three axes", () => {
        expect(classifySaveCompatibility(stamp(), stamp())).toBe("identical");
        expect(classifySaveCompatibility(stamp(), stamp({ gameVersion: "1.1.0" }))).toBe("compatible");
        expect(classifySaveCompatibility(stamp(), stamp({ storyHash: "story-b" }))).toBe("incompatible");
        // The protocol outranks the other two: nothing can be read out of the record to compare.
        expect(classifySaveCompatibility(
            stamp({ protocol: 99, storyHash: "story-b", gameVersion: "2.0.0" }),
            stamp(),
        )).toBe("unsupported");
    });

    it("reports what it cannot compare as unknown rather than as a difference", () => {
        expect(classifySaveCompatibility(null, stamp())).toBe("unknown");
        expect(classifySaveCompatibility(stamp(), null)).toBe("unknown");
        // A bundle that could not be hashed would otherwise report every save as another story.
        expect(classifySaveCompatibility(stamp({ storyHash: "" }), stamp())).toBe("unknown");
        expect(classifySaveCompatibility(stamp(), stamp({ storyHash: "" }))).toBe("unknown");
    });

    it("treats two builds that carry no version as one version", () => {
        expect(classifySaveCompatibility(stamp({ gameVersion: "" }), stamp({ gameVersion: "" }))).toBe("identical");
        expect(classifySaveCompatibility(stamp({ gameVersion: "" }), stamp({ gameVersion: "1.0.0" }))).toBe("compatible");
    });
});

describe("readSaveCompatibilityStamp", () => {
    it("accepts a complete stamp and nothing else", () => {
        expect(readSaveCompatibilityStamp(stamp())).toEqual(stamp());
        expect(readSaveCompatibilityStamp(undefined)).toBeNull();
        expect(readSaveCompatibilityStamp({ protocol: 1, storyHash: "a" })).toBeNull();
        expect(readSaveCompatibilityStamp({ protocol: "1", storyHash: "a", gameVersion: "b" })).toBeNull();
    });

    it("stamps a blank story hash rather than refusing to build one", () => {
        expect(buildSaveCompatibilityStamp({})).toEqual({
            protocol: SAVE_PROTOCOL_VERSION,
            storyHash: "",
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
        expect(planSaveResume(null, stamp(), policy)).toEqual({
            compatibility: "unknown",
            plan: { action: "resume" },
        });
    });

    it("never lets the policy speak for a record it cannot read", () => {
        expect(planSaveResume(stamp({ protocol: 99 }), stamp(), { compatible: "resume", incompatible: "force" }))
            .toEqual({ compatibility: "unsupported", plan: { action: "discard", reason: "protocol" } });
    });

    it("applies the author's answer per case", () => {
        expect(planSaveResume(stamp({ gameVersion: "0.9.0" }), stamp(), policy).plan)
            .toEqual({ action: "discard", reason: "policy" });
        expect(planSaveResume(stamp({ storyHash: "story-b" }), stamp(), policy).plan)
            .toEqual({ action: "relaunch", precision: "scene" });
        expect(planSaveResume(stamp({ storyHash: "story-b" }), stamp(), {
            compatible: "resume",
            incompatible: "force",
        }).plan).toEqual({ action: "resume" });
    });

    it("keeps a same-story relaunch row-precise", () => {
        // Not reachable from the built-in classification - a same-story save never lands in the
        // incompatible branch - but the option has to be defined however it is reached.
        expect(planSaveResume(stamp(), stamp(), policy, ).plan).toEqual({ action: "resume" });
        expect(planSaveResume(stamp({ gameVersion: "2.0.0" }), stamp(), {
            compatible: "resume",
            incompatible: "resumeScene",
        }).plan).toEqual({ action: "resume" });
    });

    it("identical saves are never touched by either setting", () => {
        expect(planSaveResume(stamp(), stamp(), { compatible: "discard", incompatible: "discard" }).plan)
            .toEqual({ action: "resume" });
    });
});
