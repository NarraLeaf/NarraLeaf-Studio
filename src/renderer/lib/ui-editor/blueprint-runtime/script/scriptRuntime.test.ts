import { afterEach, describe, expect, it } from "vitest";
import {
    mountCompiledScripts,
    resolveScriptHandler,
    resolveScriptModuleUrl,
    unmountCompiledScripts,
} from "./scriptRuntime";

afterEach(() => {
    unmountCompiledScripts();
});

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

describe("script mount ordering", () => {
    it("keeps a newer mount when an older import finishes after it", async () => {
        let finishOld!: (module: Record<string, unknown>) => void;
        const old = mountCompiledScripts(
            { layer: { scriptRef: "old.ts", url: "old" } },
            undefined,
            () => new Promise(resolve => {
                finishOld = resolve;
            }),
        );

        const newer = () => "new";
        await mountCompiledScripts(
            { layer: { scriptRef: "new.ts", url: "new" } },
            undefined,
            async () => ({ onInit: newer }),
        );
        expect(resolveScriptHandler("layer", "init")?.()).toBe("new");

        finishOld({ onInit: () => "old" });
        await old;
        expect(resolveScriptHandler("layer", "init")?.()).toBe("new");
    });

    it("keeps an explicit unmount empty when an import finishes later", async () => {
        let finishPending!: (module: Record<string, unknown>) => void;
        const pending = mountCompiledScripts(
            { layer: { scriptRef: "pending.ts", url: "pending" } },
            undefined,
            () => new Promise(resolve => {
                finishPending = resolve;
            }),
        );

        unmountCompiledScripts();
        expect(resolveScriptHandler("layer", "init")).toBeNull();

        finishPending({ onInit: () => "pending" });
        await pending;
        expect(resolveScriptHandler("layer", "init")).toBeNull();
    });

    it("does not report an obsolete import failure after a newer mount", async () => {
        let failOld!: (error: Error) => void;
        const reported: string[] = [];
        const old = mountCompiledScripts(
            { layer: { scriptRef: "old.ts", url: "old" } },
            (_layer, _ref, message) => reported.push(message),
            () => new Promise((_resolve, reject) => { failOld = reject; }),
        );
        await mountCompiledScripts(
            { layer: { scriptRef: "new.ts", url: "new" } },
            undefined,
            async () => ({ onInit: () => "new" }),
        );
        failOld(new Error("old failed"));
        await old;
        expect(reported).toEqual([]);
        expect(resolveScriptHandler("layer", "init")?.()).toBe("new");
    });
});
