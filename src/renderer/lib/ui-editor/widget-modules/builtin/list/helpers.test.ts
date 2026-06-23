import { describe, expect, it } from "vitest";
import { resolveListItemContentAlignmentStyle } from "./helpers";

describe("resolveListItemContentAlignmentStyle", () => {
    it("right-aligns horizontal template content for a left vertical scrollbar", () => {
        expect(resolveListItemContentAlignmentStyle(true, "horizontal")).toEqual({
            justifyContent: "flex-end",
        });
    });

    it("right-aligns vertical template content for a left vertical scrollbar", () => {
        expect(resolveListItemContentAlignmentStyle(true, "vertical")).toEqual({
            alignItems: "flex-end",
        });
    });

    it("does not change content alignment for non-left scrollbar placements", () => {
        expect(resolveListItemContentAlignmentStyle(false, "horizontal")).toEqual({});
        expect(resolveListItemContentAlignmentStyle(false, "vertical")).toEqual({});
    });
});
