import { describe, expect, it } from "vitest";
import {
    EXPERIMENTAL_CONDITIONS,
    EXPERIMENTAL_CONDITION_FLAG_PREFIX,
    EXPERIMENTAL_CONDITION_IDS,
    experimentalCondition,
    hasExperimentalCondition,
    isExperimentalConditionId,
    type ExperimentalState,
} from "./experimental";

describe("the experimental condition registry", () => {
    it("describes every id, in the order every surface lists them", () => {
        // The registry is what the log banner, the workspace notice and the build console all read.
        // An id with no descriptor throws where it is looked up, which is inside a launch.
        expect(EXPERIMENTAL_CONDITIONS.map(condition => condition.id)).toEqual([...EXPERIMENTAL_CONDITION_IDS]);
    });

    it("precomputes each flag from the one prefix, so nothing spells one by hand", () => {
        for (const condition of EXPERIMENTAL_CONDITIONS) {
            expect(condition.flag).toBe(`${EXPERIMENTAL_CONDITION_FLAG_PREFIX}${condition.id}`);
            expect(isExperimentalConditionId(condition.id)).toBe(true);
        }
    });

    it("says what each condition does, because the notice shows this line and nothing else", () => {
        for (const condition of EXPERIMENTAL_CONDITIONS) {
            expect(condition.summary.length).toBeGreaterThan(20);
            expect(experimentalCondition(condition.id)).toBe(condition);
        }
    });
});

describe("hasExperimentalCondition", () => {
    const armed = (conditions: ExperimentalState["conditions"], enabled: boolean): ExperimentalState => ({
        enabled,
        conditions,
        unknownConditionFlags: [],
    });

    it("holds only when the mode itself was opened", () => {
        // Two switches on purpose: a condition flag parsed without `--experimental` must do nothing,
        // so that no single mistyped argument reaches any of this.
        expect(hasExperimentalCondition(armed(["live-session-freeze"], true), "live-session-freeze")).toBe(true);
        expect(hasExperimentalCondition(armed(["live-session-freeze"], false), "live-session-freeze")).toBe(false);
    });

    it("does not confuse one condition for another, or answer for no state at all", () => {
        expect(hasExperimentalCondition(armed(["debuggable-build"], true), "live-session-freeze")).toBe(false);
        expect(hasExperimentalCondition(null, "live-session-freeze")).toBe(false);
        expect(hasExperimentalCondition(undefined, "debuggable-build")).toBe(false);
    });
});
