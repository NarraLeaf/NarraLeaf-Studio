import { describe, it, expect } from "vitest";
import { cardOffsets, visibleCardCount } from "./notificationStack";

describe("visibleCardCount", () => {
    it("shows every card when they all fit", () => {
        expect(visibleCardCount([80, 80, 80], 8, 400)).toBe(3);
    });

    it("counts the gaps between cards, not after the last one", () => {
        // 3 x 80 + 2 x 8 = 256: exactly the box, so all three stay.
        expect(visibleCardCount([80, 80, 80], 8, 256)).toBe(3);
        // One pixel less and the third has to wait.
        expect(visibleCardCount([80, 80, 80], 8, 255)).toBe(2);
    });

    it("queues the cards that do not fit", () => {
        expect(visibleCardCount([100, 100, 100, 100], 8, 220)).toBe(2);
    });

    it("keeps the first card even when it alone overflows", () => {
        // Otherwise nothing is on screen, nothing can be dismissed, and the queue never moves.
        expect(visibleCardCount([900], 8, 200)).toBe(1);
        expect(visibleCardCount([900, 80], 8, 200)).toBe(1);
    });

    it("admits everything before the container has been measured", () => {
        expect(visibleCardCount([80, 80], 8, 0)).toBe(2);
        expect(visibleCardCount([80, 80], 8, -1)).toBe(2);
    });

    it("has nothing to show for an empty stack", () => {
        expect(visibleCardCount([], 8, 400)).toBe(0);
    });

    it("stops at the first card that does not fit rather than packing later ones in", () => {
        // A short card behind a tall one waits its turn; the stack is a queue, not a bin packer.
        expect(visibleCardCount([80, 300, 40], 8, 200)).toBe(1);
    });
});

describe("cardOffsets", () => {
    it("stacks the visible cards with the gap between them", () => {
        expect(cardOffsets([40, 60, 30], 8, 3)).toEqual([0, 48, 116]);
    });

    it("parks the queued cards at the end of the visible stack", () => {
        expect(cardOffsets([40, 60, 30, 30], 8, 2)).toEqual([0, 48, 116, 116]);
    });

    it("puts everything at the top when nothing is shown", () => {
        expect(cardOffsets([40, 60], 8, 0)).toEqual([0, 0]);
    });
});

describe("visibleCardCount with the waiting line", () => {
    it("ignores the line when everything fits", () => {
        expect(visibleCardCount([80, 80], 8, 400, 20)).toBe(2);
    });

    it("makes room for the line once cards are being held back", () => {
        // 3 x 80 + 2 x 8 = 256 fits the box exactly, but the fourth card cannot, so the line is
        // needed - and it costs a gap plus its own height, which the third card was using.
        expect(visibleCardCount([80, 80, 80, 80], 8, 256)).toBe(3);
        expect(visibleCardCount([80, 80, 80, 80], 8, 256, 20)).toBe(2);
    });

    it("still keeps the first card when the line would crowd it out", () => {
        expect(visibleCardCount([240, 80], 8, 250, 20)).toBe(1);
    });
});
