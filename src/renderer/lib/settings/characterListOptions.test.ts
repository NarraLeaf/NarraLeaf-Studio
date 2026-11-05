import { describe, expect, it } from "vitest";
import {
    CHARACTER_LIST_GROUPING_DEFAULT,
    CHARACTER_LIST_GROUPING_OPTIONS,
    resolveCharacterListGrouping,
} from "./characterListOptions";

/**
 * The stored value is untyped JSON off global state, so it can be anything - a value written by an
 * older build, a hand-edited global.json, or the `undefined` a first run hands back. Every one of
 * those has to land on an arrangement a picker can actually draw: an unrecognised string would reach
 * the menu and file nobody under anything while the settings page still showed a choice.
 */
describe("resolveCharacterListGrouping", () => {
    it("keeps every value the settings page can produce", () => {
        for (const option of CHARACTER_LIST_GROUPING_OPTIONS) {
            expect(resolveCharacterListGrouping(option), option).toBe(option);
        }
    });

    it("falls back to the default for anything it does not recognise", () => {
        for (const stored of [undefined, null, "", "group", "flat", true, 1, {}, []]) {
            expect(resolveCharacterListGrouping(stored), JSON.stringify(stored)).toBe(CHARACTER_LIST_GROUPING_DEFAULT);
        }
    });

    /**
     * Not merely "some default" - specifically grouped. A project with no cast groups cannot tell
     * the two apart, so the default only speaks where the author has already filed their cast.
     */
    it("defaults to the Characters panel's own filing", () => {
        expect(CHARACTER_LIST_GROUPING_DEFAULT).toBe("grouped");
        expect(CHARACTER_LIST_GROUPING_OPTIONS).toEqual(["grouped", "all"]);
    });
});
