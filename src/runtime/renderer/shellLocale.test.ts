// @vitest-environment jsdom
/**
 * The shell's language: the game's while one is known, recorded for the pages after this one, and the
 * machine's otherwise.
 *
 * The seam half drives the real publishers - the holder `GameApp` writes the game's language into and
 * the runtime language source it installs - for the reason `documentLanguageSeam.test` does: a fake
 * publisher would pass while the real one is wired to something else.
 *
 * Comments in English per project convention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ShellLocaleModule = typeof import("./shellLocale");

/** A page loading: the module reads the record once, as it does in a fresh renderer. */
async function freshPage(): Promise<ShellLocaleModule> {
    vi.resetModules();
    return import("./shellLocale");
}

beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/index.html");
});

afterEach(() => {
    localStorage.clear();
});

describe("the shell's language", () => {
    it("is the machine's on a page no game has recorded anything for", async () => {
        const page = await freshPage();
        // jsdom reports en-US.
        expect(page.getShellLocale()).toBe("en");
    });

    it("is the game's once the game says so, and the next page starts in it", async () => {
        const page = await freshPage();
        page.setShellGameLocale("ja");
        expect(page.getShellLocale()).toBe("ja");

        // A renderer that replaced a dead one, the next launch, another tab: none of them has run
        // the game, and all of them read the record while loading.
        const next = await freshPage();
        expect(next.getShellLocale()).toBe("ja");
    });

    it("follows a change, and the record follows with it", async () => {
        const page = await freshPage();
        page.setShellGameLocale("ja");
        page.setShellGameLocale("zh");
        expect(page.getShellLocale()).toBe("zh");
        expect((await freshPage()).getShellLocale()).toBe("zh");
    });

    it("goes back to the machine's for a game whose languages Studio has no catalogue for", async () => {
        const page = await freshPage();
        page.setShellGameLocale("ja");
        page.setShellGameLocale(null);
        expect(page.getShellLocale()).toBe("en");
        expect((await freshPage()).getShellLocale()).toBe("en");
    });

    it("ignores a language this bundle cannot draw, recorded or handed in", async () => {
        localStorage.setItem("narraleaf.shellLanguage:/", "fr");
        const page = await freshPage();
        expect(page.getShellLocale()).toBe("en");
        page.setShellGameLocale("fr");
        expect(page.getShellLocale()).toBe("en");
    });

    it("keeps two exports on one web origin apart", async () => {
        window.history.replaceState(null, "", "/first/index.html");
        (await freshPage()).setShellGameLocale("ja");
        window.history.replaceState(null, "", "/second/index.html");
        const second = await freshPage();
        expect(second.getShellLocale()).toBe("en");
        second.setShellGameLocale("zh");
        window.history.replaceState(null, "", "/first/index.html");
        expect((await freshPage()).getShellLocale()).toBe("ja");
    });

    it("tells its subscribers when the answer changes, and only then", async () => {
        const page = await freshPage();
        const heard: string[] = [];
        const stop = page.subscribeShellLocale(() => heard.push(page.getShellLocale()));
        page.setShellGameLocale("ja");
        page.setShellGameLocale("ja");
        page.setShellGameLocale("zh");
        stop();
        page.setShellGameLocale("ja");
        expect(heard).toEqual(["ja", "zh"]);
    });

    it("still speaks the game's language when origin storage refuses", async () => {
        const page = await freshPage();
        const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new Error("QuotaExceededError");
        });
        page.setShellGameLocale("ja");
        expect(page.getShellLocale()).toBe("ja");
        setItem.mockRestore();
    });
});

describe("following the running game", () => {
    it("records nothing until the game publishes, so the last run's language survives the boot", async () => {
        const page = await freshPage();
        page.setShellGameLocale("ja");
        const next = await freshPage();
        let reads = 0;
        next.followGameShellLocale({
            read: () => {
                reads += 1;
                return null;
            },
            subscribe: () => () => undefined,
        });
        expect(reads).toBe(0);
        expect(next.getShellLocale()).toBe("ja");
    });

    it("takes the language the game publishes, resolved as the game's own Studio words are", async () => {
        const page = await freshPage();
        const fonts = await import("@shared/typography/projectFonts");
        const runtime = await import("@/lib/ui-editor/runtime/localization/runtimeLocale");
        const words = await import("@/lib/ui-editor/runtime/localization/playerWords");
        const stop = page.followGameShellLocale({
            read: words.runningGamePlayerWordsLocale,
            subscribe: fonts.subscribeActiveProjectLocale,
        });

        let current = "ja";
        const uninstall = runtime.setRuntimeLocaleSource({
            getLocale: () => current,
            sourceLocale: "zh",
            // A language Studio has no catalogue for falls back the way the project says it does.
            locales: [
                { code: "zh", displayName: "中文" },
                { code: "ja", displayName: "日本語" },
                { code: "fr", displayName: "Français", fallback: "ja" },
            ],
        });
        fonts.setActiveProjectLocale(current);
        expect(page.getShellLocale()).toBe("ja");

        current = "fr";
        fonts.setActiveProjectLocale(current);
        expect(page.getShellLocale()).toBe("ja");

        current = "zh";
        fonts.setActiveProjectLocale(current);
        expect(page.getShellLocale()).toBe("zh");

        // The game coming down - a crash unmounts it - says nothing new, so the screen drawn next is
        // still in the language the player was reading.
        uninstall();
        expect(page.getShellLocale()).toBe("zh");

        stop();
        fonts.setActiveProjectLocale("");
    });
});
