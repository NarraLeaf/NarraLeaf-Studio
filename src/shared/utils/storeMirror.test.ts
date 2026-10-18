import { describe, expect, it } from "vitest";
import { gitCodeUrlFor } from "./storeMirror";

describe("gitCodeUrlFor", () => {
    it("reads a catalogue through GitCode's raw-file API", () => {
        expect(gitCodeUrlFor("https://raw.githubusercontent.com/NarraLeaf/Plugins/master/index.json"))
            .toBe("https://api.gitcode.com/api/v5/repos/NarraLeaf/Plugins/raw/index.json?ref=master");
        expect(gitCodeUrlFor("https://raw.githubusercontent.com/NarraLeaf/UI-Templates/master/index.json"))
            .toBe("https://api.gitcode.com/api/v5/repos/NarraLeaf/UI-Templates/raw/index.json?ref=master");
        expect(gitCodeUrlFor("https://raw.githubusercontent.com/NarraLeaf/Dictionaries/master/zh.txt.gz"))
            .toBe("https://api.gitcode.com/api/v5/repos/NarraLeaf/Dictionaries/raw/zh.txt.gz?ref=master");
    });

    it("keeps a nested path and carries a tag ref with @ as a query value", () => {
        expect(gitCodeUrlFor(
            "https://raw.githubusercontent.com/NarraLeaf/Plugins/narraleaf.performance-inspector%400.2.0/plugins/narraleaf.performance-inspector/icon.png",
        )).toBe(
            "https://api.gitcode.com/api/v5/repos/NarraLeaf/Plugins/raw/plugins/narraleaf.performance-inspector/icon.png?ref=narraleaf.performance-inspector%400.2.0",
        );
        expect(gitCodeUrlFor("https://raw.githubusercontent.com/NarraLeaf/UI-Templates/master/themes/narraleaf.coffee/preview.png"))
            .toBe("https://api.gitcode.com/api/v5/repos/NarraLeaf/UI-Templates/raw/themes/narraleaf.coffee/preview.png?ref=master");
    });

    it("maps GitHub's /raw/ form the same way", () => {
        expect(gitCodeUrlFor("https://github.com/NarraLeaf/Dictionaries/raw/master/en.txt.gz"))
            .toBe("https://api.gitcode.com/api/v5/repos/NarraLeaf/Dictionaries/raw/en.txt.gz?ref=master");
    });

    it("puts a release file at the same path on gitcode.com, with @ written out and no query string", () => {
        expect(gitCodeUrlFor(
            "https://github.com/NarraLeaf/Plugins/releases/download/helloyork.nekolang-i18n%401.3.0/helloyork.nekolang-i18n-1.3.0.zip",
        )).toBe(
            "https://gitcode.com/NarraLeaf/Plugins/releases/download/helloyork.nekolang-i18n@1.3.0/helloyork.nekolang-i18n-1.3.0.zip",
        );
    });

    it("sends a release page to GitCode's release page", () => {
        expect(gitCodeUrlFor("https://github.com/NarraLeaf/Plugins/releases/tag/narraleaf.steam-achievements%400.2.1"))
            .toBe("https://gitcode.com/NarraLeaf/Plugins/releases/narraleaf.steam-achievements@0.2.1");
    });

    it("matches the owner and repository without regard to case, and writes GitCode's spelling", () => {
        expect(gitCodeUrlFor("https://raw.githubusercontent.com/narraleaf/plugins/master/index.json"))
            .toBe("https://api.gitcode.com/api/v5/repos/NarraLeaf/Plugins/raw/index.json?ref=master");
    });

    it("leaves every address that is not a file of a mirrored repository alone", () => {
        const untouched = [
            // Studio's own releases are mirrored by a different job, under their own rules.
            "https://github.com/NarraLeaf/NarraLeaf-Studio/releases/download/v1.4.5/latest.yml",
            // A plugin's homepage, a third-party icon host.
            "https://github.com/NarraLeaf/Plugins/tree/master/plugins/x",
            "https://cdn.example.com/icon.png",
            "https://github.com/someone/Plugins/releases/download/a%401.0.0/a.zip",
            // Not https, not a URL, too short to name a file.
            "http://raw.githubusercontent.com/NarraLeaf/Plugins/master/index.json",
            "not a url",
            "https://raw.githubusercontent.com/NarraLeaf/Plugins/master",
            "https://raw.githubusercontent.com/NarraLeaf/Plugins/master/",
            "https://github.com/NarraLeaf/Plugins/releases/download/only-a-tag",
        ];
        for (const url of untouched) {
            expect(gitCodeUrlFor(url)).toBe(url);
        }
    });
});
