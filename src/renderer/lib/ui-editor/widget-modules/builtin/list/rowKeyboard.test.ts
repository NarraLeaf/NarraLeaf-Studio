/**
 * The keys that move the keyboard between a list's rows. Home and End go to the ends. In a game
 * without navigation both arrow pairs step through the rows in order whichever way the list runs,
 * and neither end wraps round; in a game with navigation the arrows are navigation's, which moves
 * between rows by where they are drawn (`spatialNavigation.test.ts`).
 */
import { describe, expect, it } from "vitest";
import { listRowKeyboardMove } from "./helpers";

describe("moving between a list's rows with the keys", () => {
    it("goes to the ends with Home and End", () => {
        expect(listRowKeyboardMove("Home", 2, 4)).toBe(0);
        expect(listRowKeyboardMove("End", 0, 4)).toBe(3);
        expect(listRowKeyboardMove("Home", 2, 4, true)).toBe(0);
    });

    describe("in a game without navigation", () => {
        it("steps onward with ArrowDown and ArrowRight, and back with ArrowUp and ArrowLeft", () => {
            expect(listRowKeyboardMove("ArrowDown", 1, 4, true)).toBe(2);
            expect(listRowKeyboardMove("ArrowRight", 1, 4, true)).toBe(2);
            expect(listRowKeyboardMove("ArrowUp", 1, 4, true)).toBe(0);
            expect(listRowKeyboardMove("ArrowLeft", 1, 4, true)).toBe(0);
        });

        it("stops at both ends rather than wrapping round", () => {
            expect(listRowKeyboardMove("ArrowDown", 3, 4, true)).toBe(3);
            expect(listRowKeyboardMove("ArrowUp", 0, 4, true)).toBe(0);
        });
    });

    it("leaves the arrows to navigation in a game that has it", () => {
        expect(listRowKeyboardMove("ArrowDown", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("ArrowRight", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("ArrowUp", 1, 4)).toBeNull();
        expect(listRowKeyboardMove("ArrowLeft", 1, 4)).toBeNull();
    });

    it("moves nothing for any other key, or in an empty list", () => {
        expect(listRowKeyboardMove("Enter", 1, 4, true)).toBeNull();
        expect(listRowKeyboardMove("PageDown", 1, 4, true)).toBeNull();
        expect(listRowKeyboardMove("ArrowDown", 0, 0, true)).toBeNull();
        expect(listRowKeyboardMove("End", 0, 0)).toBeNull();
    });
});
