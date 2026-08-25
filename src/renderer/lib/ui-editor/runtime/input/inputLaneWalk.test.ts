import { describe, expect, it } from "vitest";
import type { UISurfaceInputMode } from "@shared/types/ui-editor/inputAction";
import { orderInputLanes, walkInputLanes, type UIInputLaneDescriptor, type UIInputLaneHost } from "./inputLaneWalk";

function lane(key: string, host: UIInputLaneHost, depth: number, input: UISurfaceInputMode): UIInputLaneDescriptor {
    return { key, host, depth, input };
}

/** A walk that records who was asked, with a fixed set of lanes that consume. */
async function walk(lanes: readonly UIInputLaneDescriptor[], consuming: readonly string[] = []) {
    const asked: string[] = [];
    const outcome = await walkInputLanes(lanes, laneUnderTest => {
        asked.push(laneUnderTest.key);
        return { consumed: consuming.includes(laneUnderTest.key) };
    });
    return { asked, outcome };
}

describe("orderInputLanes", () => {
    it("puts the page stack in front of the stage slots", () => {
        const ordered = orderInputLanes([
            lane("dialog", "stageSlot", 1, "capture"),
            lane("menu", "page", 0, "capture"),
        ]);

        expect(ordered.map(entry => entry.key)).toEqual(["menu", "dialog"]);
    });

    it("keeps each host's own stack in its own order, nearest first", () => {
        const ordered = orderInputLanes([
            lane("under", "page", 0, "capture"),
            lane("over", "page", 1, "capture"),
            lane("onStage", "stageSlot", 0, "capture"),
            lane("dialog", "stageSlot", 2, "capture"),
        ]);

        expect(ordered.map(entry => entry.key)).toEqual(["over", "under", "dialog", "onStage"]);
    });

    it("leaves lanes it cannot tell apart in the order it was given them", () => {
        const ordered = orderInputLanes([
            lane("first", "page", 0, "capture"),
            lane("second", "page", 0, "capture"),
        ]);

        expect(ordered.map(entry => entry.key)).toEqual(["first", "second"]);
    });
});

describe("walkInputLanes", () => {
    it("never asks a lane that takes no input", async () => {
        const { asked, outcome } = await walk([
            lane("overlay", "page", 1, "none"),
            lane("menu", "page", 0, "capture"),
        ]);

        expect(asked).toEqual(["menu"]);
        expect(outcome.stoppedAt?.key).toBe("menu");
    });

    it("carries on behind a lane that passes", async () => {
        const { asked, outcome } = await walk([
            lane("hud", "page", 0, "pass"),
            lane("dialog", "stageSlot", 0, "capture"),
        ]);

        expect(asked).toEqual(["hud", "dialog"]);
        expect(outcome.stoppedBy).toBe("capture");
    });

    it("stops at a lane that captures, even with nothing behind it listening", async () => {
        const { asked, outcome } = await walk([
            lane("menu", "page", 0, "capture"),
            lane("dialog", "stageSlot", 0, "capture"),
        ]);

        expect(asked).toEqual(["menu"]);
        expect(outcome.stoppedAt?.key).toBe("menu");
        expect(outcome.stoppedBy).toBe("capture");
    });

    it("stops where an action consumed the input, mode notwithstanding", async () => {
        const { asked, outcome } = await walk(
            [lane("hud", "page", 0, "pass"), lane("dialog", "stageSlot", 0, "capture")],
            ["hud"],
        );

        expect(asked).toEqual(["hud"]);
        expect(outcome.stoppedBy).toBe("consume");
    });

    it("runs out of lanes when every one of them passes", async () => {
        const { asked, outcome } = await walk([
            lane("hud", "page", 0, "pass"),
            lane("dialog", "stageSlot", 0, "pass"),
        ]);

        expect(asked).toEqual(["hud", "dialog"]);
        expect(outcome.stoppedAt).toBeNull();
        expect(outcome.stoppedBy).toBeNull();
    });

    it("asks nothing when nothing takes input", async () => {
        const { asked, outcome } = await walk([lane("hud", "page", 0, "none")]);

        expect(asked).toEqual([]);
        expect(outcome.asked).toEqual([]);
    });
});
