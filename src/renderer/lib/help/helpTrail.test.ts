import { describe, expect, it } from "vitest";
import { currentTopic, popTopic, previousTopic, pushTopic, startTrail } from "./helpTrail";

describe("help trail", () => {
    it("starts at the topic that was asked for, with nowhere back", () => {
        const trail = startTrail("storyScene");
        expect(currentTopic(trail)).toBe("storyScene");
        expect(previousTopic(trail)).toBeUndefined();
    });

    it("remembers where a followed link came from", () => {
        const trail = pushTopic(startTrail("storyScene"), "storyCommands");
        expect(currentTopic(trail)).toBe("storyCommands");
        expect(previousTopic(trail)).toBe("storyScene");
        expect(currentTopic(popTopic(trail))).toBe("storyScene");
    });

    it("walks back one step at a time through a longer trail", () => {
        let trail = startTrail("versionControl");
        trail = pushTopic(trail, "versionViewing");
        trail = pushTopic(trail, "freeze");
        expect(currentTopic(trail)).toBe("freeze");
        trail = popTopic(trail);
        expect(currentTopic(trail)).toBe("versionViewing");
        trail = popTopic(trail);
        expect(currentTopic(trail)).toBe("versionControl");
        expect(previousTopic(trail)).toBeUndefined();
    });

    it("never empties, so back at the start is a no-op", () => {
        const trail = startTrail("assets");
        expect(popTopic(trail)).toBe(trail);
        expect(currentTopic(popTopic(trail))).toBe("assets");
    });

    it("does not push the topic already on screen", () => {
        const trail = pushTopic(startTrail("assets"), "characters");
        expect(pushTopic(trail, "characters")).toBe(trail);
        // A -> B -> A is a real step; only re-opening the current one is not.
        expect(currentTopic(pushTopic(trail, "assets"))).toBe("assets");
        expect(previousTopic(pushTopic(trail, "assets"))).toBe("characters");
    });
});
