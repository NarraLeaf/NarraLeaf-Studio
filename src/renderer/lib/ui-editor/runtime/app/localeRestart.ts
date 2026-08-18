/**
 * Changing the player's language mid-playthrough, by restarting the game and coming back to it.
 *
 * A language is not a setting the running game can be told about. It is baked into almost
 * everything already on screen and already in memory by the time the player picks a new one: the
 * lines that have been rendered, the backlog entries recording them, the sentence a typewriter is
 * halfway through, the voice clip playing under it, the preloaded assets of the current scene, and
 * the sentences the engine has already serialized into its own save state. A notification channel
 * would reach every one of those and none of them would know what to do with it - there is no
 * correct way to re-translate a backlog of lines the player has already read, and a game that
 * re-translated only what happens next would be showing two languages at once for the rest of the
 * session.
 *
 * So the language change is honoured the only way that leaves the game coherent: the run is written
 * into a reserved save, the process restarts, and the boot that follows loads it back. Everything
 * derived from the old language is rebuilt from scratch, because everything is.
 *
 * The restart is skipped when there is nothing to keep coherent - the title screen, a settings page
 * reached before a playthrough started - and that is the common case: most players pick a language
 * before they start playing, and for them this module does nothing at all.
 *
 * React-free so the decision and the handoff can be driven and asserted directly; `GameApp` supplies
 * the seams. Comments in English per project convention.
 */

import { LOCALE_RESTART_RESUME_KEY } from "@shared/types/localization";
import { LOCALE_RESTART_SAVE_ID } from "@shared/types/saves";

export type LocaleRestartLogLevel = "info" | "warning" | "error";

/** What happened to the game when the language changed. */
export type LocaleChangeOutcome =
    /** Nothing was running that a language could be inconsistent with. The new language is live. */
    | "switched"
    /** The run was parked and the shell was asked to restart. Nothing after this is guaranteed to run. */
    | "restarting"
    /**
     * A run was going and this shell cannot restart, so the language was changed under it. The
     * degradation a host without the capability takes, and the reason a host that has one should
     * declare it.
     */
    | "unsupported"
    /** A run was going and could not be parked, so it was left alone rather than lost. */
    | "failed";

export type LocaleChangeSeam = {
    /** Whether a playthrough is running and can be serialized. */
    isPlaythroughRunning: () => boolean;
    /** Write the running game into the given save id. Rejects if it cannot be written. */
    writeSave: (id: string) => Promise<void>;
    /** Durable persistence write; `undefined` clears the key. Resolves once it has landed. */
    persistenceSet: (key: string, value: unknown) => Promise<void>;
    /** Restart this shell. Absent on hosts that have no process or window to restart. */
    restartApplication?: () => Promise<void>;
    report: (level: LocaleRestartLogLevel, message: string) => void;
};

/**
 * Park the run, if there is one, and ask the shell to restart.
 *
 * Called after the new language has already been persisted, so the boot that follows reads it as
 * the player's choice like any other. That ordering is also what makes every early return safe:
 * whatever happens to the run, the language the player asked for is the one the game is in.
 *
 * A failure to write the save stops the restart. A restart without a save is the one outcome worse
 * than a language that only half applies - it is the playthrough gone - so the run is left exactly
 * where it was and the author is told.
 */
export async function applyLocaleChange(seam: LocaleChangeSeam): Promise<LocaleChangeOutcome> {
    if (!seam.isPlaythroughRunning()) {
        return "switched";
    }
    if (!seam.restartApplication) {
        seam.report(
            "warning",
            "The language changed while a playthrough was running, and this host cannot restart. "
            + "Text already on screen, the backlog and any playing voice stay in the previous language.",
        );
        return "unsupported";
    }
    try {
        await seam.writeSave(LOCALE_RESTART_SAVE_ID);
        // Awaited, and only after the save is written: this key is the entire instruction the next
        // boot gets, and the process is about to end. A write still in a debounce queue when the
        // window closes would restart the game onto its title screen with the run stranded in a
        // save nothing will ever read.
        await seam.persistenceSet(LOCALE_RESTART_RESUME_KEY, LOCALE_RESTART_SAVE_ID);
    } catch (error) {
        seam.report(
            "error",
            `The language changed but the playthrough could not be saved, so the game was not restarted: ${
                error instanceof Error ? error.message : String(error)
            }`,
        );
        return "failed";
    }
    // Said out loud, at info: this is the one moment a player's game ends and comes back on its
    // own, and an author watching a log has to be able to tell it from a crash.
    seam.report("info", "The playthrough was parked for the language change; restarting.");
    await seam.restartApplication();
    return "restarting";
}

/** What the boot found waiting for it. */
export type LocaleResumeOutcome =
    /** No restart was owed. Every ordinary boot. */
    | "none"
    /** The parked run was loaded and the player is back where they were. */
    | "resumed"
    /** A restart was owed and the save would not load. The marker is cleared either way. */
    | "failed";

export type LocaleResumeSeam = {
    /** Read a persisted value from the store, not from a session snapshot. */
    persistenceGetAsync: (key: string) => Promise<unknown>;
    /** Durable persistence write; `undefined` clears the key. */
    persistenceSet: (key: string, value: unknown) => Promise<void>;
    /** Load the save into the running session. Answers whether it was applied. */
    loadSave: (id: string) => Promise<boolean>;
    /** Drop the parked save once it has been consumed. */
    deleteSave: (id: string) => Promise<void>;
    report: (level: LocaleRestartLogLevel, message: string) => void;
};

/**
 * Put the player back where the language change took them from.
 *
 * The marker is cleared **before** the load is attempted, and that order is deliberate: a save that
 * throws on the way in would otherwise be tried again by the next boot, and again by the one after
 * it, turning one bad record into a game that can never reach its title screen.
 *
 * The parked save is deleted once it has been applied and kept when it has not, so a run that could
 * not be restored is still on disk for whoever has to find out why. It carries a fixed id, so at
 * most one is ever kept.
 */
export async function resumeAfterLocaleRestart(seam: LocaleResumeSeam): Promise<LocaleResumeOutcome> {
    let marker: unknown;
    try {
        marker = await seam.persistenceGetAsync(LOCALE_RESTART_RESUME_KEY);
    } catch {
        // A store that cannot be read has bigger problems than this, and every one of them is
        // reported by the store itself. Booting to the title screen is the right answer here.
        return "none";
    }
    if (typeof marker !== "string" || !marker) {
        return "none";
    }
    await seam.persistenceSet(LOCALE_RESTART_RESUME_KEY, undefined);
    seam.report("info", "A language change parked a playthrough; restoring it.");
    let loaded = false;
    try {
        loaded = await seam.loadSave(marker);
    } catch (error) {
        seam.report("error", `The playthrough could not be resumed after the language change: ${
            error instanceof Error ? error.message : String(error)
        }`);
        return "failed";
    }
    if (!loaded) {
        seam.report("warning", "The playthrough parked by the language change was not accepted; it is still stored.");
        // `loadSave` has already told the player and the author what it refused and why; saying it
        // twice in different words would just be a second opinion on the same record.
        return "failed";
    }
    seam.report("info", "The playthrough parked by the language change was restored.");
    try {
        await seam.deleteSave(marker);
    } catch {
        // The record is consumed and its id is fixed, so the worst a failed delete leaves behind is
        // one stale slot that the next language change overwrites.
    }
    return "resumed";
}
