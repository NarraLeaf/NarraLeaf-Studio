import { describe, expect, it } from "vitest";
import {
    DEFAULT_VOICE_NAMING_PATTERN,
    isVoiceEnabled,
    normalizeVoiceConfiguration,
    normalizeVoiceDocument,
} from "./voice";

describe("normalizeVoiceConfiguration", () => {
    it("defaults an absent config to empty languages, the default pattern, and empty cast", () => {
        expect(normalizeVoiceConfiguration(undefined)).toEqual({
            voicedLocales: [],
            namingPattern: DEFAULT_VOICE_NAMING_PATTERN,
            cast: {},
        });
    });

    it("drops invalid/duplicate locales and keeps a custom naming pattern", () => {
        const config = normalizeVoiceConfiguration({
            voicedLocales: [
                { code: "ja", displayName: "日本語" },
                { code: "ja", displayName: "dup" },
                { code: "!!", displayName: "bad" },
                { code: "en" },
            ],
            namingPattern: "{unit}",
        });
        expect(config.voicedLocales).toEqual([
            { code: "ja", displayName: "日本語" },
            { code: "en", displayName: "en" },
        ]);
        expect(config.namingPattern).toBe("{unit}");
    });

    it("normalizes cast, dropping bad locale codes and empty names", () => {
        const config = normalizeVoiceConfiguration({
            voicedLocales: [{ code: "ja", displayName: "日本語" }],
            cast: {
                "char-1": { ja: "Sora Amamiya", en: "  ", "!!": "bad" },
                "char-2": { ja: "" },
                bogus: "not-an-object",
            },
        });
        expect(config.cast).toEqual({ "char-1": { ja: "Sora Amamiya" } });
    });
});

describe("isVoiceEnabled", () => {
    it("is true only once a voice language exists", () => {
        expect(isVoiceEnabled(normalizeVoiceConfiguration(undefined))).toBe(false);
        expect(isVoiceEnabled(normalizeVoiceConfiguration({ voicedLocales: [{ code: "ja", displayName: "日本語" }] }))).toBe(true);
    });
});

describe("normalizeVoiceDocument", () => {
    it("keeps only units with an asset id and coerces the status", () => {
        const document = normalizeVoiceDocument({
            units: {
                "t-1": { assetId: "a1", sourceHash: "h", status: "approved" },
                "t-2": { assetId: "a2", sourceHash: "h", status: "bogus" },
                "t-3": { sourceHash: "h", status: "linked" },
                "t-4": { assetId: "", status: "linked" },
            },
        }, "ja");
        expect(Object.keys(document.units).sort()).toEqual(["t-1", "t-2"]);
        expect(document.units["t-1"].status).toBe("approved");
        expect(document.units["t-2"].status).toBe("linked");
    });
});
