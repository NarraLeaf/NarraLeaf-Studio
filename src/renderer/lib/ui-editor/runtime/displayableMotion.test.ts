import { describe, expect, it } from "vitest";
import {
    buildDisplayableMotionAnimateTarget,
    buildDisplayableMotionInitialTarget,
    displayableMotionFromCurrent,
    toDisplayableMotionTransition,
} from "./displayableMotion";

const fallback = {
    x: 0,
    y: 0,
    scale: 1,
    rotate: 12,
    opacity: 0.5,
};

describe("displayable Motion props", () => {
    it("only sends explicitly animated properties to Motion", () => {
        expect(buildDisplayableMotionAnimateTarget({ x: [-500, 0] }, fallback)).toEqual({ x: [-500, 0] });
        expect(buildDisplayableMotionInitialTarget({ x: [-500, 0] }, fallback)).toEqual({ x: -500 });
        expect(buildDisplayableMotionAnimateTarget({ opacity: [0, 1] }, fallback)).toEqual({ opacity: [0, 1] });
        expect(buildDisplayableMotionInitialTarget({ opacity: [0, 1] }, fallback)).toEqual({ opacity: 0 });
    });

    it("lets Motion continue from the current value without injecting an initial target", () => {
        const fromCurrent = displayableMotionFromCurrent(1);

        expect(buildDisplayableMotionAnimateTarget({ opacity: fromCurrent }, fallback)).toEqual({ opacity: 1 });
        expect(buildDisplayableMotionInitialTarget({ opacity: fromCurrent }, fallback)).toBe(false);
    });

    it("normalizes blueprint tween timing for Motion", () => {
        expect(
            toDisplayableMotionTransition({
                type: "tween",
                durationMs: 250,
                delayMs: 50,
                easing: "easeOut",
            }),
        ).toEqual({
            type: "tween",
            duration: 0.25,
            delay: 0.05,
            ease: "easeOut",
        });
    });
});
