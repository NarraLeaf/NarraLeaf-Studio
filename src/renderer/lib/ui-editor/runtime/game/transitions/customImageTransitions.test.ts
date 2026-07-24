import { describe, expect, it } from "vitest";
import { Slide } from "./customImageTransitions";

// The 0.16.0 migration folded Studio's soft-wipe / blinds / soft-iris / blur-dissolve / through-colour
// custom transitions into the engine's native `Reveal`/`ThroughColor` + `Mask` vocabulary (covered by
// narraleaf-react's own tests). `Slide` is the only transition Studio still ships itself - retained
// because the native `Push` translates in viewport units, which overshoots the letterboxed stage box.

// The resolver entries produced by asPrev/asTarget are wrapped as `{ resolver, key }`; unwrap to the
// callable form for inspection.
type ResolverEntry = ((...args: number[]) => any) | { resolver: (...args: number[]) => any; key: string };
function call(entry: ResolverEntry, t: number): any {
    const fn = typeof entry === "function" ? entry : entry.resolver;
    return fn(t);
}

// The wrapped asPrev/asTarget resolvers merge the transition's prev/target src into their output and
// throw if none is set, so give both a Color src (which NLR accepts) before invoking them.
function prepared<T>(inst: T): T {
    (inst as any)._setPrevSrc("#000000");
    (inst as any)._setTargetSrc("#000000");
    return inst;
}

describe("Slide (custom, percentage travel)", () => {
    it("uses the independent `translate` property in self-relative %, no offset at rest", () => {
        const task = prepared(new Slide(400, "left")).createTask() as any;
        expect(task.animations).toHaveLength(1);
        expect(task.animations[0]).toMatchObject({ start: 0, end: 1, duration: 400 });
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
        const original = new Slide(600, "top");
        const clone = original.copy();
        expect(clone).not.toBe(original);
        expect(clone).toBeInstanceOf(Slide);
        const translateAt = (inst: Slide, t: number) => call(prepared(inst).createTask().resolve[0] as ResolverEntry, t).style.translate;
        expect(translateAt(clone, 1)).toBe(translateAt(original, 1));
    });
});
