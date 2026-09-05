import { describe, expect, it } from "vitest";
import {
    DEFAULT_PRELOAD_CONFIGURATION,
    PRELOAD_BEHAVIORS,
    normalizePreloadConfiguration,
    preloadGatesWholeScene,
} from "./preload";

describe("normalizePreloadConfiguration", () => {
    it("answers with the automatic behavior for a project that has never set one", () => {
        expect(normalizePreloadConfiguration(undefined)).toEqual(DEFAULT_PRELOAD_CONFIGURATION);
        expect(normalizePreloadConfiguration(null)).toEqual(DEFAULT_PRELOAD_CONFIGURATION);
        expect(normalizePreloadConfiguration("blocking")).toEqual(DEFAULT_PRELOAD_CONFIGURATION);
        expect(normalizePreloadConfiguration({})).toEqual(DEFAULT_PRELOAD_CONFIGURATION);
    });

    it("keeps an authored behavior and refuses one it does not offer", () => {
        expect(normalizePreloadConfiguration({ behavior: "blocking" }).behavior).toBe("blocking");
        expect(normalizePreloadConfiguration({ behavior: "auto" }).behavior).toBe("auto");
        expect(normalizePreloadConfiguration({ behavior: "eager" }).behavior).toBe("auto");
    });

    /**
     * The whole point of the setting: a project that has never opened the page gets the fast path,
     * and the position an author has to choose deliberately is the one that waits.
     */
    it("defaults to the behavior that does not hold the game back", () => {
        expect(preloadGatesWholeScene(DEFAULT_PRELOAD_CONFIGURATION.behavior)).toBe(false);
    });
});

describe("preloadGatesWholeScene", () => {
    it("maps each behavior onto what the first frame waits for", () => {
        expect(preloadGatesWholeScene("auto")).toBe(false);
        expect(preloadGatesWholeScene("blocking")).toBe(true);
    });

    it("has an answer for every behavior the picker offers", () => {
        for (const behavior of PRELOAD_BEHAVIORS) {
            expect(typeof preloadGatesWholeScene(behavior)).toBe("boolean");
        }
    });
});
