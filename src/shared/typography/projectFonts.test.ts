import {afterEach, describe, expect, it, vi} from "vitest";
import {
    getActiveProjectFontIds,
    getActiveProjectFonts,
    getActiveProjectFontsRevision,
    resolveFontStackIds,
    setActiveProjectFonts,
    subscribeActiveProjectFonts,
} from "./projectFonts";

afterEach(() => {
    setActiveProjectFonts([]);
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
