import { describe, expect, it } from "vitest";
import { variantOverrideIdFor } from "./enteredStateContext";

describe("variantOverrideIdFor", () => {
    it("reads runtime overrides in order while nothing is entered", () => {
        expect(variantOverrideIdFor(null, null, "runtime")).toBe("runtime");
        expect(variantOverrideIdFor(null, "row", "runtime")).toBe("row");
        expect(variantOverrideIdFor(null, null, undefined)).toBeNull();
    });

    it("lets an entered state win over every runtime override", () => {
        expect(variantOverrideIdFor({ variantId: "on" }, "row", "runtime")).toBe("on");
    });

    it("holds an element at rest when the entered state is the resting one", () => {
        // The switch part's own override says `on`; the author is looking at the resting state and
        // must see it, or the canvas disagrees with the bar that put them there.
        expect(variantOverrideIdFor({ variantId: null }, "on")).toBeNull();
    });
});
