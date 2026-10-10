import { describe, expect, it } from "vitest";
import { RELOAD_PHASE_MIN_MS, reloadPhaseHoldMs } from "./reloadPhaseDwell";

describe("reloadPhaseHoldMs", () => {
    it("holds a quick reload that ended running for the rest of the minimum", () => {
        expect(reloadPhaseHoldMs("running", 1000, 1040)).toBe(RELOAD_PHASE_MIN_MS - 40);
    });

    it("does not hold a reload that already took longer than the minimum", () => {
        expect(reloadPhaseHoldMs("running", 1000, 1000 + RELOAD_PHASE_MIN_MS + 1)).toBe(0);
    });

    it("does not hold a reload that failed or was stopped", () => {
        expect(reloadPhaseHoldMs("error", 1000, 1010)).toBe(0);
        expect(reloadPhaseHoldMs("stopping", 1000, 1010)).toBe(0);
        expect(reloadPhaseHoldMs("idle", 1000, 1010)).toBe(0);
    });

    it("does not hold anything that was not a reload", () => {
        expect(reloadPhaseHoldMs("running", null, 1010)).toBe(0);
    });
});
