import {afterEach, describe, expect, it, vi} from "vitest";
import {
    getActiveProjectFontIds,
    getActiveProjectFonts,
    getActiveProjectFontsRevision,
    getActiveProjectLocale,
    resolveFontStackIds,
    resolveFontStackIdsForLocale,
    setActiveProjectFonts,
    setActiveProjectLocale,
    subscribeActiveProjectFonts,
} from "./projectFonts";

afterEach(() => {
    setActiveProjectFonts([]);
    setActiveProjectLocale("");
});

describe("setActiveProjectFonts", () => {
    it("publishes what it was given, normalized", () => {
        setActiveProjectFonts([{assetId: " a "}, {assetId: "a"}, {assetId: "b"}]);
        expect(getActiveProjectFontIds()).toEqual(["a", "b"]);
        expect(getActiveProjectFonts()).toEqual([{assetId: "a"}, {assetId: "b"}]);
    });

    /**
     * The hosts push from a document-changed subscription that fires for every edit anywhere in the
     * project. Without the content comparison every keystroke in the story editor would bump the
     * revision and re-resolve the font of every text widget on the canvas.
     */
    it("changes nothing when the content matches", () => {
        setActiveProjectFonts([{assetId: "a"}]);
        const revision = getActiveProjectFontsRevision();
        const listener = vi.fn();
        const unsubscribe = subscribeActiveProjectFonts(listener);

        setActiveProjectFonts([{assetId: "a"}]);
        expect(listener).not.toHaveBeenCalled();
        expect(getActiveProjectFontsRevision()).toBe(revision);

        setActiveProjectFonts([{assetId: "a"}, {assetId: "b"}]);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getActiveProjectFontsRevision()).toBe(revision + 1);
        unsubscribe();
    });

    /** The ids array is a `useSyncExternalStore` snapshot: a new one per read never settles. */
    it("hands back the same ids array until something is published", () => {
        setActiveProjectFonts([{assetId: "a"}]);
        expect(getActiveProjectFontIds()).toBe(getActiveProjectFontIds());
    });
});

describe("resolveFontStackIds", () => {
    it("is the project's stack when nothing was chosen", () => {
        setActiveProjectFonts([{assetId: "a"}, {assetId: "b"}]);
        expect(resolveFontStackIds(null)).toEqual(["a", "b"]);
        expect(resolveFontStackIds("  ")).toEqual(["a", "b"]);
    });

    // The stack is a tail, not an alternative: a widget set in a display face still needs somewhere
    // to go for the characters that face has no glyph for.
    it("puts the chosen font in front of the project's stack", () => {
        setActiveProjectFonts([{assetId: "a"}, {assetId: "b"}]);
        expect(resolveFontStackIds("z")).toEqual(["z", "a", "b"]);
    });

    it("does not repeat a chosen font the stack already carries", () => {
        setActiveProjectFonts([{assetId: "a"}, {assetId: "b"}]);
        expect(resolveFontStackIds("b")).toEqual(["b", "a"]);
    });

    /** A project with no default font renders exactly as it did before the feature existed. */
    it("is the chosen font alone when the project has no stack", () => {
        expect(resolveFontStackIds("z")).toEqual(["z"]);
        expect(resolveFontStackIds(null)).toEqual([]);
    });
});

describe("setActiveProjectLocale", () => {
    const STACK = [
        {assetId: "jp", locales: ["ja"]},
        {assetId: "sc", locales: ["zh-Hans"]},
        {assetId: "serif"},
    ];

    it("narrows the published ids to the rungs that serve the language", () => {
        setActiveProjectFonts(STACK);
        expect(getActiveProjectFontIds()).toEqual(["jp", "sc", "serif"]);

        setActiveProjectLocale("ja");
        expect(getActiveProjectFontIds()).toEqual(["jp", "serif"]);

        setActiveProjectLocale("zh-Hans-CN");
        expect(getActiveProjectFontIds()).toEqual(["sc", "serif"]);

        setActiveProjectLocale("en");
        expect(getActiveProjectFontIds()).toEqual(["serif"]);
    });

    /**
     * The pre-existing behaviour, and what a project with no localization set up must see. A host
     * that has published no language cannot be shown a stack with rungs missing from it.
     */
    it("filters nothing when no language has been published", () => {
        setActiveProjectFonts(STACK);
        setActiveProjectLocale("ja");
        setActiveProjectLocale("");
        expect(getActiveProjectFontIds()).toEqual(["jp", "sc", "serif"]);
    });

    it("leaves the full list on `getActiveProjectFonts`, whatever the language", () => {
        setActiveProjectFonts(STACK);
        setActiveProjectLocale("ja");
        expect(getActiveProjectFonts().map(entry => entry.assetId)).toEqual(["jp", "sc", "serif"]);
        expect(getActiveProjectLocale()).toBe("ja");
    });

    it("does not repaint when the language resolves to the same fonts", () => {
        setActiveProjectFonts([{assetId: "a"}, {assetId: "b"}]);
        const listener = vi.fn();
        const unsubscribe = subscribeActiveProjectFonts(listener);

        // Nothing in this stack is restricted, so every language resolves to the same two fonts.
        setActiveProjectLocale("ja");
        setActiveProjectLocale("en");
        expect(listener).not.toHaveBeenCalled();

        // Restrict one rung and the two languages part company, so the switch does repaint.
        setActiveProjectFonts([{assetId: "a", locales: ["ja"]}, {assetId: "b"}]);
        expect(getActiveProjectFontIds()).toEqual(["b"]);
        listener.mockClear();
        setActiveProjectLocale("ja");
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getActiveProjectFontIds()).toEqual(["a", "b"]);
        unsubscribe();
    });

    /**
     * The stacks resolve identically here, but what `getActiveProjectFonts` answers did change and
     * the Design surface is reading that.
     */
    it("announces a restriction that moved even when the active language sees no difference", () => {
        setActiveProjectFonts([{assetId: "a"}]);
        setActiveProjectLocale("ja");
        const listener = vi.fn();
        const unsubscribe = subscribeActiveProjectFonts(listener);

        setActiveProjectFonts([{assetId: "a", locales: ["ja"]}]);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(getActiveProjectFontIds()).toEqual(["a"]);
        unsubscribe();
    });
});

describe("resolveFontStackIds / language", () => {
    it("resolves a widget's stack in the active language", () => {
        setActiveProjectFonts([{assetId: "jp", locales: ["ja"]}, {assetId: "serif"}]);
        setActiveProjectLocale("en");
        expect(resolveFontStackIds(null)).toEqual(["serif"]);
        setActiveProjectLocale("ja");
        expect(resolveFontStackIds(null)).toEqual(["jp", "serif"]);
    });

    /**
     * A restriction says which language a *default* is for. The author naming a face on a widget has
     * already answered the question it would be filtering, so filtering it would delete their choice.
     */
    it("never drops the font the widget itself chose", () => {
        setActiveProjectFonts([{assetId: "jp", locales: ["ja"]}, {assetId: "serif"}]);
        setActiveProjectLocale("en");
        expect(resolveFontStackIds("jp")).toEqual(["jp", "serif"]);
    });

    it("answers for a language that is not the active one", () => {
        setActiveProjectFonts([{assetId: "jp", locales: ["ja"]}, {assetId: "serif"}]);
        setActiveProjectLocale("en");
        expect(resolveFontStackIdsForLocale(null, "ja")).toEqual(["jp", "serif"]);
        expect(resolveFontStackIdsForLocale(null, "")).toEqual(["jp", "serif"]);
        expect(resolveFontStackIdsForLocale("z", "en")).toEqual(["z", "serif"]);
    });
});
