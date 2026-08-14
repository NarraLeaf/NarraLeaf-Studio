import { describe, expect, it } from "vitest";
import { computeToolbarPopoverClientPosition } from "./SurfaceEditorToolbarPopover";

const rect = (x: number, y: number, width: number, height: number): DOMRect =>
    ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height } as DOMRect);

/** A window the size of a docked workspace. */
const OPENER = { width: 1400, height: 900 };
/** And a detached editor's, which is a different window and usually a smaller one. */
const DETACHED = { width: 620, height: 420 };

describe("computeToolbarPopoverClientPosition", () => {
    it("opens below the trigger, aligned to its left edge", () => {
        const position = computeToolbarPopoverClientPosition(rect(300, 100, 36, 36), rect(0, 0, 220, 180), OPENER);

        expect(position.x).toBe(300);
        expect(position.y).toBe(140);
    });

    it("right-aligns rather than run off the edge, which is what a top-right toolbar needs", () => {
        const trigger = rect(1340, 100, 36, 36);
        const position = computeToolbarPopoverClientPosition(trigger, rect(0, 0, 220, 180), OPENER);

        expect(position.x).toBe(trigger.right - 220);
        expect(position.x + 220).toBeLessThanOrEqual(OPENER.width);
    });

    it("flips above the trigger when there is no room below", () => {
        const position = computeToolbarPopoverClientPosition(rect(300, 800, 36, 36), rect(0, 0, 220, 180), OPENER);

        // Above and clear of the trigger, rather than hanging off the bottom.
        expect(position.y).toBe(800 - 4 - 180);
    });

    /**
     * The case the parameter exists for. A detached editor draws this subtree in a second window,
     * and measuring against the opener would place a panel outside the window it opens in - which
     * from there is indistinguishable from a menu that refuses to open.
     */
    it("fits the window it is actually drawn in, not the one that opened it", () => {
        const trigger = rect(560, 360, 36, 36);
        const panel = rect(0, 0, 220, 180);

        const inDetached = computeToolbarPopoverClientPosition(trigger, panel, DETACHED);
        expect(inDetached.x + 220).toBeLessThanOrEqual(DETACHED.width);
        expect(inDetached.y + 180).toBeLessThanOrEqual(DETACHED.height);

        // Measured against the opener the very same trigger stays put and spills out of the
        // detached window on both axes.
        const inOpener = computeToolbarPopoverClientPosition(trigger, panel, OPENER);
        expect(inOpener.x + 220).toBeGreaterThan(DETACHED.width);
        expect(inOpener.y + 180).toBeGreaterThan(DETACHED.height);
    });

    it("keeps a panel taller than the window inside it rather than centring the overflow", () => {
        const position = computeToolbarPopoverClientPosition(rect(100, 200, 36, 36), rect(0, 0, 220, 900), DETACHED);

        expect(position.y).toBeGreaterThanOrEqual(8);
    });
});
