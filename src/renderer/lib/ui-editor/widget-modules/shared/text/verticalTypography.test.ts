import { describe, expect, it } from "vitest";
import {
    isVerticalWritingMode,
    needsTateChuYokoSegments,
    normalizeVerticalTypography,
    segmentVerticalText,
    textBodyInlineSizeCss,
    verticalTypographyCss,
} from "./verticalTypography";
import { getTextProps } from "@/lib/ui-editor/widget-modules/builtin/text/helpers";

describe("vertical typography settings", () => {
    it("falls back to horizontal for anything it does not recognise", () => {
        expect(normalizeVerticalTypography(undefined)).toEqual({
            writingMode: "horizontal-tb",
            textOrientation: "mixed",
            tateChuYoko: true,
            tateChuYokoMaxLength: 2,
        });
        expect(
            normalizeVerticalTypography({
                writingMode: "sideways-rl" as never,
                textOrientation: "diagonal" as never,
            }),
        ).toMatchObject({ writingMode: "horizontal-tb", textOrientation: "mixed" });
    });

    it("clamps the combined run length to something readable", () => {
        expect(normalizeVerticalTypography({ tateChuYokoMaxLength: 0 }).tateChuYokoMaxLength).toBe(1);
        expect(normalizeVerticalTypography({ tateChuYokoMaxLength: 99 }).tateChuYokoMaxLength).toBe(4);
        expect(normalizeVerticalTypography({ tateChuYokoMaxLength: 2.4 }).tateChuYokoMaxLength).toBe(2);
        expect(normalizeVerticalTypography({ tateChuYokoMaxLength: NaN }).tateChuYokoMaxLength).toBe(2);
    });

    it("emits glyph orientation only while vertical", () => {
        expect(verticalTypographyCss({ writingMode: "horizontal-tb", textOrientation: "upright" })).toEqual({
            writingMode: "horizontal-tb",
        });
        expect(verticalTypographyCss({ writingMode: "vertical-rl", textOrientation: "upright" })).toEqual({
            writingMode: "vertical-rl",
            textOrientation: "upright",
        });
        expect(isVerticalWritingMode("vertical-lr")).toBe(true);
        expect(isVerticalWritingMode("horizontal-tb")).toBe(false);
    });

    it("sizes the paragraph along its own inline axis", () => {
        expect(textBodyInlineSizeCss("horizontal-tb")).toEqual({ width: "100%" });
        expect(textBodyInlineSizeCss("vertical-rl")).toEqual({ height: "100%", maxHeight: "100%" });
    });

    it("normalises through the text props reader", () => {
        const props = getTextProps({
            id: "t",
            type: "nl.text",
            parentId: null,
            childrenIds: [],
            layout: { x: 0, y: 0, width: 10, height: 10 },
            props: { writingMode: "vertical-rl", tateChuYokoMaxLength: 9 },
        } as never);
        expect(props.writingMode).toBe("vertical-rl");
        expect(props.tateChuYokoMaxLength).toBe(4);
    });
});

describe("tate-chu-yoko segmentation", () => {
    it("combines short digit and Latin runs and leaves the rest alone", () => {
        expect(segmentVerticalText("第12話へようこそ", 2)).toEqual([
            { text: "第", combineUpright: false },
            { text: "12", combineUpright: true },
            { text: "話へようこそ", combineUpright: false },
        ]);
    });

    it("leaves a run longer than the limit in the surrounding text, to be set sideways", () => {
        expect(segmentVerticalText("Hello、世界", 2)).toEqual([{ text: "Hello、世界", combineUpright: false }]);
        expect(segmentVerticalText("Hello、世界", 5)).toEqual([
            { text: "Hello", combineUpright: true },
            { text: "、世界", combineUpright: false },
        ]);
    });

    it("keeps a run together across the punctuation inside it", () => {
        // Over the limit, so the run is not split at the hyphen to fit - it stays in one
        // uncombined segment and CSS lays the whole thing sideways.
        expect(segmentVerticalText("PC-98の話", 4)).toEqual([{ text: "PC-98の話", combineUpright: false }]);
        expect(segmentVerticalText("PC-98の話", 5)).toEqual([
            { text: "PC-98", combineUpright: true },
            { text: "の話", combineUpright: false },
        ]);
    });

    it("asks for no split when nothing would be combined", () => {
        const vertical = { writingMode: "vertical-rl", textOrientation: "mixed", tateChuYoko: true, tateChuYokoMaxLength: 2 } as const;
        expect(needsTateChuYokoSegments("第12話", vertical)).toBe(true);
        expect(needsTateChuYokoSegments("こんにちは", vertical)).toBe(false);
        expect(needsTateChuYokoSegments("第12話", { ...vertical, tateChuYoko: false })).toBe(false);
        expect(needsTateChuYokoSegments("第12話", { ...vertical, textOrientation: "sideways" })).toBe(false);
        expect(needsTateChuYokoSegments("第12話", { ...vertical, writingMode: "horizontal-tb" })).toBe(false);
    });
});
