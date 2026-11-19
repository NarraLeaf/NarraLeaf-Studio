import { describe, expect, it } from "vitest";

import { playtestAnchor, playtestBody } from "./TeamPlaytestFeedbackPrompt";

describe("playtest notes", () => {
    it("are kept beside the line that was playing, as a story comment is", () => {
        expect(playtestAnchor({ storyId: "s1", sceneId: "sc", blockId: "b9" })).toEqual({ document: "story:s1", element: "sc/b9" });
    });

    it("are kept beside the project when nothing was playing", () => {
        expect(playtestAnchor(null)).toEqual({ document: "playtest" });
    });

    it("carry the picture's marker after what was written, or alone", () => {
        const id = "0b8c1c52-7d0e-4a39-9f43-2a1b6f0c9d11";
        expect(playtestBody("  the music cuts out  ", id)).toBe(`the music cuts out\n\n[[attachment:${id}]]`);
        expect(playtestBody("   ", id)).toBe(`[[attachment:${id}]]`);
    });
});
