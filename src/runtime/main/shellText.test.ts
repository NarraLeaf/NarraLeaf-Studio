import { describe, expect, it } from "vitest";
import { resolveShellText } from "./shellText";

describe("the language a shipped game reports a failure in", () => {
    it("is the machine's, walked in preference order", () => {
        expect(resolveShellText(["ja-JP", "en-US"]).locale).toBe("ja");
        expect(resolveShellText(["fr-FR", "zh-CN"]).locale).toBe("zh");
    });

    it("is English where the machine asks for nothing this shell has", () => {
        expect(resolveShellText(["fr-FR"]).locale).toBe("en");
        expect(resolveShellText([]).locale).toBe("en");
    });
});

describe("what it says", () => {
    it("keeps Chromium's reason and exit code verbatim inside the translated frame", () => {
        // They are identifiers. A player hands this to whoever can read it, and a translated
        // "crashed" is one more thing that person has to translate back.
        const ja = resolveShellText(["ja"]).displayProcessExited("oom", 9);
        expect(ja).toContain("oom");
        expect(ja).toContain("9");
        expect(ja).not.toBe(resolveShellText(["en"]).displayProcessExited("oom", 9));
    });

    it("names the log file in every language, because that is the one thing a player can act on", () => {
        for (const tags of [["en"], ["zh"], ["ja"]]) {
            expect(resolveShellText(tags).logAt("C:\logs\game.log")).toContain("C:\logs\game.log");
        }
    });

    it("tells the two forms of a preview apart, in every language", () => {
        // Which one is running decides whether an asset has a file path and which runtime files can
        // be read at all, so a title that named neither would leave the author to guess.
        for (const tags of [["en"], ["zh"], ["ja"]]) {
            const text = resolveShellText(tags);
            expect(text.previewTitle("Tiny Shadows", false)).toContain("Tiny Shadows");
            expect(text.previewTitle("Tiny Shadows", true)).toContain("Tiny Shadows");
            expect(text.previewTitle("Tiny Shadows", true)).not.toBe(text.previewTitle("Tiny Shadows", false));
        }
    });

    it("offers both answers to a hung window, in the same language", () => {
        const text = resolveShellText(["zh-CN"]);
        expect(text.hangKeepWaiting).toBe("继续等待");
        expect(text.hangRestart).toBe("重新启动");
    });
});
