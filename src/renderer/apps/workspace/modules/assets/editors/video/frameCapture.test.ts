import { describe, expect, it } from "vitest";
import { frameCaptureName } from "./frameCapture";

describe("frameCaptureName", () => {
    it("names the frame after the clip and the time", () => {
        expect(frameCaptureName("opening.mp4", 3240)).toBe("opening_0m03.240s.png");
        expect(frameCaptureName("ed", 125_005)).toBe("ed_2m05.005s.png");
    });

    it("keeps dots that are part of the name", () => {
        expect(frameCaptureName("ch1.intro.webm", 0)).toBe("ch1.intro_0m00.000s.png");
    });

    it("falls back when nothing is left of the name", () => {
        expect(frameCaptureName(".mp4", 1000)).toBe("frame_0m01.000s.png");
    });
});
