import { describe, expect, it } from "vitest";
import {
    resolveStoryGroupRunMode,
    storyGroupKindOfMode,
    storyGroupRunModeFor,
    storyGroupWaits,
} from "./groupRun";

/**
 * A group row's `control` and `mode` both describe how its rows run, and the game follows `mode`.
 * The editor reads a group through these, so what it shows is what plays.
 */
describe("story group runs", () => {
    it("follows the stored mode, and the control word only when there is none", () => {
        expect(resolveStoryGroupRunMode({ control: "sequence" })).toBe("do");
        expect(resolveStoryGroupRunMode({ control: "parallel" })).toBe("all");
        expect(resolveStoryGroupRunMode({ control: "race" })).toBe("any");
        // Written by the old inspector, which offered the two as separate questions.
        expect(resolveStoryGroupRunMode({ control: "sequence", mode: "all" })).toBe("all");
        expect(resolveStoryGroupRunMode({ control: "parallel", mode: "do" })).toBe("do");
    });

    it("names the kind of group a run is, and whether the story waits for it", () => {
        expect(["do", "doAsync", "all", "allAsync", "any"].map(mode => [
            storyGroupKindOfMode(mode as never),
            storyGroupWaits(mode as never),
        ])).toEqual([
            ["sequence", true],
            ["sequence", false],
            ["parallel", true],
            ["parallel", false],
            ["race", true],
        ]);
    });

    it("builds the run back from the kind and the wait, a race always waiting for its first row", () => {
        for (const mode of ["do", "doAsync", "all", "allAsync", "any"] as const) {
            expect(storyGroupRunModeFor(storyGroupKindOfMode(mode), storyGroupWaits(mode))).toBe(mode);
        }
        expect(storyGroupRunModeFor("race", false)).toBe("any");
    });
});
