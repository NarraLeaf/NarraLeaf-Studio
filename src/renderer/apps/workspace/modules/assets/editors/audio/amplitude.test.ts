import { describe, expect, it } from "vitest";
import { amplitudeLabel, MAX_AMPLITUDE, stepAmplitude } from "./amplitude";

describe("stepAmplitude", () => {
    it("magnifies on wheel up and shrinks on wheel down", () => {
        expect(stepAmplitude(1, -100)).toBeCloseTo(1.25, 6);
        expect(stepAmplitude(2, 100)).toBeCloseTo(1.6, 6);
    });

    it("never goes below true size, and lands on it exactly", () => {
        expect(stepAmplitude(1, 100)).toBe(1);
        expect(stepAmplitude(1.25, 100)).toBe(1);
    });

    it("stops at the ceiling", () => {
        let amplitude = 1;
        for (let notch = 0; notch < 100; notch++) {
            amplitude = stepAmplitude(amplitude, -100);
        }
        expect(amplitude).toBe(MAX_AMPLITUDE);
    });

    it("ignores a notch with no vertical travel", () => {
        expect(stepAmplitude(3, 0)).toBe(3);
    });
});

describe("amplitudeLabel", () => {
    it("says nothing at true size", () => {
        expect(amplitudeLabel(1)).toBeNull();
        expect(amplitudeLabel(4)).toBe("×4.0");
    });
});
