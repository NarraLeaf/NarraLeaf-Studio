import { describe, expect, it } from "vitest";
import { tabStripRevealScrollLeft } from "./tabStripReveal";

describe("tabStripRevealScrollLeft", () => {
    // A 300px viewport over 900px of content: max scroll is 600.
    const strip = (scrollLeft: number) => ({ scrollLeft, clientWidth: 300, scrollWidth: 900 });

    it("does not scroll when the content already fits the viewport", () => {
        expect(
            tabStripRevealScrollLeft(
                { scrollLeft: 0, clientWidth: 300, scrollWidth: 300 },
                { offsetLeft: 100, width: 80 },
            ),
        ).toBeNull();
    });

    it("returns null when the tab is already fully visible", () => {
        expect(tabStripRevealScrollLeft(strip(0), { offsetLeft: 100, width: 80 })).toBeNull();
    });

    it("scrolls left to reveal a tab clipped past the left edge", () => {
        // Viewport shows [400, 700); the tab sits at [120, 200).
        expect(tabStripRevealScrollLeft(strip(400), { offsetLeft: 120, width: 80 })).toBe(120);
    });

    it("scrolls right to reveal a tab clipped past the right edge", () => {
        // Viewport shows [0, 300); the tab's right edge is at 500, so scroll to 200.
        expect(tabStripRevealScrollLeft(strip(0), { offsetLeft: 420, width: 80 })).toBe(200);
    });

    it("applies the margin on the clipped side", () => {
        expect(tabStripRevealScrollLeft(strip(0), { offsetLeft: 420, width: 80 }, 8)).toBe(208);
    });

    it("clamps the target to the strip's scroll range", () => {
        // The far-right tab would want to scroll past max (600); it is pinned there.
        expect(tabStripRevealScrollLeft(strip(0), { offsetLeft: 860, width: 80 }, 8)).toBe(600);
    });

    it("returns null rather than writing back the position already in effect", () => {
        // Already scrolled to reveal the right-clipped tab exactly.
        expect(tabStripRevealScrollLeft(strip(200), { offsetLeft: 420, width: 80 })).toBeNull();
    });
});
