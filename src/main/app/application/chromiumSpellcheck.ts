/**
 * Keeping Chromium's own spellchecker switched off.
 *
 * Studio checks spelling itself (`managers/spellcheck`), against word lists it downloads through
 * main from an index it names. Chromium's built-in spellchecker is a second one that nobody uses:
 * Studio's editors draw their own underlines, and every other text field is a name or a number.
 * Left at Electron's defaults it is on, with the OS locale as its language, and on Windows and Linux
 * it fetches that language's Hunspell dictionary from a Google CDN the first time a window starts -
 * a remote read that never passes through main, which is exactly the door `29790ac50` set out to
 * close. That commit removed the `setSpellCheckerEnabled` call the old Chromium-based checker made,
 * and with it the only thing that had kept the built-in one off.
 *
 * So every session is switched off as it is created, before any window can ask for a dictionary.
 * The language list is emptied as well where it means anything (it is a no-op on macOS, which uses
 * the operating system's checker and downloads nothing): with no language there is nothing to fetch
 * even if something later turned the switch back on.
 */

/** The part of an Electron `Session` this needs. */
export interface SpellcheckerSession {
    setSpellCheckerEnabled(enable: boolean): void;
    setSpellCheckerLanguages(languages: string[]): void;
}

/** The part of Electron's `app` this needs. */
export interface SessionCreatedSource {
    on(event: "session-created", listener: (session: SpellcheckerSession) => void): unknown;
}

/** Switch one session's built-in spellchecker off. Never throws: nothing here is worth failing a launch over. */
export function disableChromiumSpellchecker(
    session: SpellcheckerSession,
    platform: NodeJS.Platform = process.platform,
): void {
    try {
        session.setSpellCheckerEnabled(false);
    } catch {
        // A session that cannot take the switch has nothing to download with either.
    }
    if (platform === "darwin") {
        return;
    }
    try {
        session.setSpellCheckerLanguages([]);
    } catch {
        // Same reasoning: the switch above is what matters.
    }
}

/**
 * Switch the built-in spellchecker off in every session Electron creates from now on. Call before
 * `app.whenReady()`, so the default session (created at ready) is covered, and partitions created
 * later are too.
 */
export function disableChromiumSpellcheckerForAllSessions(
    app: SessionCreatedSource,
    platform: NodeJS.Platform = process.platform,
): void {
    app.on("session-created", session => disableChromiumSpellchecker(session, platform));
}
