/**
 * Which Chromium locale packs a build keeps.
 *
 * The failure this guards against is not a wrong list but an empty one: electron-builder deletes
 * every `.pak` no entry matches, and an app whose `locales/` is empty does not start. So every case
 * below also asserts the fallback is there, including the ones where the project says nothing at
 * all - which is most projects.
 */

import { describe, expect, it } from "vitest";
import { electronLanguagesForGame, FALLBACK_ELECTRON_LANGUAGE } from "./electronLanguages";

/** An `app` record as a `.nlproj` hands one back. */
function app(locales: string[], sourceLocale = locales[0] ?? "") {
    return {
        localization: {
            sourceLocale,
            locales: locales.map(code => ({ code, displayName: code })),
        },
    };
}

describe("electronLanguagesForGame", () => {
    it("is the languages the project offers, plus the fallback", () => {
        expect(electronLanguagesForGame(app(["en-US", "zh-CN", "ja"]))).toEqual(["en-US", "zh-CN", "ja"]);
        // The project's own order, with the fallback appended rather than sorted in.
        expect(electronLanguagesForGame(app(["ja", "zh-CN"]))).toEqual(["ja", "zh-CN", "en-US"]);
    });

    it("keeps the source language, which is one of the locales rather than a fourth thing", () => {
        // `LocalizationConfiguration.locales` includes the source language by construction, so it
        // needs no separate handling - and a reader that added it again would double it.
        expect(electronLanguagesForGame(app(["fr", "de"], "fr"))).toEqual(["fr", "de", "en-US"]);
    });

    it("never repeats the fallback the project already declared", () => {
        expect(electronLanguagesForGame(app(["en-US"]))).toEqual(["en-US"]);
        // electron-builder matches these case-insensitively against the files on disk, so two
        // spellings of one locale are one language.
        expect(electronLanguagesForGame(app(["EN-us", "zh-cn"]))).toEqual(["EN-us", "zh-cn"]);
    });

    it("is the fallback alone for a project that declares no languages", () => {
        // The common case by a wide margin: localization is opt-in, and a project that never turned
        // it on has no `app.localization` at all.
        for (const value of [undefined, {}, { localization: undefined }, { localization: {} }]) {
            expect(electronLanguagesForGame(value)).toEqual([FALLBACK_ELECTRON_LANGUAGE]);
        }
    });

    it("is never empty, whatever shape the config turns out to be", () => {
        // A hand-edited or partly-migrated `.nlproj` must not be why a build produces an app that
        // will not start. Malformed entries are dropped by the reader; the floor is what remains.
        for (const value of [
            null,
            "not an object",
            { localization: "not an object" },
            { localization: { locales: "not an array" } },
            { localization: { locales: [null, 42, { code: "" }, { displayName: "no code" }] } },
        ]) {
            expect(electronLanguagesForGame(value)).toEqual([FALLBACK_ELECTRON_LANGUAGE]);
        }
    });
});
