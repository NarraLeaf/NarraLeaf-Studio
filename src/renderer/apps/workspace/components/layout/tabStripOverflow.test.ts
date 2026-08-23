import { describe, expect, it } from "vitest";
import { tabStripOverflow } from "./tabStripOverflow";

describe("tabStripOverflow", () => {
    it("reports no clipped edge when the tabs fit", () => {
        expect(tabStripOverflow({ scrollLeft: 0, clientWidth: 800, scrollWidth: 800 })).toEqual({
            left: false,
            right: false,
        });
    });

    it("reports the right edge at the start of an overflowing strip", () => {
        expect(tabStripOverflow({ scrollLeft: 0, clientWidth: 400, scrollWidth: 900 })).toEqual({
            left: false,
            right: true,
        });
    });

    it("reports the left edge at the end of an overflowing strip", () => {
        expect(tabStripOverflow({ scrollLeft: 500, clientWidth: 400, scrollWidth: 900 })).toEqual({
            left: true,
            right: false,
        });
    });

    it("reports both edges in the middle", () => {
        expect(tabStripOverflow({ scrollLeft: 250, clientWidth: 400, scrollWidth: 900 })).toEqual({
            left: true,
            right: true,
        });
    });

    it("ignores a sub-pixel overflow from fractional tab widths", () => {
        expect(tabStripOverflow({ scrollLeft: 0.5, clientWidth: 800, scrollWidth: 800.5 })).toEqual({
            left: false,
            right: false,
        });
    });
});
