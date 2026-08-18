/**
 * Changing the player's language, and what that costs a playthrough already in progress.
 *
 * A language is not a setting the running game can be told about. Text is translated when it
 * renders, so the moment the stored language changes the *next* line is already in the new one -
 * while the line on screen, the backlog behind it, the voice playing under it and the sentences
 * inside every save written so far are all in the old one. There is no correct way to re-translate
 * what a player has already read, so a game that simply switched would be saying two things at once
 * for the rest of the session.
 *
 * Three answers leave it saying one thing, and the project picks between them (see
 * `InGameLanguageChange`):
 *
 *  - `resume` (default): write the run into a reserved save, restart, and load it back. Everything
 *    derived from the old language is rebuilt from scratch, because everything is.
 *  - `restart`: restart without writing anything down. The player gets the game as it launches.
 *  - `nextLaunch`: change nothing now, interface text included. The choice is kept under
 *    `LOCALE_PENDING_KEY` and the next boot moves it into place.
 *
 * None of it happens on a title screen. Nothing is running there to be inconsistent with, so the
 * language simply changes - which is the path most players take, and for them this module does one
 * store write and nothing else.
 *
 * The live locale is written *here* rather than by the caller, because one of the three answers is
 * "do not write it yet", and a write that has already happened cannot be taken back without the
 * player watching it happen.
 *
 * React-free so the decision and the handoff can be driven and asserted directly; `GameApp` supplies
 * the seams. Comments in English per project convention.
 */

import {
    LOCALE_PENDING_KEY,
    LOCALE_RESTART_FRESH_KEY,
    LOCALE_RESTART_RESUME_KEY,
    LOCALE_STORAGE_KEY,
    type InGameLanguageChange,
} from "@shared/types/localization";
import { LOCALE_RESTART_SAVE_ID } from "@shared/types/saves";

export type LocaleRestartLogLevel = "info" | "warning" | "error";

/** What happened to the game when the language changed. */
export type LocaleChangeOutcome =
    /** Nothing was running that a language could be inconsistent with. The new language is live. */
    | "switched"
    /** The run was parked and the shell was asked to restart. Nothing after this is guaranteed to run. */
    | "restarting"
    /** The shell was asked to restart with the run left behind, as this project asked. */
    | "restartingWithoutSave"
    /** The choice was kept for the next launch and this session was left exactly as it was. */
    | "deferred"
    /**
     * A run was going, this project asked for a restart, and this shell cannot restart. The language
     * was changed under the run instead - the degradation a host without the capability takes, and
     * the reason a host that has one should declare it.
     */
    | "unsupported"
    /** A run was going and could not be parked, so it was left alone rather than lost. */
    | "failed";

export type LocaleChangeSeam = {
    /** Whether a playthrough is running and can be serialized. */
    isPlaythroughRunning: () => boolean;
    /** What this project asked for when the language changes mid-playthrough. */
    inGame: InGameLanguageChange;
    /** Write the running game into the given save id. Rejects if it cannot be written. */
    writeSave: (id: string) => Promise<void>;
    /** Durable persistence write; `undefined` clears the key. Resolves once it has landed. */
    persistenceSet: (key: string, value: unknown) => Promise<void>;
    /** Restart this shell. Absent on hosts that have no process or window to restart. */
    restartApplication?: () => Promise<void>;
    report: (level: LocaleRestartLogLevel, message: string) => void;
};

/**
 * Apply the player's choice of language, the way this project wants it applied.
 *
 * Order is the same on every path that restarts: store first, restart second. A restart that ran
 * before the write landed would come back in the language the player just left.
 *
 * A failure to write the parked save stops the restart. A restart without the save is the one
 * outcome worse than a language that only half applies - it is the playthrough gone - so the run is
 * left exactly where it was and the author is told.
 */
export async function applyLocaleChange(seam: LocaleChangeSeam, code: string): Promise<LocaleChangeOutcome> {
    const running = seam.isPlaythroughRunning();
    if (running && seam.inGame === "nextLaunch") {
        // Deliberately not the live key: this session keeps the language it started in, down to the
        // menu the player is standing in while they choose.
        await seam.persistenceSet(LOCALE_PENDING_KEY, code);
        return "deferred";
    }
    await seam.persistenceSet(LOCALE_STORAGE_KEY, code);
    if (!running) {
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
    if (seam.inGame === "restart") {
        // Nothing of the run is written down, on purpose: this project asked for a language change
        // to be a fresh start, and keeping it would be answering a question it did not ask. What IS
        // written is a note for the launch that follows, which only Dev Mode acts on - its restart
        // is a session reload, and a reload puts the author back into the story on purpose.
        await seam.persistenceSet(LOCALE_RESTART_FRESH_KEY, "1");
        seam.report("info", "The language changed; restarting without keeping the playthrough.");
        await seam.restartApplication();
        return "restartingWithoutSave";
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

export type PendingLocaleSeam = {
    /** Read a persisted value from the store, not from a session snapshot. */
    persistenceGetAsync: (key: string) => Promise<unknown>;
    /** Durable persistence write; `undefined` clears the key. */
    persistenceSet: (key: string, value: unknown) => Promise<void>;
};

/**
 * Move a language chosen for "next launch" into place. This is that launch.
 *
 * Answers which language it applied, or null when it applied none - which is every launch but the
 * one after a player deferred a change, and costs those launches a single store read. The pending
 * choice is cleared as it is applied, so the launch after this one is an ordinary one.
 */
export async function promotePendingLocale(seam: PendingLocaleSeam): Promise<string | null> {
    let pending: unknown;
    try {
        pending = await seam.persistenceGetAsync(LOCALE_PENDING_KEY);
    } catch {
        // A store that cannot be read has bigger problems than this, and reports them itself.
        return null;
    }
    if (typeof pending !== "string" || !pending) {
        return null;
    }
    await seam.persistenceSet(LOCALE_STORAGE_KEY, pending);
    await seam.persistenceSet(LOCALE_PENDING_KEY, undefined);
    return pending;
}

/**
 * Whether this launch is the one that must not come back to a playthrough, clearing the note as it
 * answers. See {@link LOCALE_RESTART_FRESH_KEY}.
 */
export async function consumeFreshRestart(seam: PendingLocaleSeam): Promise<boolean> {
    let marked: unknown;
    try {
        marked = await seam.persistenceGetAsync(LOCALE_RESTART_FRESH_KEY);
    } catch {
        return false;
    }
    if (!marked) {
        return false;
    }
    await seam.persistenceSet(LOCALE_RESTART_FRESH_KEY, undefined);
    return true;
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
