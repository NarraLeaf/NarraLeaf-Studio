import { describe, expect, it } from "vitest";
import { placeAnchoredPanel, type AnchorRect } from "./anchoredPanelPlacement";

/** The window the episode 9 captures were taken in: 1400 x 900, a 40 px title bar. */
const viewport = { width: 1400, height: 900, top: 52 };

function rect(left: number, top: number, width: number, height: number): AnchorRect {
    return { left, top, width, right: left + width, bottom: top + height };
}

const place = (anchor: AnchorRect, side?: "below" | "above") =>
    placeAnchoredPanel({ anchor, viewport, minWidth: 320, maxWidth: 480, maxHeight: 560, side });

describe("anchored panel placement", () => {
    it("lines a picker from the right dock up with the trigger's right edge, clear of the rail", () => {
        // The page-music row in the right dock: x 1062-1314, the dock ends at 1352, the rail beyond.
        const trigger = rect(1062, 576, 252, 28);
        const placement = place(trigger);
        expect(placement.width).toBe(320);
        expect(placement.left + placement.width).toBe(trigger.right);
    });

    it("lines a picker from the left dock up with the trigger's left edge", () => {
        const trigger = rect(58, 300, 252, 28);
        expect(place(trigger).left).toBe(58);
    });

    it("keeps a picker as wide as its trigger on the trigger's left edge", () => {
        const trigger = rect(900, 300, 400, 28);
        const placement = place(trigger);
        expect(placement.width).toBe(400);
        expect(placement.left).toBe(900);
    });

    it("opens below with the top edge fixed when there is room", () => {
        const trigger = rect(1062, 120, 252, 28);
        const placement = place(trigger);
        expect(placement.side).toBe("below");
        expect(placement.top).toBe(trigger.bottom + 8);
        expect(placement.height).toBeUndefined();
        expect(placement.top + placement.maxHeight).toBeLessThanOrEqual(viewport.height - 12);
    });

    it("opens above at a fixed height that ends short of the trigger, so it never covers its row", () => {
        const trigger = rect(1062, 576, 252, 28);
        const placement = place(trigger);
        expect(placement.side).toBe("above");
        expect(placement.height).toBe(placement.maxHeight);
        expect(placement.top + (placement.height ?? 0)).toBe(trigger.top - 8);
        expect(placement.top).toBeGreaterThanOrEqual(viewport.top);
    });

    it("keeps the side it opened on even when the other side would now win", () => {
        // Opened above; a later pass (a folder opened, the window resized) must not flip it below.
        const trigger = rect(1062, 576, 252, 28);
        const first = place(trigger);
        const again = place(trigger, first.side);
        expect(again).toEqual(first);
        const below = place(rect(1062, 380, 252, 28), "above");
        expect(below.side).toBe("above");
        expect(below.top + (below.height ?? 0)).toBe(380 - 8);
    });

    it("chooses the side for the tallest the panel can be, not for what it holds now", () => {
        // 276 px below, 516 above: a 395 px picker would fit neither way at its full 560, and opening
        // below would leave a folder no room to open into.
        expect(place(rect(1062, 576, 252, 28)).side).toBe("above");
        expect(place(rect(1062, 200, 252, 28)).side).toBe("below");
    });
});
