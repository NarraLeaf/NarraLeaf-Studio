import { describe, expect, it } from "vitest";
import { resolveScriptModuleUrl } from "./scriptRuntime";

/*
 * A packaged game's bundle names each compiled script relative to its page, and the page is served
 * from a different place by each shell: the runtime scheme on the desktop, the author's own host for
 * a web export, a WebView's loader inside a mobile shell. The name used to be the desktop scheme
 * spelled out, which no browser can import - every script in a web export was dead.
 */
describe("the URL a compiled script is imported from", () => {
    const name = "scripts/scripts_title.js";

    it("is the runtime's own file on the desktop", () => {
        expect(resolveScriptModuleUrl(name, "nlgame://runtime/index.html?nlpolicy=details"))
            .toBe("nlgame://runtime/scripts/scripts_title.js");
    });

    it("is the site's own file in a web export, wherever the site is", () => {
        expect(resolveScriptModuleUrl(name, "https://example.com/games/lantern/index.html"))
            .toBe("https://example.com/games/lantern/scripts/scripts_title.js");
        expect(resolveScriptModuleUrl(name, "https://example.com/games/lantern/"))
            .toBe("https://example.com/games/lantern/scripts/scripts_title.js");
    });

    it("is Dev Mode's file URL, untouched", () => {
        const devMode = "file:///D:/Projects/lantern/.nlstudio/dev-mode/scripts/scripts_title.js";
        expect(resolveScriptModuleUrl(devMode, "file:///C:/Studio/dist/windows/dev-mode/index.html")).toBe(devMode);
    });

    it("is the name itself when there is no page to resolve against", () => {
        expect(resolveScriptModuleUrl(name, undefined)).toBe(name);
    });
});
