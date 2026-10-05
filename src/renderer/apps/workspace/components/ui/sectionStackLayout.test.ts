import { describe, expect, it } from "vitest";
import {
    resizeSectionPair,
    resolveSectionStackLayout,
    sashNeighbours,
    sectionStackChromeHeight,
    SECTION_HEADER_HEIGHT,
    type SectionStackEntry,
    type SectionStackSpec,
} from "./sectionStackLayout";

const LIST: SectionStackSpec = { id: "list", minSize: 200, defaultSize: 320 };
const LIBRARY: SectionStackSpec = { id: "library", minSize: 120, defaultSize: 200 };
const ACTIONS: SectionStackSpec = { id: "actions", minSize: 120, defaultSize: 200 };

function entries(open: [boolean, boolean, boolean], sizes: [number?, number?, number?] = []): SectionStackEntry[] {
    return [LIST, LIBRARY, ACTIONS].map((spec, index) => ({ spec, open: open[index]!, size: sizes[index] }));
}

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

describe("sectionStackChromeHeight", () => {
    it("is every header plus a seam under each open body that has a section after it", () => {
        expect(sectionStackChromeHeight([false, false, false])).toBe(3 * SECTION_HEADER_HEIGHT);
        expect(sectionStackChromeHeight([true, true, true])).toBe(3 * SECTION_HEADER_HEIGHT + 2);
        // The last section's body has nothing under it.
        expect(sectionStackChromeHeight([false, false, true])).toBe(3 * SECTION_HEADER_HEIGHT);
        expect(sectionStackChromeHeight([true, false, false])).toBe(3 * SECTION_HEADER_HEIGHT + 1);
    });
});

describe("resolveSectionStackLayout", () => {
    it("gives the fill section everything the others leave", () => {
        expect(resolveSectionStackLayout(700, entries([true, true, true]), 0)).toEqual([300, 200, 200]);
        expect(resolveSectionStackLayout(700, entries([true, false, false]), 0)).toEqual([700, 0, 0]);
    });

    it("keeps the sizes the author chose while the fill section has room", () => {
        expect(resolveSectionStackLayout(700, entries([true, true, true], [undefined, 260, 140]), 0)).toEqual([300, 260, 140]);
        // A taller panel only grows the fill section.
        expect(resolveSectionStackLayout(900, entries([true, true, true], [undefined, 260, 140]), 0)).toEqual([500, 260, 140]);
    });

    it("shrinks the fill section first, then the others towards their minimums together", () => {
        // 600 - 400 leaves the list exactly its minimum.
        expect(resolveSectionStackLayout(600, entries([true, true, true]), 0)).toEqual([200, 200, 200]);
        const squeezed = resolveSectionStackLayout(500, entries([true, true, true], [undefined, 300, 160]), 0);
        expect(squeezed[0]).toBe(200);
        expect(sum(squeezed)).toBe(500);
        // 300 to give up 160, the library has 180 above its minimum and the actions 40: the same part
        // of each, so they arrive at their minimums together.
        expect(squeezed[1]! - 120).toBeCloseTo((180 * (220 - 160)) / 220, 0);
        expect(squeezed[2]! - 120).toBeCloseTo((40 * (220 - 160)) / 220, 0);
    });

    it("gives every open body its minimum's share when not even the minimums fit", () => {
        const layout = resolveSectionStackLayout(220, entries([true, true, true]), 0);
        expect(sum(layout)).toBe(220);
        expect(layout).toEqual([100, 60, 60]);
    });

    it("shares the room in proportion to the sizes when the fill section is closed", () => {
        expect(resolveSectionStackLayout(600, entries([false, true, true], [undefined, 300, 150]), 0)).toEqual([0, 400, 200]);
        // Shorter than the sizes: each gives up the same part of what it has above its minimum.
        expect(resolveSectionStackLayout(300, entries([false, true, true], [undefined, 300, 150]), 0)).toEqual([0, 171, 129]);
        expect(resolveSectionStackLayout(500, entries([false, true, false]), 0)).toEqual([0, 500, 0]);
    });

    it("lays nothing out when nothing is open or there is no room", () => {
        expect(resolveSectionStackLayout(700, entries([false, false, false]), 0)).toEqual([0, 0, 0]);
        expect(resolveSectionStackLayout(-40, entries([true, true, false]), 0)).toEqual([0, 0, 0]);
    });

    it("reads a stored size that is not a positive number as never sized, and one below the minimum as the minimum", () => {
        expect(resolveSectionStackLayout(700, entries([true, true, true], [undefined, Number.NaN, -5]), 0)).toEqual([300, 200, 200]);
        expect(resolveSectionStackLayout(700, entries([true, true, true], [undefined, 40, 200]), 0)).toEqual([380, 120, 200]);
    });

    it("always adds up to the whole room, in whole pixels", () => {
        for (const room of [333, 457, 611, 789, 1003]) {
            for (const fill of [-1, 0]) {
                const layout = resolveSectionStackLayout(room, entries([true, true, true], [333.3, 217.7, 151.1]), fill);
                expect(sum(layout)).toBe(room);
                expect(layout.every(Number.isInteger)).toBe(true);
            }
        }
    });

    it("comes back exactly as dragged when every open body's size is written down", () => {
        const before = resolveSectionStackLayout(679, entries([true, true, true]), 0);
        expect(before).toEqual([279, 200, 200]);
        const { sizes: dragged } = resizeSectionPair(before, 1, 2, 80, [200, 120, 120]);
        expect(dragged).toEqual([279, 280, 120]);
        expect(resolveSectionStackLayout(679, entries([true, true, true], [279, 280, 120]), 0)).toEqual(dragged);
        // Without a fill section the same record is shared out in proportion, which is the same thing.
        expect(resolveSectionStackLayout(679, entries([true, true, true], [279, 280, 120]))).toEqual(dragged);
    });
});

describe("sashNeighbours", () => {
    it("pairs an open section with the next open one, past closed headers", () => {
        expect(sashNeighbours([true, true, true], 0)).toEqual({ upper: 0, lower: 1 });
        expect(sashNeighbours([true, false, true], 0)).toEqual({ upper: 0, lower: 2 });
    });

    it("leaves a plain line where nothing below is open, and nothing under a closed section", () => {
        expect(sashNeighbours([true, false, false], 0)).toBeNull();
        expect(sashNeighbours([false, true, true], 0)).toBeNull();
        expect(sashNeighbours([true, true, true], 2)).toBeNull();
    });
});

describe("resizeSectionPair", () => {
    const mins = [200, 120, 120];

    it("moves pixels from one side of the seam to the other", () => {
        expect(resizeSectionPair([300, 200, 200], 1, 2, 80, mins)).toEqual({ sizes: [300, 280, 120], applied: 80 });
        expect(resizeSectionPair([300, 200, 200], 1, 2, -50, mins)).toEqual({ sizes: [300, 150, 250], applied: -50 });
    });

    it("stops where either side reaches its minimum", () => {
        expect(resizeSectionPair([300, 200, 200], 1, 2, 500, mins)).toEqual({ sizes: [300, 280, 120], applied: 80 });
        expect(resizeSectionPair([300, 200, 200], 0, 1, -500, mins)).toEqual({ sizes: [200, 300, 200], applied: -100 });
    });

    it("never pushes a body the panel has already squeezed below its minimum further down", () => {
        expect(resizeSectionPair([100, 60, 60], 1, 2, 30, mins)).toEqual({ sizes: [100, 60, 60], applied: 0 });
        expect(resizeSectionPair([100, 60, 60], 1, 2, -30, mins)).toEqual({ sizes: [100, 60, 60], applied: 0 });
    });
});
