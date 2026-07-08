import { describe, expect, it } from "vitest";
import { Blinds, BlindsBlackout, Slide, SoftWipe } from "./customImageTransitions";

// The resolver entries produced by asPrev/asTarget are wrapped as
// `{ resolver, key }`; a bare resolver (the blackout's black slat layer) is a
// plain function. Unwrap to the callable form for inspection.
type ResolverEntry = ((...args: number[]) => any) | { resolver: (...args: number[]) => any; key: string };
function call(entry: ResolverEntry, t: number): any {
    const fn = typeof entry === "function" ? entry : entry.resolver;
    return fn(t);
}
function keyOf(entry: ResolverEntry): string | undefined {
    return typeof entry === "function" ? undefined : entry.key;
}

// The wrapped asPrev/asTarget resolvers merge the transition's prev/target src
// into their output and throw if none is set, so give both a Color src (which
// NLR accepts) before invoking them. This does not affect the mask/transform
// styles we assert on.
function prepared<T>(inst: T): T {
    (inst as any)._setPrevSrc("#000000");
    (inst as any)._setTargetSrc("#000000");
    return inst;
}

describe("custom image transitions", () => {
    it("SoftWipe: one 0→1 channel, prev current + target feathered mask", () => {
        const task = prepared(new SoftWipe(400, "right", 15)).createTask() as any;
        expect(task.animations).toHaveLength(1);
        expect(task.animations[0]).toMatchObject({ start: 0, end: 1, duration: 400 });
        expect(task.resolve).toHaveLength(2);
        expect(keyOf(task.resolve[0])).toBe("current");
        expect(keyOf(task.resolve[1])).toBe("target");
        // A feathered (soft) edge = a linear-gradient mask with a non-zero band.
        const mask = call(task.resolve[1], 0.5).style.maskImage as string;
        expect(mask).toContain("linear-gradient(to right");
        expect(mask).not.toContain("inset("); // not the hard clip-path wipe
    });

    it("SoftWipe: fully hidden at t=0 and fully revealed at t=1", () => {
        const target = prepared(new SoftWipe(400, "right", 12)).createTask().resolve[1] as ResolverEntry;
        // At t=1 the opaque (#000) stop reaches 100% → target fully visible.
        expect(call(target, 1).style.maskImage).toContain("#000 100%");
        // At t=0 the opaque stop is behind the start (negative %) → target hidden.
        expect(call(target, 0).style.maskImage).toContain("#000 -12%");
    });

    it("Blinds: target revealed through repeating slats that widen to full pitch", () => {
        const task = prepared(new Blinds(400, "horizontal", 8)).createTask() as any;
        expect(task.resolve).toHaveLength(2);
        const axisAtHalf = call(task.resolve[1], 0.5).style.maskImage as string;
        expect(axisAtHalf).toContain("repeating-linear-gradient(to bottom");
        // pitch = 100/8 = 12.5; at t=1 a slat is fully painted (cover === pitch).
        expect(call(task.resolve[1], 1).style.maskImage).toContain("#000 12.5%");
        // vertical orientation flips the gradient axis.
        expect(call(prepared(new Blinds(400, "vertical", 8)).createTask().resolve[1] as ResolverEntry, 0.5).style.maskImage)
            .toContain("repeating-linear-gradient(to right");
    });

    it("BlindsBlackout: adds a black slat layer, holds full black at the midpoint", () => {
        const task = prepared(new BlindsBlackout(600, "horizontal", 10, 0.4)).createTask() as any;
        expect(task.resolve).toHaveLength(3);
        expect(keyOf(task.resolve[0])).toBe("current");
        expect(keyOf(task.resolve[1])).toBe("target");
        expect(keyOf(task.resolve[2])).toBeUndefined(); // the extra black layer

        const black = task.resolve[2] as ResolverEntry;
        const mid = call(black, 0.5);
        expect(mid.style.backgroundColor).toBe("#000");
        expect(mid.src).toBeTruthy(); // a real (transparent) src so the layer mounts
        // pitch = 100/10 = 10; at the fully-black hold, cover === pitch (all black).
        expect(mid.style.maskImage).toContain("#000 10%");
        // At the very start/end the black layer is fully open (cover 0 → invisible).
        expect(call(black, 0).style.maskImage).toContain("#000 0%");
        expect(call(black, 1).style.maskImage).toContain("#000 0%");
    });

    it("BlindsBlackout: outgoing/incoming images swap under the black at the midpoint", () => {
        const task = prepared(new BlindsBlackout(600, "horizontal", 10, 0.4)).createTask() as any;
        // Outgoing (prev) visible before mid, gone after.
        expect(call(task.resolve[0], 0.2).style.opacity).toBe(1);
        expect(call(task.resolve[0], 0.8).style.opacity).toBe(0);
        // Incoming (target) hidden before mid, shown after.
        expect(call(task.resolve[1], 0.2).style.opacity).toBe(0);
        expect(call(task.resolve[1], 0.8).style.opacity).toBe(1);
    });

    it("Slide: outgoing and incoming translate in opposite directions, centring preserved", () => {
        const task = prepared(new Slide(400, "left")).createTask() as any;
        expect(task.resolve).toHaveLength(2);
        // Incoming starts a full viewport to the right of centre and ends centred.
        expect(call(task.resolve[1], 0).style.transform).toBe("translate(calc(-50% + 100vw), -50%)");
        expect(call(task.resolve[1], 1).style.transform).toBe("translate(calc(-50% + 0vw), -50%)");
        // Outgoing ends a full viewport to the left.
        expect(call(task.resolve[0], 1).style.transform).toBe("translate(calc(-50% + -100vw), -50%)");
        // Vertical direction uses vh on the Y axis.
        expect(call(prepared(new Slide(400, "bottom")).createTask().resolve[1] as ResolverEntry, 0).style.transform)
            .toBe("translate(-50%, calc(-50% + -100vh))");
    });

    it("copy() returns an equivalent independent instance", () => {
        const original = new BlindsBlackout(600, "vertical", 6, 0.25);
        const clone = original.copy();
        expect(clone).not.toBe(original);
        expect(clone).toBeInstanceOf(BlindsBlackout);
        // Same configuration → structurally identical black-layer output.
        const blackAtMid = (inst: BlindsBlackout) => call(inst.createTask().resolve[2] as ResolverEntry, 0.5).style;
        expect(blackAtMid(clone)).toEqual(blackAtMid(original));
    });
});
