/**
 * The keys a list answers on its own rows: Home and End go to the ends. The arrows are navigation's,
 * which moves between rows by where they are drawn (`spatialNavigation.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { listRowKeyboardMove } from "./helpers";

describe("moving between a list's rows with the keys", () => {
    it("goes to the ends with Home and End", () => {
        expect(listRowKeyboardMove("Home", 2, 4)).toBe(0);
        expect(listRowKeyboardMove("End", 0, 4)).toBe(3);
    });

    it("leaves the arrows to navigation", () => {
        expect(listRowKeyboardMove("ArrowDown", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("ArrowRight", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("ArrowUp", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("ArrowLeft", 1, 4)).toBeNull();
    });

    it("moves nothing for any other key, or in an empty list", () => {
        expect(listRowKeyboardMove("Enter", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("PageDown", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("End", 0, 0)).toBeNull();
    });
});
