import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_GROUP_FRAME_PADDING,
    BLUEPRINT_GROUP_MIN_HEIGHT,
    BLUEPRINT_GROUP_MIN_WIDTH,
    blueprintGroupMemberIds,
    computeBlueprintGroupFrame,
    fitBlueprintGroupFrame,
    growBlueprintFrameToHold,
    growBlueprintGroupFramesForDrop,
    pickBlueprintGroupDropTarget,
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

describe("pickBlueprintGroupDropTarget", () => {
    const outer = box("outer", 0, 0, 900, 900);
    const inner = box("inner", 100, 100, 400, 400);

    it("takes the frame the card's centre is over", () => {
        expect(pickBlueprintGroupDropTarget([outer], box("card", 600, 600))?.id).toBe("outer");
    });

    it("takes the innermost of the frames over it", () => {
        expect(pickBlueprintGroupDropTarget([outer, inner], box("card", 200, 200))?.id).toBe("inner");
    });

    it("takes the frame under a card that is hanging out of it", () => {
        // Half the card is past the right edge; the author is still pointing at the group.
        expect(pickBlueprintGroupDropTarget([inner], box("card", 400, 200))?.id).toBe("inner");
    });

    it("takes nothing when the card is only overlapping a corner", () => {
        expect(pickBlueprintGroupDropTarget([inner], box("card", 450, 450))).toBeNull();
    });

    it("takes nothing on empty canvas", () => {
        expect(pickBlueprintGroupDropTarget([], box("card", 10, 10))).toBeNull();
    });
});

describe("growBlueprintFrameToHold", () => {
    const frame = { x: 0, y: 0, width: 400, height: 400 };

    it("leaves a frame that already holds the card alone", () => {
        expect(growBlueprintFrameToHold(frame, [{ x: 50, y: 60, width: 200, height: 100 }])).toEqual(frame);
    });

    it("stretches over the edge the card is hanging out of, with room around it", () => {
        const grown = growBlueprintFrameToHold(frame, [{ x: 300, y: 50, width: 200, height: 100 }]);

        expect(grown).toEqual({ x: 0, y: 0, width: 500 + PAD.right, height: 400 });
    });

    it("moves its top-left corner out to cover a card above and left of it", () => {
        const grown = growBlueprintFrameToHold(frame, [{ x: -100, y: -50, width: 200, height: 100 }]);

        expect(grown.x).toBe(-100 - PAD.left);
        expect(grown.y).toBe(-50 - PAD.top);
        // The far edges stayed where the author left them.
        expect(grown.x + grown.width).toBe(400);
        expect(grown.y + grown.height).toBe(400);
    });

    it("has nothing to hold, so nothing to change", () => {
        expect(growBlueprintFrameToHold(frame, [])).toEqual(frame);
    });
});

describe("growBlueprintGroupFramesForDrop", () => {
    it("lists nothing when the group already holds what was dropped in it", () => {
        const frames = [box("frame", 0, 0, 400, 400)];

        expect(growBlueprintGroupFramesForDrop(frames, "frame", [{ x: 50, y: 60, width: 200, height: 100 }])).toEqual(
            {},
        );
    });

    it("stretches the group around a card dropped over its edge", () => {
        const frames = [box("frame", 0, 0, 400, 400)];

        const grown = growBlueprintGroupFramesForDrop(frames, "frame", [{ x: 300, y: 50, width: 200, height: 100 }]);

        expect(grown.frame).toEqual({ x: 0, y: 0, width: 500 + PAD.right, height: 400 });
    });

    it("carries the growth out through the group the group is in", () => {
        const frames = [box("outer", 0, 0, 500, 500), box("inner", 100, 100, 300, 300)];

        const grown = growBlueprintGroupFramesForDrop(frames, "inner", [{ x: 380, y: 150, width: 200, height: 100 }]);

        // The inner frame took the card, and the outer one took the inner frame with it rather than
        // being left with a group sticking out through its wall.
        expect(grown.inner!.x + grown.inner!.width).toBe(580 + PAD.right);
        expect(grown.outer!.x + grown.outer!.width).toBe(grown.inner!.x + grown.inner!.width + PAD.right);
    });

    it("lists nothing for a frame that is not on the canvas", () => {
        expect(growBlueprintGroupFramesForDrop([], "gone", [{ x: 0, y: 0, width: 10, height: 10 }])).toEqual({});
    });
});

describe("fitBlueprintGroupFrame", () => {
    it("closes the frame around the cards it holds", () => {
        const frame = box("frame", 0, 0, 900, 900);
        const fitted = fitBlueprintGroupFrame(frame, [frame, box("a", 200, 200), box("far", 2000, 2000)]);

        expect(fitted).toEqual({
            x: 200 - PAD.left,
            y: 200 - PAD.top,
            width: 200 + PAD.left + PAD.right,
            height: 100 + PAD.top + PAD.bottom,
        });
    });

    it("collapses an empty group where it stands", () => {
        const frame = box("frame", 40, 60, 900, 900);
        const fitted = fitBlueprintGroupFrame(frame, [frame, box("outside", 2000, 2000)]);

        expect(fitted).toEqual({
            x: 40,
            y: 60,
            width: BLUEPRINT_GROUP_MIN_WIDTH,
            height: BLUEPRINT_GROUP_MIN_HEIGHT,
        });
    });

    it("takes a nested group in with it, so the inner frame stays enclosed", () => {
        const frame = box("frame", 0, 0, 900, 900);
        const inner = box("inner", 300, 300, 260, 200);
        const fitted = fitBlueprintGroupFrame(frame, [frame, inner, box("deep", 320, 340, 200, 100)]);

        expect(fitted.x).toBe(inner.x - PAD.left);
        expect(fitted.width).toBe(inner.width + PAD.left + PAD.right);
    });
});
