import { describe, it, expect } from "vitest";
import { mergeVisibleRailOrder } from "./sidebarPanelOrder";

describe("mergeVisibleRailOrder", () => {
    it("keeps hidden panels pinned to their absolute slots when the visible subset is reordered", () => {
        // Full order [A,B,C,D]; B and D hidden, so the rail shows [A,C]. Drag swaps them to [C,A].
        expect(mergeVisibleRailOrder(["A", "B", "C", "D"], ["C", "A"])).toEqual(["C", "B", "A", "D"]);
    });

    it("reorders freely when nothing is hidden", () => {
        expect(mergeVisibleRailOrder(["A", "B", "C"], ["C", "A", "B"])).toEqual(["C", "A", "B"]);
    });

    it("is a no-op when the visible order is unchanged", () => {
        expect(mergeVisibleRailOrder(["A", "B", "C"], ["A", "C"])).toEqual(["A", "B", "C"]);
    });

    it("leaves a leading hidden panel in place", () => {
        // A hidden; rail shows [B,C]; drag to [C,B].
        expect(mergeVisibleRailOrder(["A", "B", "C"], ["C", "B"])).toEqual(["A", "C", "B"]);
    });

    it("returns the full order untouched when no visible ids are supplied", () => {
        expect(mergeVisibleRailOrder(["A", "B"], [])).toEqual(["A", "B"]);
    });
});
