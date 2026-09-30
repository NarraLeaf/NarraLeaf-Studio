/**
 * Which Chromium locale packs a build keeps.
 *
 * Two failures are guarded here. The first is an empty list: electron-builder deletes every `.pak`
 * no entry matches, and an app whose `locales/` is empty does not start, so every case below also
 * asserts the fallback is there, including the ones where the project says nothing at all - which is
 * most projects. The second is a project language that keeps no pack for itself: Chromium then
 * settles on `en-US`, which leads `navigator.languages`, and the game greets a player on a Chinese
 * system in English. `zh-Hans` and `zh-Hant` did exactly that, because electron-builder only matches
 * a name that is a prefix of a pack's.
 */

import fs from "fs/promises";
import os from "os";
import path from "path";
import type { BeforeCopyExtraFilesOptions } from "app-builder-lib/out/Framework";
import { removeUnusedLanguagesIfNeeded } from "app-builder-lib/out/electron/ElectronFramework";
import { Platform } from "electron-builder";
import { afterEach, describe, expect, it } from "vitest";

import { matchSystemLocale } from "@shared/types/localization";

import { ELECTRON_DARWIN_ARM64_RELEASE_NAMES, ELECTRON_WIN32_X64_RELEASE_NAMES } from "./electronReleaseFixtures";
import { chromiumLocalePacksFor, electronLanguagesForGame, FALLBACK_ELECTRON_LANGUAGE } from "./electronLanguages";

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
        // Two spellings of one locale are one pack, named the way Chromium names it.
        expect(electronLanguagesForGame(app(["EN-us", "zh-cn"]))).toEqual(["en-US", "zh-CN"]);
    });

    it("names each language by the packs Chromium would settle on for it", () => {
        expect(electronLanguagesForGame(app(["en", "zh-Hans", "zh-Hant"]))).toEqual(["en-US", "en-GB", "zh-CN", "zh-TW"]);
        // Two languages that land on one pack keep it once.
        expect(electronLanguagesForGame(app(["zh-Hans", "zh-CN", "zh-SG"]))).toEqual(["zh-CN", "en-US"]);
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

/**
 * The rules, each one measured against Electron 38.8.6 by removing the other packs from `locales/`
 * and reading `app.getLocale()` for a `--lang` of the language in question.
 */
describe("chromiumLocalePacksFor", () => {
    it.each([
        // Chinese goes by script, and a region stands for the script it writes.
        ["zh-Hans", ["zh-CN"]],
        ["zh-Hant", ["zh-TW"]],
        ["zh-Hans-CN", ["zh-CN"]],
        ["zh-Hans-SG", ["zh-CN"]],
        ["zh-Hant-TW", ["zh-TW"]],
        ["zh-Hant-HK", ["zh-TW"]],
        ["zh_Hant", ["zh-TW"]],
        ["ZH-HANS", ["zh-CN"]],
        ["zh-CN", ["zh-CN"]],
        ["zh-SG", ["zh-CN"]],
        ["zh-MY", ["zh-CN"]],
        ["zh-TW", ["zh-TW"]],
        ["zh-HK", ["zh-TW"]],
        ["zh-MO", ["zh-TW"]],
        // Named without a script or region, it is every Chinese reader.
        ["zh", ["zh-CN", "zh-TW"]],
    ])("keeps %s as %j", (tag, packs) => {
        expect(chromiumLocalePacksFor(tag)).toEqual(packs);
    });

    it.each([
        // Spain and everywhere else are two packs that never stand in for each other.
        ["es", ["es", "es-419"]],
        ["es-ES", ["es"]],
        ["es-MX", ["es-419"]],
        ["es-419", ["es-419"]],
        ["es-AR", ["es-419"]],
        // Brazil and everywhere else, likewise.
        ["pt", ["pt-BR", "pt-PT"]],
        ["pt-BR", ["pt-BR"]],
        ["pt-PT", ["pt-PT"]],
        ["pt-AO", ["pt-PT"]],
        // English: its own pack for the US, the British one for (nearly) everywhere else.
        ["en", ["en-US", "en-GB"]],
        ["en-US", ["en-US"]],
        ["en-GB", ["en-GB"]],
        ["en-AU", ["en-GB"]],
        ["en-CA", ["en-GB"]],
    ])("keeps %s as %j", (tag, packs) => {
        expect(chromiumLocalePacksFor(tag)).toEqual(packs);
    });

    it.each([
        // Everything else is its language.
        ["fr-CA", ["fr"]],
        ["de-AT", ["de"]],
        ["ja", ["ja"]],
        ["ja-JP", ["ja"]],
        ["sr-Latn-RS", ["sr"]],
        // The old codes Chromium still reads, under the names its packs have.
        ["iw", ["he"]],
        ["in", ["id"]],
        ["no", ["nb"]],
        ["tl", ["fil"]],
    ])("keeps %s as %j", (tag, packs) => {
        expect(chromiumLocalePacksFor(tag)).toEqual(packs);
    });

    it("keeps nothing for something that is not a language code", () => {
        for (const tag of ["", " ", "Chinese", "1234", "-Hans"]) {
            expect(chromiumLocalePacksFor(tag)).toEqual([]);
        }
    });
});

/**
 * The list run through electron-builder's own cleanup, against the files of a real Electron release -
 * so the question is not whether the names look right but which packs are left on disk.
 */
describe("the packs a build is left with", () => {
    const roots: string[] = [];

    afterEach(async () => {
        await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
    });

    /** The locale packs of the win32 release: `locales/<name>.pak`. */
    const WIN32_PACKS = ELECTRON_WIN32_X64_RELEASE_NAMES
        .filter(name => name.endsWith(".pak"))
        .filter(name => !/^(chrome_\d+_percent|resources)\.pak$/.test(name));

    /** The `.lproj` folders of the macOS release, gendered variants and all. */
    const DARWIN_LPROJ = ELECTRON_DARWIN_ARM64_RELEASE_NAMES.filter(name => name.endsWith(".lproj"));

    async function keptOnWindows(electronLanguages: string[]): Promise<string[]> {
        const appOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "nl-electron-languages-"));
        roots.push(appOutDir);
        await fs.mkdir(path.join(appOutDir, "resources"), { recursive: true });
        await fs.mkdir(path.join(appOutDir, "locales"));
        await Promise.all(WIN32_PACKS.map(name => fs.writeFile(path.join(appOutDir, "locales", name), "")));
        await removeUnusedLanguagesIfNeeded({
            appOutDir,
            packager: {
                config: {},
                platformSpecificBuildOptions: { electronLanguages },
                platform: Platform.WINDOWS,
                getResourcesDir: (dir: string) => path.join(dir, "resources"),
            },
        } as unknown as BeforeCopyExtraFilesOptions);
        return (await fs.readdir(path.join(appOutDir, "locales"))).map(name => name.replace(/\.pak$/, "")).sort();
    }

    async function keptOnMac(electronLanguages: string[]): Promise<string[]> {
        const appOutDir = await fs.mkdtemp(path.join(os.tmpdir(), "nl-electron-languages-"));
        roots.push(appOutDir);
        const appResources = path.join(appOutDir, "app-resources");
        const frameworkResources = path.join(appOutDir, "framework-resources");
        await fs.mkdir(path.join(appResources, "en.lproj"), { recursive: true });
        await Promise.all(DARWIN_LPROJ.map(name => fs.mkdir(path.join(frameworkResources, name), { recursive: true })));
        await removeUnusedLanguagesIfNeeded({
            appOutDir,
            packager: {
                config: {},
                platformSpecificBuildOptions: { electronLanguages },
                platform: Platform.MAC,
                getResourcesDir: () => appResources,
                getMacOsElectronFrameworkResourcesDir: () => frameworkResources,
            },
        } as unknown as BeforeCopyExtraFilesOptions);
        return (await fs.readdir(frameworkResources)).filter(name => !/_(FEMININE|MASCULINE|NEUTER)\.lproj$/.test(name)).sort();
    }

    it("keeps the Chinese pack of a project that names its Chinese by script", async () => {
        // The case that kept nothing: `zh-hans` is neither `zh-cn` nor a prefix of it.
        expect(await keptOnWindows(electronLanguagesForGame(app(["en", "zh-Hans"])))).toEqual(["en-GB", "en-US", "zh-CN"]);
        expect(await keptOnWindows(electronLanguagesForGame(app(["ja", "zh-Hant"])))).toEqual(["en-US", "ja", "zh-TW"]);
        expect(await keptOnWindows(electronLanguagesForGame(app(["zh-Hans", "zh-Hant-HK"])))).toEqual(["en-US", "zh-CN", "zh-TW"]);
    });

    it("keeps the pack Chromium picks for a region it maps elsewhere", async () => {
        // `es` stays too: electron-builder keeps a pack whose name the wanted one narrows.
        expect(await keptOnWindows(electronLanguagesForGame(app(["es-MX"])))).toEqual(["en-US", "es", "es-419"]);
        expect(await keptOnWindows(electronLanguagesForGame(app(["pt-AO"])))).toEqual(["en-US", "pt-PT"]);
        expect(await keptOnWindows(electronLanguagesForGame(app(["en-AU"])))).toEqual(["en-GB", "en-US"]);
    });

    it("keeps what a bare language kept before", async () => {
        expect(await keptOnWindows(electronLanguagesForGame(app(["zh"])))).toEqual(["en-US", "zh-CN", "zh-TW"]);
        expect(await keptOnWindows(electronLanguagesForGame(app(["pt", "es", "fr-CA"])))).toEqual(
            ["en-US", "es", "es-419", "fr", "pt-BR", "pt-PT"],
        );
    });

    it("keeps the fallback alone for a project with no languages", async () => {
        expect(await keptOnWindows(electronLanguagesForGame(undefined))).toEqual(["en-US"]);
    });

    it("finds the same packs among a macOS build's folders", async () => {
        // Folders there are spelled `zh_CN.lproj`, and `en.lproj` is the American pack.
        expect(await keptOnMac(electronLanguagesForGame(app(["en", "zh-Hans", "zh-Hant"])))).toEqual(
            ["en.lproj", "en_GB.lproj", "zh_CN.lproj", "zh_TW.lproj"],
        );
        expect(await keptOnMac(electronLanguagesForGame(app(["zh-Hans"])))).toEqual(["en.lproj", "zh_CN.lproj"]);
    });
});

/**
 * Why the pack matters to the game and not only to Chromium's own menus: the game's first-launch
 * match takes the first entry of `navigator.languages` it can serve, and Chromium's locale leads that
 * list. Both lists below were read from a real window on Windows 11 whose system languages are
 * `zh-Hans-CN`, `en-US`, `ja` (Electron 38.8.6).
 */
describe("first-launch language on a Simplified Chinese system", () => {
    const project = [{ code: "en", displayName: "English" }, { code: "zh-Hans", displayName: "简体中文" }];

    it("is English when the build carried no Chinese pack", () => {
        const withoutChinesePack = ["en-US", "zh-Hans-CN", "ja", "en-US"];
        expect(matchSystemLocale(project, withoutChinesePack)).toBe("en");
    });

    it("is Chinese once the build carries the pack a zh-Hans project now keeps", () => {
        expect(electronLanguagesForGame(app(project.map(entry => entry.code)))).toContain("zh-CN");
        const withChinesePack = ["zh-CN", "zh-Hans-CN", "en-US", "ja", "zh-CN"];
        expect(matchSystemLocale(project, withChinesePack)).toBe("zh-Hans");
    });
});
