import { describe, expect, it } from "vitest";
import { resolveRevealScrollTop, storyRevealLead, type StoryRevealView } from "./storyRowReveal";

/** A 600px-tall page over 4000px of rows, with a one-row (36px) lead. */
function view(scrollTop: number, overrides: Partial<StoryRevealView> = {}): StoryRevealView {
    return { scrollTop, height: 600, maxScrollTop: 3400, lead: 36, ...overrides };
}

describe("resolveRevealScrollTop", () => {
    it("never moves the page for a target the author pointed at", () => {
        // Off screen in both directions and still no move: "none" is a promise, not a preference.
        expect(resolveRevealScrollTop("none", { top: 3000, height: 36 }, view(0))).toBeNull();
        expect(resolveRevealScrollTop("none", { top: 0, height: 36 }, view(2000))).toBeNull();
    });

    it("leaves a row that is already on the page alone", () => {
        expect(resolveRevealScrollTop("step", { top: 300, height: 36 }, view(0))).toBeNull();
    });

    it("moves the minimum for a row past the bottom edge, and keeps a lead below it", () => {
        // Row occupies 620..656 with the page showing 0..600. The smallest honest answer puts its
        // bottom plus the lead on the bottom edge - 656 + 36 - 600 - and nothing more.
        expect(resolveRevealScrollTop("step", { top: 620, height: 36 }, view(0))).toBe(92);
    });

    it("moves the minimum for a row past the top edge, and keeps a lead above it", () => {
        expect(resolveRevealScrollTop("step", { top: 980, height: 36 }, view(1000))).toBe(944);
    });

    it("does not centre a row that is only just out of view", () => {
        // The reported complaint, as a number: a line committed one row below the fold used to land in
        // the middle of the page. Centring it would be 620 - 282 = 338; a step is 92.
        const stepped = resolveRevealScrollTop("step", { top: 620, height: 36 }, view(0));
        expect(stepped).toBe(92);
        expect(stepped).toBeLessThan(300);
    });

    it("places an arrival for reading rather than at the edge it is nearest", () => {
        // A third down the page, not a half: 3000 - 200.
        expect(resolveRevealScrollTop("jump", { top: 3000, height: 36 }, view(0))).toBe(2800);
    });

    it("does not move the page for an arrival that lands on a row already in front of the author", () => {
        expect(resolveRevealScrollTop("jump", { top: 300, height: 36 }, view(0))).toBeNull();
    });

    it("lifts an arrival off an edge it was flush against rather than repositioning it", () => {
        // Fully visible (564..600) but with nothing after it, so the jump degrades to the minimal move.
        expect(resolveRevealScrollTop("jump", { top: 564, height: 36 }, view(0))).toBe(36);
    });

    it("clamps to the ends of the content", () => {
        // The first row cannot be a third of the way down the page, and the last cannot have a screen
        // of context under it. Both ask for a position the content does not have; both get the edge.
        expect(resolveRevealScrollTop("jump", { top: 40, height: 36 }, view(2000))).toBe(0);
        expect(resolveRevealScrollTop("jump", { top: 3964, height: 36 }, view(0))).toBe(3400);
    });

    it("shows the top of a row taller than the page, not its tail", () => {
        // Scrolling down to an 800px row: aligning its bottom would answer with the end of it.
        expect(resolveRevealScrollTop("step", { top: 700, height: 800 }, view(0))).toBe(700);
    });

    it("shrinks the lead rather than letting the two edges fight over a short page", () => {
        // 200px page, 180px row: a 36px lead does not fit on both sides, so it is trimmed to 10 and the
        // answer stays a single stable position instead of oscillating between two.
        const short = view(0, { height: 200, lead: 36, maxScrollTop: 3800 });
        const first = resolveRevealScrollTop("step", { top: 400, height: 180 }, short);
        expect(first).toBe(390);
        expect(resolveRevealScrollTop("step", { top: 400, height: 180 }, view(390, { height: 200, lead: 36, maxScrollTop: 3800 }))).toBeNull();
    });
});

describe("storyRevealLead", () => {
    it("is one row on a normal page", () => {
        expect(storyRevealLead(36, 600)).toBe(36);
    });

    it("is capped on a page too short to spare one", () => {
        expect(storyRevealLead(36, 160)).toBe(24);
    });
});
