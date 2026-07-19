import { describe, expect, it } from "vitest";
import { Blinds, BlurDissolve, Slide, SoftIris, SoftWipe, ThroughColor } from "./customImageTransitions";

// The resolver entries produced by asPrev/asTarget are wrapped as
// `{ resolver, key }`; a bare resolver (e.g. the through-colour overlay layer)
// is a plain function. Unwrap to the callable form for inspection.
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
// NLR accepts) before invoking them. This does not affect the mask/filter
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

    it("SoftIris: target revealed through an expanding feathered radial mask", () => {
        const task = prepared(new SoftIris(400, "50% 50%", 12)).createTask() as any;
        expect(task.resolve).toHaveLength(2);
        expect(keyOf(task.resolve[0])).toBe("current");
        const mask = call(task.resolve[1], 0.5).style.maskImage as string;
        expect(mask).toContain("radial-gradient(circle at 50% 50%");
        // At t=1 the opaque disc has grown to cover (r = 150) → target fully shown.
        expect(call(task.resolve[1], 1).style.maskImage).toContain("#000 138%");
    });

    it("BlurDissolve: crossfades opacity while blurring out/in", () => {
        const task = prepared(new BlurDissolve(400, 16)).createTask() as any;
        expect(task.resolve).toHaveLength(2);
        // Outgoing: sharp+opaque at start, blurred+gone at end.
        expect(call(task.resolve[0], 0).style).toMatchObject({ opacity: 1, filter: "blur(0px)" });
        expect(call(task.resolve[0], 1).style).toMatchObject({ opacity: 0, filter: "blur(16px)" });
        // Incoming: blurred+gone at start, sharp+opaque at end.
        expect(call(task.resolve[1], 0).style).toMatchObject({ opacity: 0, filter: "blur(16px)" });
        expect(call(task.resolve[1], 1).style).toMatchObject({ opacity: 1, filter: "blur(0px)" });
    });

    describe("ThroughColor", () => {
        it("adds a colour overlay layer; plain pattern fades it fully in at the hold", () => {
            const task = prepared(new ThroughColor(600, "plain", "#000000", 0.4)).createTask() as any;
            expect(task.resolve).toHaveLength(3);
            expect(keyOf(task.resolve[0])).toBe("current");
            expect(keyOf(task.resolve[1])).toBe("target");
            expect(keyOf(task.resolve[2])).toBeUndefined(); // the overlay layer

            const overlay = task.resolve[2] as ResolverEntry;
            const mid = call(overlay, 0.5);
            expect(mid.src).toBeTruthy(); // a real (transparent) src so the layer mounts
            expect(mid.style.backgroundColor).toBe("#000000");
            expect(mid.style.opacity).toBe(1); // fully covered at the hold
            expect(mid.style.maskImage).toBeUndefined(); // plain = no mask, just opacity
            // Fully clear (invisible) at both ends.
            expect(call(overlay, 0).style.opacity).toBe(0);
            expect(call(overlay, 1).style.opacity).toBe(0);
        });

        it("outgoing/incoming images swap under the colour at the midpoint", () => {
            const task = prepared(new ThroughColor(600, "plain", "#000000", 0.4)).createTask() as any;
            expect(call(task.resolve[0], 0.2).style.opacity).toBe(1);
            expect(call(task.resolve[0], 0.8).style.opacity).toBe(0);
            expect(call(task.resolve[1], 0.2).style.opacity).toBe(0);
            expect(call(task.resolve[1], 0.8).style.opacity).toBe(1);
        });

        it("honours the hold colour and masks by pattern", () => {
            // Fade through white.
            const white = prepared(new ThroughColor(600, "plain", "#ffffff", 0.4)).createTask().resolve[2] as ResolverEntry;
            expect(call(white, 0.5).style.backgroundColor).toBe("#ffffff");

            // Soft wipe through black → a feathered linear overlay mask.
            const linear = prepared(new ThroughColor(600, "linear", "#000000", 0.3, { direction: "right", feather: 15 })).createTask().resolve[2] as ResolverEntry;
            expect(call(linear, 0.5).style.maskImage).toContain("linear-gradient(to right");

            // Iris to black → a radial overlay mask.
            const iris = prepared(new ThroughColor(600, "iris", "#000000", 0.3, { center: "50% 50%" })).createTask().resolve[2] as ResolverEntry;
            expect(call(iris, 0.5).style.maskImage).toContain("radial-gradient(circle at 50% 50%");

            // Blinds black hold → a repeating overlay mask.
            const blinds = prepared(new ThroughColor(600, "blinds", "#000000", 0.3, { orientation: "vertical", slats: 6 })).createTask().resolve[2] as ResolverEntry;
            expect(call(blinds, 0.5).style.maskImage).toContain("repeating-linear-gradient(to right");
        });
    });

    it("Slide: uses the independent `translate` property in self-relative %, no offset at rest", () => {
        const task = prepared(new Slide(400, "left")).createTask() as any;
        expect(task.resolve).toHaveLength(2);
        // Must not touch `transform` (that would clobber NLR's base positioning).
        expect(call(task.resolve[0], 0).style.transform).toBeUndefined();
        // Percentages are relative to the layer (= the letterboxed stage box), NOT the viewport:
        // vw/vh travel misses the stage whenever the window aspect differs from the design aspect.
        expect(call(task.resolve[0], 0).style.translate).not.toContain("vw");
        // Outgoing is at rest at t=0 (offset 0 → no jump) and a full stage width left at t=1.
        expect(call(task.resolve[0], 0).style.translate).toBe("0% 0px");
        expect(call(task.resolve[0], 1).style.translate).toBe("-100% 0px");
        // Incoming starts a full stage width to the right and ends at rest.
        expect(call(task.resolve[1], 0).style.translate).toBe("100% 0px");
        expect(call(task.resolve[1], 1).style.translate).toBe("0% 0px");
        // Vertical direction moves along the Y axis.
        expect(call(prepared(new Slide(400, "bottom")).createTask().resolve[1] as ResolverEntry, 0).style.translate)
            .toBe("0px -100%");
    });

    it("copy() returns an equivalent independent instance", () => {
        const original = new ThroughColor(600, "linear", "#123456", 0.25, { direction: "top", feather: 20 });
        const clone = original.copy();
        expect(clone).not.toBe(original);
        expect(clone).toBeInstanceOf(ThroughColor);
        // Same configuration → structurally identical overlay output.
        const overlayAtMid = (inst: ThroughColor) => call(inst.createTask().resolve[2] as ResolverEntry, 0.5).style;
        expect(overlayAtMid(clone)).toEqual(overlayAtMid(original));
    });
});
