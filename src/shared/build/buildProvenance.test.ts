import { describe, expect, it } from "vitest";
import { checkPatchEngine, describeBuildProvenance, describePatchEngineCheck } from "./buildProvenance";

describe("what a finished run says it came from", () => {
    it("names the Studio, the engine and the revision", () => {
        expect(describeBuildProvenance({
            runtimeVersion: "0.9.2",
            engineVersion: "0.44.0",
            projectRevision: { id: "9f2c1b7ae4d0118c", number: 12 },
        })).toBe("built with Studio 0.9.2, engine 0.44.0; project revision #12 (9f2c1b7ae4d0)");
    });

    it("says outright that there is no revision rather than leaving the clause out", () => {
        // The silence is the defect being fixed: an author told nothing assumes it was recorded
        // somewhere. A line that simply ends after the versions reads as exactly that silence.
        const line = describeBuildProvenance({ runtimeVersion: "0.9.2", engineVersion: "0.44.0" });
        expect(line).toContain("no project revision");
        expect(line).toContain("not under version control");
    });

    it("leaves the engine out when the pack does not state one, and still names the rest", () => {
        expect(describeBuildProvenance({
            runtimeVersion: "0.9.2",
            projectRevision: { id: "9f2c1b7ae4d0118c", number: 12 },
        })).toBe("built with Studio 0.9.2; project revision #12 (9f2c1b7ae4d0)");
    });
});

describe("patch engine check", () => {
    it("reports a match when both packs name the same engine", () => {
        expect(checkPatchEngine({ engineVersion: "0.44.0" }, { engineVersion: "0.44.0" }))
            .toEqual({ outcome: "match", version: "0.44.0" });
    });

    it("reports the two versions when they differ, keeping which one the player is left running", () => {
        // The installed build's engine is the one that survives, because a patch replaces content
        // and not code - so the two versions are not interchangeable in the message.
        expect(checkPatchEngine({ engineVersion: "0.43.1" }, { engineVersion: "0.44.0" }))
            .toEqual({ outcome: "changed", installed: "0.43.1", patch: "0.44.0" });
    });

    it("reports a build that does not state its engine as unchecked, not as a match", () => {
        // Every build made before packs carried the field is in this shape, and it is the ordinary
        // case for a while yet: reading it as agreement would tell the author a comparison ran.
        expect(checkPatchEngine({}, { engineVersion: "0.44.0" }))
            .toEqual({ outcome: "unchecked", reason: "installed-silent" });
    });

    it("blames the runtime build when it is the patch side that says nothing", () => {
        // A stale dist/runtime, which is about this Studio rather than about the author's project -
        // so the author must not be sent looking at the build they are patching.
        expect(checkPatchEngine({ engineVersion: "0.43.1" }, {}))
            .toEqual({ outcome: "unchecked", reason: "patch-silent" });
        // And it wins over the installed side being silent too, for the same reason.
        expect(checkPatchEngine({}, {})).toEqual({ outcome: "unchecked", reason: "patch-silent" });
    });

    it("treats a blank version as no version at all", () => {
        expect(checkPatchEngine({ engineVersion: "   " }, { engineVersion: "0.44.0" }))
            .toEqual({ outcome: "unchecked", reason: "installed-silent" });
    });

    it("warns rather than staying quiet when the engine changed, and names both versions", () => {
        const described = describePatchEngineCheck(
            checkPatchEngine({ engineVersion: "0.43.1" }, { engineVersion: "0.44.0" }),
        );
        expect(described.level).toBe("warning");
        expect(described.message).toContain("0.43.1");
        expect(described.message).toContain("0.44.0");
    });

    it("keeps a match at info, so a clean check is not read as a problem", () => {
        expect(describePatchEngineCheck({ outcome: "match", version: "0.44.0" }).level).toBe("info");
    });

    it("warns when nothing could be compared, because silence would read as agreement", () => {
        expect(describePatchEngineCheck({ outcome: "unchecked", reason: "installed-silent" }).level)
            .toBe("warning");
        expect(describePatchEngineCheck({ outcome: "unchecked", reason: "patch-silent" }).level)
            .toBe("warning");
    });
});
