import { describe, expect, it } from "vitest";
import { planTableRowReveal } from "./useTableRowReveal";

/**
 * What a deep link into a windowed table does next, given what the table holds.
 *
 * The failure this guards is the reveal that silently does nothing: a row a filter is hiding is in
 * the table and nowhere in the list, and a reveal that only looked in the list would wait for a row
 * that is never going to be drawn.
 */
describe("planTableRowReveal", () => {
    it("scrolls to a row that is drawn", () => {
        expect(planTableRowReveal({ index: 12, inTable: true, filtersCleared: false })).toEqual({ kind: "scroll", index: 12 });
    });

    it("clears the filters once for a row the table holds but does not draw", () => {
        expect(planTableRowReveal({ index: -1, inTable: true, filtersCleared: false })).toEqual({ kind: "showAll" });
        // Asked once: a row a cleared filter still does not draw is waited for, not looped on.
        expect(planTableRowReveal({ index: -1, inTable: true, filtersCleared: true })).toEqual({ kind: "wait" });
    });

    it("waits for a row that has not been read yet", () => {
        expect(planTableRowReveal({ index: -1, inTable: false, filtersCleared: false })).toEqual({ kind: "wait" });
    });
});
