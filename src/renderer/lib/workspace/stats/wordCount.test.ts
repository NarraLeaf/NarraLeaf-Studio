import { describe, expect, it } from "vitest";
import { countWords } from "./wordCount";

describe("countWords", () => {
    it("counts each supplementary-plane ideograph separately", () => {
        expect(countWords("𠀀𠀀𠀀")).toBe(3);
        expect(countWords("𠀀𰀀丽")).toBe(3);
    });

    it("counts mixed CJK characters and Latin words once each", () => {
        expect(countWords("中文𠀀abc𰀀 go!")).toBe(6);
        expect(countWords("かな가 Don't stop well-known words.")).toBe(7);
    });

    it("ignores punctuation and empty text", () => {
        expect(countWords("")).toBe(0);
        expect(countWords("！…💬")).toBe(0);
    });
});
