import { describe, expect, it } from "vitest";
import { voiceSpeakerWord, voiceSpeakerWordLocaleFor, voiceSpeakerWordsInEveryLanguage } from "./voiceSpeakerWords";

describe("the word a recording name spells for narration and options", () => {
    it("is the project's source language's, whatever language Studio is in", () => {
        expect(voiceSpeakerWord("narration", "zh-CN")).toBe("旁白");
        expect(voiceSpeakerWord("narration", "ja")).toBe("地の文");
        expect(voiceSpeakerWord("narration", "en-US")).toBe("Narration");
        expect(voiceSpeakerWord("choice", "zh")).toBe("选项");
    });

    it("is English for a language Studio has no words for, and for no language", () => {
        for (const locale of ["fr", "", null, undefined]) {
            expect(voiceSpeakerWordLocaleFor(locale)).toBe("en");
            expect(voiceSpeakerWord("narration", locale)).toBe("Narration");
        }
    });

    it("is matched in every language Studio has", () => {
        expect(voiceSpeakerWordsInEveryLanguage("narration")).toEqual(["Narration", "旁白", "地の文"]);
    });
});
