/**
 * Which Chromium locale packs a shipped game carries.
 *
 * Electron ships all 55 of them - about 44 MB in `locales/`, next to the executable - and a game
 * offered in one language uses one. The rest are 43 MB every player downloads, on every platform,
 * in every installer and every patch that replaces the app directory.
 *
 * They are not the game's own text: the story, the interface and everything the author wrote are
 * localized by Studio's own pipeline and live in the pack. What these hold is Chromium's built-in
 * surfaces - the text of a context menu, a file picker's buttons, an error page - so the set that
 * matters is the set of languages the project itself offers.
 *
 * They also decide which language the game is told the player speaks. Chromium settles its locale
 * against the packs that are there, and falls back to `en-US` when none of them fits; that locale
 * leads `navigator.languages`, ahead of the system's own list, and the game's first-launch language
 * match takes the first entry it can serve. So a project offering English and Chinese whose Chinese
 * pack had been thrown away greeted a player on a Chinese system in English.
 *
 * ## A project language is not a pack name
 *
 * Packs are named the way Chromium names its UI languages - `zh-CN`, `zh-TW`, `es-419`, `pt-PT` - and
 * a project names its languages in BCP-47, which is free to say `zh-Hans`, `zh-Hant-HK` or `es-MX`.
 * electron-builder keeps a pack when one name is the other or a prefix of it, which covers `fr-CA`
 * (keeps `fr`) and bare `zh` (keeps both Chinese packs), but not a script subtag: `zh-Hans` kept no
 * Chinese pack at all. So each project language is first turned into the packs Chromium would settle
 * on for a player who speaks it ({@link chromiumLocalePacksFor}), with these rules, all measured
 * against Electron 38.8.6 with the other packs removed:
 *
 *  - Chinese goes by script. `zh-Hans` and a region written in it (CN, SG, MY) is `zh-CN`; `zh-Hant`
 *    and TW, HK, MO is `zh-TW` - Chromium itself reads `zh-HK` and `zh-MO` as `zh-TW`. Bare `zh`
 *    keeps both. (`zh-TW` falls back to `zh-CN` when only that is there; `zh-CN` does not fall back
 *    to `zh-TW`, which is why a Traditional-only game keeps only the Traditional pack.)
 *  - Spanish: Spain is `es`, every other region is `es-419`, and the two never fall back to each
 *    other, so bare `es` keeps both.
 *  - Portuguese: Brazil is `pt-BR`, every other region `pt-PT`; bare `pt` keeps both.
 *  - English: `en-US` is its own pack, and bare `en` keeps both. Every other region keeps `en-GB`,
 *    because that is where Chromium sends most of them (GB, AU, CA, IN, IE, SG, HK, PR, even an
 *    unknown one) while a few (PH, LR) stay with `en-US` - which every build keeps anyway, so the
 *    exact list does not have to be known here.
 *  - Everything else is its language: `fr-CA` is `fr`, `sr-Latn` is `sr`. The old codes Chromium
 *    still reads are renamed as it renames them (`iw` is `he`, `in` is `id`, `no` is `nb`, `tl` is
 *    `fil`).
 *
 * A language Electron has no pack for is passed on all the same: electron-builder warns that it
 * matched nothing and keeps the rest, which is what happened before as well.
 *
 * `en-US` is always in the list. Chromium falls back to it when the requested locale has no pack, and
 * electron-builder refuses to empty a `locales/` directory (an app with no locale pack at all does
 * not start), so it is both the floor and the answer for a project that declares no languages.
 */

import { chineseScriptOf, localeTagParts } from "@shared/i18n/chineseScript";
import { normalizeLocalizationConfiguration } from "@shared/types/localization";

/** The pack Chromium falls back to, and the one every build keeps. */
export const FALLBACK_ELECTRON_LANGUAGE = "en-US";

/** Language codes Chromium reads under a newer name, and names its pack by that. */
const CHROMIUM_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
    iw: "he",
    in: "id",
    no: "nb",
    tl: "fil",
};

/**
 * The Chromium locale packs a game needs to carry for one of its languages: the pack Chromium would
 * settle on for a player whose system speaks it, or, for a language named without a region, the pack
 * for each region Chromium tells apart. See the file comment for the rules and where they come from.
 *
 * Pack names as Chromium spells them (`zh-CN`), which electron-builder matches case-insensitively and
 * with `_` for `-`, so the same names find the `zh_CN.lproj` folders of a macOS build. Empty for a tag
 * that does not begin with a language code.
 */
export function chromiumLocalePacksFor(tag: string): string[] {
    const parts = localeTagParts(tag);
    if (!parts) {
        return [];
    }
    const language = CHROMIUM_LANGUAGE_ALIASES[parts.language] ?? parts.language;
    const { region } = parts;
    switch (language) {
        case "zh": {
            // By script, the script a region writes standing in for one that is not named - the
            // same table the game's first-launch language match reads.
            const script = chineseScriptOf(parts);
            if (script === null) {
                return ["zh-CN", "zh-TW"];
            }
            return [script === "hant" ? "zh-TW" : "zh-CN"];
        }
        case "es":
            if (region === null) {
                return ["es", "es-419"];
            }
            // Either name keeps both Spanish packs in the end: electron-builder reads `es` as a prefix
            // of `es-419` and `es-419` as a narrowing of `es`. Half a megabyte, and nothing lost.
            return [region === "es" ? "es" : "es-419"];
        case "pt":
            if (region === null) {
                return ["pt-BR", "pt-PT"];
            }
            return [region === "br" ? "pt-BR" : "pt-PT"];
        case "en":
            if (region === null) {
                return ["en-US", "en-GB"];
            }
            // `en-US` rides along as the fallback whatever this says; see the file comment.
            return [region === "us" ? "en-US" : "en-GB"];
        default:
            return [language];
    }
}

/**
 * The `electronLanguages` for a project, from its `app.localization`.
 *
 * Takes the whole `app` record rather than a typed configuration because that is what a `.nlproj`
 * hands back: the config is decoded msgpack, a project written before localization existed has no
 * such key, and one written by hand can have anything there. `normalizeLocalizationConfiguration`
 * is the reader that turns all of those into a locale list, and it drops what it cannot read rather
 * than throwing - a malformed entry must not be why a build stops.
 *
 * The project's own order is kept, each language turned into its packs, with the fallback appended
 * rather than sorted in, so the list reads as "what this game offers, plus the floor". Packs are
 * compared case-insensitively because that is how electron-builder matches them against the files on
 * disk.
 */
export function electronLanguagesForGame(app: unknown): string[] {
    const localization = normalizeLocalizationConfiguration(
        (app as { localization?: unknown } | undefined)?.localization,
    );
    const languages: string[] = [];
    const seen = new Set<string>();
    const packs = [
        ...localization.locales.flatMap(entry => chromiumLocalePacksFor(entry.code)),
        FALLBACK_ELECTRON_LANGUAGE,
    ];
    for (const pack of packs) {
        const key = pack.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        languages.push(pack);
    }
    return languages;
}
