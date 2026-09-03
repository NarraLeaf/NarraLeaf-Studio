/**
 * The list's item flow: which way items run, which way the box scrolls, and how a wrap breaks.
 *
 * Held here rather than through the renderer because the three answers are one decision, and the
 * one that used to be wrong was silent: a wrapping list that still scrolled along the axis its
 * items no longer run off has nothing to scroll, and the lines it grows instead are clipped.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";
import { resolveListRepeatLayout } from "./helpers";
import type { ListWidgetProps } from "./types";

type Flow = Pick<ListWidgetProps, "repeatDirection" | "repeatWrap" | "writingMode" | "itemGap">;

function flow(partial: Partial<Flow>): Flow {
    return {
        repeatDirection: "vertical",
        repeatWrap: false,
        writingMode: "horizontal-tb",
        itemGap: 8,
        ...partial,
    };
}

describe("resolveListRepeatLayout", () => {
    it("scrolls along the axis the items run, while they stay on one line", () => {
        expect(resolveListRepeatLayout(flow({ repeatDirection: "vertical" })).overflowIsHorizontal).toBe(false);
        expect(resolveListRepeatLayout(flow({ repeatDirection: "horizontal" })).overflowIsHorizontal).toBe(true);
    });

    it("scrolls across that axis once the items wrap", () => {
        // Items stop at the edge of the box instead of running past it, so the repeat axis has
        // nothing left to scroll; what grows is the stack of lines across it.
        expect(
            resolveListRepeatLayout(flow({ repeatDirection: "horizontal", repeatWrap: true })).overflowIsHorizontal,
        ).toBe(false);
        expect(
            resolveListRepeatLayout(flow({ repeatDirection: "vertical", repeatWrap: true })).overflowIsHorizontal,
        ).toBe(true);
    });

    it("reads the direction against the writing mode, wrapped or not", () => {
        // `vertical` is the block axis, which runs across the screen in a vertical writing mode.
        expect(
            resolveListRepeatLayout(flow({ repeatDirection: "vertical", writingMode: "vertical-rl" }))
                .overflowIsHorizontal,
        ).toBe(true);
        expect(
            resolveListRepeatLayout(
                flow({ repeatDirection: "vertical", writingMode: "vertical-rl", repeatWrap: true }),
            ).overflowIsHorizontal,
        ).toBe(false);
    });

    it("leaves a list that does not wrap laid out exactly as it was", () => {
        expect(resolveListRepeatLayout(flow({ repeatDirection: "horizontal", itemGap: 12 })).flexHostStyle).toEqual({
            display: "flex",
            flexDirection: "row",
            gap: 12,
            alignItems: "stretch",
            minWidth: 0,
            minHeight: "100%",
        });
    });

    it("packs wrapped lines from the start, and fills the box only across them", () => {
        const style = resolveListRepeatLayout(flow({ repeatDirection: "horizontal", repeatWrap: true })).flexHostStyle;

        expect(style.flexWrap).toBe("wrap");
        // Without this the lines sit at opposite ends of the box rather than `itemGap` apart.
        expect(style.alignContent).toBe("flex-start");
        // A row of items already fills the inline axis, so only the axis the lines grow along is stated.
        expect(style.minBlockSize).toBe("100%");
        expect(style.blockSize).toBeUndefined();
    });

    it("gives a wrapping column of items a main size to break against", () => {
        const style = resolveListRepeatLayout(flow({ repeatDirection: "vertical", repeatWrap: true })).flexHostStyle;

        // A block box does not fill the block axis on its own, so a column would grow for ever
        // instead of breaking.
        expect(style.blockSize).toBe("100%");
        expect(style.minInlineSize).toBe("100%");
    });
});
