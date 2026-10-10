import { describe, expect, it } from "vitest";
import { describeInvalidEnumProp, findInvalidEnumProps, UI_ENUM_PROP_VALUES } from "./propValues";

describe("props that take one word out of a list", () => {
    it("knows the wrap modes the renderer maps to CSS", () => {
        expect(UI_ENUM_PROP_VALUES.textWrapMode).toEqual(["word", "character", "nowrap"]);
    });

    it("finds a word the list does not have, and a value that is not a word at all", () => {
        expect(findInvalidEnumProps({ textWrapMode: "char", textVerticalAlign: 3, text: "anything" })).toEqual([
            { key: "textWrapMode", value: "char", allowed: ["word", "character", "nowrap"] },
            { key: "textVerticalAlign", value: 3, allowed: ["start", "center", "end"] },
        ]);
    });

    it("leaves absent and null props alone, since both mean the widget's default", () => {
        expect(findInvalidEnumProps({ textWrapMode: null })).toEqual([]);
        expect(findInvalidEnumProps({})).toEqual([]);
        expect(findInvalidEnumProps(undefined)).toEqual([]);
        expect(findInvalidEnumProps({ writingMode: "vertical-rl", textOrientation: "upright" })).toEqual([]);
    });

    it("names the words that are accepted", () => {
        const [problem] = findInvalidEnumProps({ textWrapMode: "char" });
        expect(describeInvalidEnumProp(problem)).toBe('textWrapMode is "char"; it takes one of: word, character, nowrap');
    });
});
