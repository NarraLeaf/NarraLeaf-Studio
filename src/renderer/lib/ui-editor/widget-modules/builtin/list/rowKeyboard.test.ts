/**
 * The keys that move the keyboard between a list's rows: both arrow pairs step through the rows in
 * order whichever way the list runs, Home and End go to the ends, and neither end wraps round.
 */
import { describe, expect, it } from "vitest";
import { listRowKeyboardMove } from "./helpers";

describe("moving between a list's rows with the keys", () => {
    it("steps onward with ArrowDown and ArrowRight, and back with ArrowUp and ArrowLeft", () => {
        expect(listRowKeyboardMove("ArrowDown", 1, 4)).toBe(2);
        expect(listRowKeyboardMove("ArrowRight", 1, 4)).toBe(2);
        expect(listRowKeyboardMove("ArrowUp", 1, 4)).toBe(0);
        expect(listRowKeyboardMove("ArrowLeft", 1, 4)).toBe(0);
    });

    it("goes to the ends with Home and End", () => {
        expect(listRowKeyboardMove("Home", 2, 4)).toBe(0);
        expect(listRowKeyboardMove("End", 0, 4)).toBe(3);
    });

    it("stops at both ends rather than wrapping round", () => {
        expect(listRowKeyboardMove("ArrowDown", 3, 4)).toBe(3);
        expect(listRowKeyboardMove("ArrowUp", 0, 4)).toBe(0);
    });

    it("moves nothing for any other key, or in an empty list", () => {
        expect(listRowKeyboardMove("Enter", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("PageDown", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("ArrowDown", 0, 0)).toBeNull();
    });
});
