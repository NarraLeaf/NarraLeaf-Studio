import { describe, expect, it } from "vitest";
import {
    findNavigationTarget,
    firstInReadingOrder,
    pickInDirection,
    type NavigationCandidate,
    type NavigationRegionRef,
} from "./spatialNavigation";

function box(target: string, left: number, top: number, width = 100, height = 40, regions: NavigationRegionRef[] = []): NavigationCandidate<string> {
    return { target, rect: { left, top, right: left + width, bottom: top + height }, regions };
}

describe("pickInDirection", () => {
    // A title menu: four buttons in a column.
    const column = [box("start", 0, 0), box("load", 0, 50), box("config", 0, 100), box("quit", 0, 150)];

    it("goes to the next control along a column, and nowhere past its end", () => {
        expect(pickInDirection(column[0].rect, column, "down")?.target).toBe("load");
        expect(pickInDirection(column[1].rect, column, "up")?.target).toBe("start");
        expect(pickInDirection(column[3].rect, column, "down")).toBeNull();
        expect(pickInDirection(column[0].rect, column, "right")).toBeNull();
    });

    it("prefers the control straight below to a slightly nearer one off to the side", () => {
        const from = box("from", 0, 0);
        const straight = box("straight", 0, 80);
        const aside = box("aside", 160, 50);
        expect(pickInDirection(from.rect, [aside, straight], "down")?.target).toBe("straight");
    });

    it("moves along a grid's rows and columns", () => {
        const grid = [
            box("a", 0, 0), box("b", 120, 0), box("c", 240, 0),
            box("d", 0, 60), box("e", 120, 60), box("f", 240, 60),
        ];
        expect(pickInDirection(grid[1].rect, grid, "down")?.target).toBe("e");
        expect(pickInDirection(grid[4].rect, grid, "left")?.target).toBe("d");
        expect(pickInDirection(grid[3].rect, grid, "right")?.target).toBe("e");
        expect(pickInDirection(grid[5].rect, grid, "up")?.target).toBe("c");
    });

    it("does not count a control that only overlaps the current one as further", () => {
        const tall = box("tall", 0, 0, 100, 200);
        const inside = box("inside", 10, 10, 80, 40);
        expect(pickInDirection(tall.rect, [inside], "down")).toBeNull();
    });
});

describe("findNavigationTarget", () => {
    const list: NavigationRegionRef = { key: "list", wrap: false };
    const wrapping: NavigationRegionRef = { key: "tabs", wrap: true };

    it("stays inside the group while there is room, then leaves it", () => {
        // A list of three rows on the left, a Back button on the right level with the first row.
        const rows = [box("r0", 0, 0, 100, 40, [list]), box("r1", 0, 50, 100, 40, [list]), box("r2", 0, 100, 100, 40, [list])];
        const back = box("back", 300, 0);
        const below = box("below", 0, 200);
        const all = [...rows, back, below];
        expect(findNavigationTarget({ current: rows[0], candidates: all, direction: "down" })?.target).toBe("r1");
        expect(findNavigationTarget({ current: rows[2], candidates: all, direction: "down" })?.target).toBe("below");
        expect(findNavigationTarget({ current: rows[1], candidates: all, direction: "right" })?.target).toBe("back");
    });

    it("wraps inside a wrapping group instead of leaving it", () => {
        const tabs = [box("t0", 0, 0, 80, 30, [wrapping]), box("t1", 100, 0, 80, 30, [wrapping]), box("t2", 200, 0, 80, 30, [wrapping])];
        const outside = box("outside", 400, 0);
        const all = [...tabs, outside];
        expect(findNavigationTarget({ current: tabs[2], candidates: all, direction: "right" })?.target).toBe("t0");
        expect(findNavigationTarget({ current: tabs[0], candidates: all, direction: "left" })?.target).toBe("t2");
    });

    it("wraps at the surface's edge only when the surface says so", () => {
        const column = [box("a", 0, 0), box("b", 0, 50), box("c", 0, 100)];
        expect(findNavigationTarget({ current: column[2], candidates: column, direction: "down" })).toBeNull();
        expect(findNavigationTarget({ current: column[2], candidates: column, direction: "down", wrap: true })?.target).toBe("a");
        expect(findNavigationTarget({ current: column[0], candidates: column, direction: "up", wrap: true })?.target).toBe("c");
    });

    it("lands on the wrapped row in the player's own column", () => {
        const grid = [box("a", 0, 0), box("b", 120, 0), box("c", 0, 60), box("d", 120, 60)];
        expect(findNavigationTarget({ current: grid[3], candidates: grid, direction: "down", wrap: true })?.target).toBe("b");
    });
});

describe("firstInReadingOrder", () => {
    it("is the top row's leftmost control", () => {
        const controls = [box("right", 200, 2), box("left", 0, 0), box("below", 0, 100)];
        expect(firstInReadingOrder(controls)?.target).toBe("left");
    });
});
