import {
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    deviceLanguageTags,
    pickPreferredLocale,
    type Locale,
} from "@shared/i18n";

/**
 * The language the game's own shell text is in: the crash screen, and anything else the runtime
 * says in its own voice rather than the author's.
 *
 * The machine's language, and nothing else. A player reads this screen at the one moment the game
 * has stopped working, so it cannot depend on the game having got far enough to read its pack, its
 * stored language, or the player's in-game choice - the failure most likely to be drawn is the one
 * that happened before any of those existed.
 *
 * Resolved against {@link SUPPORTED_LOCALES} rather than the registered set, so the answer is one
 * of the three languages Studio ships and a project cannot move it. A language pack a game loads
 * translates the game; it does not translate the shell reporting that the game is down.
 *
 * Read once, at module load: everything that asks is either drawing during a teardown or running
 * before React exists, and the answer cannot change while a window is open.
 */
const shellLocale: Locale = pickPreferredLocale(deviceLanguageTags(), SUPPORTED_LOCALES, DEFAULT_LOCALE);

export function getShellLocale(): Locale {
    return shellLocale;
}
