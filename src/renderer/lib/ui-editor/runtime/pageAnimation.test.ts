import { describe, expect, it } from "vitest";
import { getPageAnimationDurationMs, resolvePageAnimationMotion } from "./pageAnimation";

describe("page animation runtime resolver", () => {
    it("maps presets to Motion keyframes", () => {
        const motion = resolvePageAnimationMotion({
            settings: { enter: "slide", exit: "fade", direction: "right", speed: "normal" },
        });

        expect(motion.initial).toMatchObject({ opacity: 0, x: 48, y: 0 });
        expect(motion.animate).toMatchObject({ opacity: 1, x: 0, y: 0, scale: 1 });
        expect(motion.exit).toMatchObject({ opacity: 0 });
        expect(motion.transition.duration).toBe(0.26);
    });

    it("uses auto direction based on navigation direction", () => {
        const forward = resolvePageAnimationMotion({
            settings: { enter: "slide", exit: "push", direction: "auto", speed: "fast" },
            navigationDirection: "forward",
        });
        const back = resolvePageAnimationMotion({
            settings: { enter: "slide", exit: "push", direction: "auto", speed: "fast" },
            navigationDirection: "back",
        });

        expect(forward.initial.x).toBe(48);
        expect(forward.exit.x).toBe(-48);
        expect(back.initial.x).toBe(-48);
        expect(back.exit.x).toBe(48);
    });

    it("zeros motion when reduce motion is active", () => {
        const motion = resolvePageAnimationMotion({
            settings: { enter: "blur", exit: "zoom", direction: "down", speed: "slow" },
            reducedMotion: true,
        });

        expect(motion.initial).toEqual(motion.animate);
        expect(motion.exit).toEqual(motion.animate);
        expect(motion.transition.duration).toBe(0);
        expect(getPageAnimationDurationMs({ enter: "fade", exit: "fade", direction: "auto", speed: "slow" }, "enter", true)).toBe(0);
    });
});
