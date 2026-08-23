import { describe, expect, it } from "vitest";
import {
    BLUEPRINT_COMMENT_DEFAULT_HEIGHT,
    BLUEPRINT_COMMENT_DEFAULT_WIDTH,
    readBlueprintCommentSize,
} from "./blueprintCommentGeometry";

const DEFAULTS = { width: BLUEPRINT_COMMENT_DEFAULT_WIDTH, height: BLUEPRINT_COMMENT_DEFAULT_HEIGHT };

describe("readBlueprintCommentSize", () => {
    it("reads a stored size", () => {
        expect(readBlueprintCommentSize({ width: 640, height: 320 })).toEqual({ width: 640, height: 320 });
    });

    it("falls back for a comment that was never resized", () => {
        expect(readBlueprintCommentSize({})).toEqual(DEFAULTS);
        expect(readBlueprintCommentSize(undefined)).toEqual(DEFAULTS);
    });

    it("falls back rather than producing an unusable frame", () => {
        expect(readBlueprintCommentSize({ width: 0, height: -10 })).toEqual(DEFAULTS);
        expect(readBlueprintCommentSize({ width: "wide", height: Number.NaN })).toEqual(DEFAULTS);
        expect(readBlueprintCommentSize({ width: null, height: Number.POSITIVE_INFINITY })).toEqual(DEFAULTS);
    });

    it("takes a numeric string, which is what a number field can leave behind", () => {
        expect(readBlueprintCommentSize({ width: "480", height: "240" })).toEqual({ width: 480, height: 240 });
    });
});
