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

    /**
     * A patch or a DLC this build cannot read. The player installed something and the game is about
     * to be exactly as it was, so the one sentence they get has to arrive in their own language and
     * has to name the files - which is the half they can act on.
     */
    it("names the content it did not apply, in every language", () => {
        for (const tags of [["en"], ["zh"], ["ja"]]) {
            const text = resolveShellText(tags);
            expect(text.contentTooNew.trim().length).toBeGreaterThan(0);
            expect(text.contentNotApplied(["summer_DLC.pak", "fix.assetpatch"]))
                .toContain("summer_DLC.pak");
            expect(text.contentNotApplied(["summer_DLC.pak", "fix.assetpatch"]))
                .toContain("fix.assetpatch");
        }
        // Three different sentences, not one sentence stated three times.
        const said = [["en"], ["zh"], ["ja"]].map(tags => resolveShellText(tags).contentTooNew);
        expect(new Set(said).size).toBe(3);
    });

    it("offers both answers to a hung window, in the same language", () => {
        const text = resolveShellText(["zh-CN"]);
        expect(text.hangKeepWaiting).toBe("继续等待");
        expect(text.hangRestart).toBe("重新启动");
    });
});
