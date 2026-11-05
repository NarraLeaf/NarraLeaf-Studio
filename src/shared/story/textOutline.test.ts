import { describe, expect, it } from "vitest";
import { storyTextOutlineFilter } from "./textOutline";

describe("storyTextOutlineFilter", () => {
    it("draws a 1px outline as one pass of four offset shadows", () => {
        expect(storyTextOutlineFilter({ width: 1, color: "#332e3e" })).toBe(
            "drop-shadow(1px 0 0 #332e3e) drop-shadow(-1px 0 0 #332e3e) drop-shadow(0 1px 0 #332e3e) drop-shadow(0 -1px 0 #332e3e)",
        );
    });

    it("runs one pass per pixel so a wide ring stays solid, capped at the maximum", () => {
        expect(storyTextOutlineFilter({ width: 2, color: "#000" }).match(/drop-shadow/g)).toHaveLength(8);
        expect(storyTextOutlineFilter({ width: 1.5, color: "#000" })).toContain("drop-shadow(0.75px 0 0 #000)");
        expect(storyTextOutlineFilter({ width: 99, color: "#000" }).match(/drop-shadow/g)).toHaveLength(32);
    });

    it("clears the channel for no outline", () => {
        expect(storyTextOutlineFilter(null)).toBe("none");
        expect(storyTextOutlineFilter(undefined)).toBe("none");
        expect(storyTextOutlineFilter({ width: 0, color: "#000" })).toBe("none");
    });
});
