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
 * `en-US` is always in it. Chromium falls back to it when the requested locale has no pack, and
 * electron-builder refuses to empty a `locales/` directory (an app with no locale pack at all does
 * not start), so it is both the floor and the answer for a project that declares no languages.
 */

import { normalizeLocalizationConfiguration } from "@shared/types/localization";

/** The pack Chromium falls back to, and the one every build keeps. */
export const FALLBACK_ELECTRON_LANGUAGE = "en-US";

/**
 * The `electronLanguages` for a project, from its `app.localization`.
 *
 * Takes the whole `app` record rather than a typed configuration because that is what a `.nlproj`
 * hands back: the config is decoded msgpack, a project written before localization existed has no
 * such key, and one written by hand can have anything there. `normalizeLocalizationConfiguration`
 * is the reader that turns all of those into a locale list, and it drops what it cannot read rather
 * than throwing - a malformed entry must not be why a build stops.
 *
 * The project's own order is kept, with the fallback appended rather than sorted in, so the list
 * reads as "what this game offers, plus the floor". Codes are compared case-insensitively because
 * that is how electron-builder matches them against the files on disk.
 */
export function electronLanguagesForGame(app: unknown): string[] {
    const localization = normalizeLocalizationConfiguration(
        (app as { localization?: unknown } | undefined)?.localization,
    );
    const languages: string[] = [];
    const seen = new Set<string>();
    for (const code of [...localization.locales.map(entry => entry.code), FALLBACK_ELECTRON_LANGUAGE]) {
        const trimmed = code.trim();
        const key = trimmed.toLowerCase();
        if (!trimmed || seen.has(key)) {
            continue;
        }
        seen.add(key);
        languages.push(trimmed);
    }
    return languages;
}
