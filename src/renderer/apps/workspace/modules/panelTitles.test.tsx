// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { builtInPanels } from "./registry";

/**
 * A panel's `title` is copied into the store once, when the panel is registered, so a header that
 * reads it keeps the language Studio was in at startup. The headers, the rail and the panel menus
 * follow a live language switch through `titleKey`; a built-in panel without one is the panel whose
 * header stays behind (the Voice panel said 配音 in an English Studio).
 */

/** Titles that are the same word in every language, so there is nothing to follow. */
const UNTRANSLATED_TITLES = new Set(["narraleaf-studio:ui-surfaces"]);

describe("built-in panel titles", () => {
    it("name a translation key, so the header follows a language switch", () => {
        const missing = builtInPanels
            .filter(panel => !UNTRANSLATED_TITLES.has(panel.metadata.id))
            .filter(panel => !panel.metadata.titleKey)
            .map(panel => panel.metadata.id);
        expect(missing).toEqual([]);
    });
});
