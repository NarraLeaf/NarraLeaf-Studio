import { describe, expect, it } from "vitest";
import {
    getPageAnimationDurationMs,
    resolvePageAnimationMotion,
    scalePageMotionDistances,
    shouldBlockPageAnimationExit,
} from "./pageAnimation";

function transitionDuration(target: { transition?: unknown }): number | undefined {
    const transition = target.transition;
    return transition && typeof transition === "object" && "duration" in transition
        ? Number((transition as { duration: unknown }).duration)
        : undefined;
}

describe("page animation runtime resolver", () => {
    it("maps presets to Motion keyframes with separate phase durations", () => {
        const motion = resolvePageAnimationMotion({
            settings: {
                enter: "slide",
                exit: "fade",
                enterDirection: "right",
                exitDirection: "left",
                enterAngleDegrees: 0,
                exitAngleDegrees: 180,
                enterDurationSeconds: 0.35,
                exitDurationSeconds: 0.75,
                exitBlocking: true,
            },
        });

        expect(motion.initial).toMatchObject({ opacity: 0, x: 48, y: 0 });
        expect(motion.animate).toMatchObject({ opacity: 1, x: 0, y: 0, scale: 1 });
        expect(motion.exit).toMatchObject({ opacity: 0 });
        expect(transitionDuration(motion.animate)).toBe(0.35);
        expect(transitionDuration(motion.exit)).toBe(0.75);
        expect(motion.enterDurationMs).toBe(350);
        expect(motion.exitDurationMs).toBe(750);
        expect(motion.exitBlocking).toBe(true);
        expect(shouldBlockPageAnimationExit({
            enter: "slide",
            exit: "fade",
            enterDirection: "right",
            exitDirection: "left",
            enterAngleDegrees: 0,
            exitAngleDegrees: 180,
            enterDurationSeconds: 0.35,
            exitDurationSeconds: 0.75,
            exitBlocking: true,
        })).toBe(true);
    });

    it("uses phase-aware auto direction based on navigation direction", () => {
        const forward = resolvePageAnimationMotion({
            settings: {
                enter: "slide",
                exit: "push",
                enterDirection: "auto",
                exitDirection: "auto",
                enterAngleDegrees: 0,
                exitAngleDegrees: 180,
                enterDurationSeconds: 0.16,
                exitDurationSeconds: 0.16,
                exitBlocking: false,
            },
            navigationDirection: "forward",
        });
        const back = resolvePageAnimationMotion({
            settings: {
                enter: "slide",
                exit: "push",
                enterDirection: "auto",
                exitDirection: "auto",
                enterAngleDegrees: 0,
                exitAngleDegrees: 180,
                enterDurationSeconds: 0.16,
                exitDurationSeconds: 0.16,
                exitBlocking: false,
            },
            navigationDirection: "back",
        });

        expect(forward.initial.x).toBe(48);
        expect(forward.exit.x).toBe(-48);
        expect(back.initial.x).toBe(-48);
        expect(back.exit.x).toBe(48);
    });

    it("resolves custom angle directions per phase", () => {
        const motion = resolvePageAnimationMotion({
            settings: {
                enter: "slide",
                exit: "slide",
                enterDirection: "angle",
                exitDirection: "angle",
                enterAngleDegrees: 90,
                exitAngleDegrees: 180,
                enterDurationSeconds: 0.2,
                exitDurationSeconds: 0.2,
                exitBlocking: false,
            },
        });

        expect(Math.round(Number(motion.initial.x))).toBe(0);
        expect(Math.round(Number(motion.initial.y))).toBe(48);
        expect(Math.round(Number(motion.exit.x))).toBe(-48);
        expect(Math.round(Number(motion.exit.y))).toBe(0);
    });

    it("zeros a phase duration when its preset is none", () => {
        const motion = resolvePageAnimationMotion({
            settings: {
                enter: "none",
                exit: "fade",
                enterDirection: "auto",
                exitDirection: "auto",
                enterAngleDegrees: 0,
                exitAngleDegrees: 180,
                enterDurationSeconds: 1.2,
                exitDurationSeconds: 0.4,
                exitBlocking: false,
            },
        });

        expect(motion.enterDurationMs).toBe(0);
        expect(motion.exitDurationMs).toBe(400);
        expect(transitionDuration(motion.animate)).toBe(0);
        expect(transitionDuration(motion.exit)).toBe(0.4);
        expect(getPageAnimationDurationMs({
            enter: "none",
            exit: "fade",
            enterDirection: "auto",
            exitDirection: "auto",
            enterAngleDegrees: 0,
            exitAngleDegrees: 180,
            enterDurationSeconds: 1.2,
            exitDurationSeconds: 0.4,
            exitBlocking: false,
        }, "enter")).toBe(0);
    });

    it("zeros motion when reduce motion is active", () => {
        const motion = resolvePageAnimationMotion({
            settings: {
                enter: "blur",
                exit: "zoom",
                enterDirection: "down",
                exitDirection: "up",
                enterAngleDegrees: 0,
                exitAngleDegrees: 180,
                enterDurationSeconds: 0.42,
                exitDurationSeconds: 0.8,
                exitBlocking: true,
            },
            reducedMotion: true,
        });

        expect(motion.initial).toMatchObject({ opacity: 1, x: 0, y: 0, scale: 1 });
        expect(motion.animate).toMatchObject(motion.initial);
        expect(motion.exit).toMatchObject(motion.initial);
        expect(transitionDuration(motion.animate)).toBe(0);
        expect(transitionDuration(motion.exit)).toBe(0);
        expect(getPageAnimationDurationMs({
            enter: "fade",
            exit: "fade",
            enterDirection: "auto",
            exitDirection: "auto",
            enterAngleDegrees: 0,
            exitAngleDegrees: 180,
            enterDurationSeconds: 0.42,
            exitDurationSeconds: 0.42,
            exitBlocking: true,
        }, "enter", true)).toBe(0);
        expect(motion.exitBlocking).toBe(false);
    });

    it("scales numeric travel distances into backing px for out-of-tree layers", () => {
        const motion = resolvePageAnimationMotion({
            settings: {
                enter: "slide",
                exit: "slide",
                enterDirection: "right",
                exitDirection: "left",
                enterAngleDegrees: 0,
                exitAngleDegrees: 180,
                enterDurationSeconds: 0.3,
                exitDurationSeconds: 0.3,
                exitBlocking: false,
            },
        });

        // Distances are authored in design px (48); a layer rendered outside the
        // design→backing transform multiplies by the render scale.
        const scaledInitial = scalePageMotionDistances(motion.initial, 0.5);
        expect(scaledInitial).toMatchObject({ opacity: 0, x: 24, y: 0 });
        const scaledExit = scalePageMotionDistances(motion.exit, 2);
        expect(scaledExit).toMatchObject({ x: -96, y: 0 });
        // Non-positional channels are untouched, and scale 1 is the identity.
        expect(scaledInitial.scale).toBe(motion.initial.scale);
        expect(scalePageMotionDistances(motion.initial, 1)).toBe(motion.initial);
    });
});
