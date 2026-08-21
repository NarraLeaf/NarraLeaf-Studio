import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_GROUP_FRAME_PADDING,
    BLUEPRINT_GROUP_MIN_HEIGHT,
    BLUEPRINT_GROUP_MIN_WIDTH,
    blueprintGroupMemberIds,
    computeBlueprintGroupFrame,
    refitBlueprintGroupFrames,
    type BlueprintFrameBox,
} from "./blueprintGroupFrame";

const PAD = BLUEPRINT_GROUP_FRAME_PADDING;

function box(id: string, x: number, y: number, width = 200, height = 100): BlueprintFrameBox {
    return { id, x, y, width, height };
}

describe("computeBlueprintGroupFrame", () => {
    it("has no frame to draw around nothing", () => {
        expect(computeBlueprintGroupFrame([])).toBeNull();
    });

    it("wraps its members with room for the title row above them", () => {
        const frame = computeBlueprintGroupFrame([
            { x: 100, y: 200, width: 200, height: 100 },
            { x: 500, y: 400, width: 200, height: 100 },
        ])!;

        expect(frame).toEqual({
            x: 100 - PAD.left,
            y: 200 - PAD.top,
            width: 600 + PAD.left + PAD.right,
            height: 300 + PAD.top + PAD.bottom,
        });
    });

    it("stays big enough to grab around a single small card", () => {
        const frame = computeBlueprintGroupFrame([{ x: 0, y: 0, width: 40, height: 20 }])!;

        expect(frame.width).toBe(BLUEPRINT_GROUP_MIN_WIDTH);
        expect(frame.height).toBe(BLUEPRINT_GROUP_MIN_HEIGHT);
    });
});

describe("blueprintGroupMemberIds", () => {
    const frame = { x: 0, y: 0, width: 400, height: 400 };

    it("holds the cards that fit inside it and never itself", () => {
        const ids = blueprintGroupMemberIds("frame", frame, [
            box("frame", 0, 0, 400, 400),
            box("inside", 50, 50),
            box("outside", 900, 900),
        ]);

        expect(ids).toEqual(["inside"]);
    });

    it("does not claim a card that is only half in", () => {
        const ids = blueprintGroupMemberIds("frame", frame, [box("straddling", 300, 50)]);

        expect(ids).toEqual([]);
    });

    it("counts a card resting exactly on the edge as inside", () => {
        const ids = blueprintGroupMemberIds("frame", frame, [box("flush", 200, 300)]);

        expect(ids).toEqual(["flush"]);
    });

    it("reaches through a nested frame to the cards inside it", () => {
        const ids = blueprintGroupMemberIds("outer", { x: 0, y: 0, width: 900, height: 900 }, [
            box("inner", 100, 100, 400, 400),
            box("deep", 150, 150),
        ]);

        expect(ids.sort()).toEqual(["deep", "inner"]);
    });
});

describe("refitBlueprintGroupFrames", () => {
    it("follows its members to where the layout put them", () => {
        const frames = [box("frame", 0, 0, 400, 400)];
        const members = new Map([["frame", ["a", "b"]]]);
        const moved = new Map([
            ["a", { x: 1000, y: 1000, width: 200, height: 100 }],
            ["b", { x: 1400, y: 1000, width: 200, height: 100 }],
        ]);

        const refitted = refitBlueprintGroupFrames(frames, members, moved);

        expect(refitted.frame).toEqual({
            x: 1000 - PAD.left,
            y: 1000 - PAD.top,
            width: 600 + PAD.left + PAD.right,
            height: 100 + PAD.top + PAD.bottom,
        });
    });

    it("sizes a nested frame first, so the outer one can wrap the result", () => {
        const frames = [box("outer", 0, 0, 900, 900), box("inner", 100, 100, 400, 400)];
        const members = new Map([
            ["outer", ["inner", "a"]],
            ["inner", ["a"]],
        ]);
        const moved = new Map([["a", { x: 500, y: 500, width: 200, height: 100 }]]);

        const refitted = refitBlueprintGroupFrames(frames, members, moved);

        expect(refitted.inner!.x).toBe(500 - PAD.left);
        // The outer frame wrapped the re-fitted inner one, not the stale rectangle it started at.
        expect(refitted.outer!.x).toBe(refitted.inner!.x - PAD.left);
        expect(refitted.outer!.width).toBe(refitted.inner!.width + PAD.left + PAD.right);
    });

    it("leaves an empty frame where the author put it", () => {
        const refitted = refitBlueprintGroupFrames([box("frame", 10, 10, 400, 400)], new Map(), new Map());

        expect(refitted.frame).toBeUndefined();
    });
});
