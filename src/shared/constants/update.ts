/**
 * Software update: the keys the main process and the Settings window have to agree on.
 *
 * `app.autoCheckUpdates` used to sit in `GLOBAL_STATE_DEFAULTS` as a key nothing read, and is now
 * in `RETIRED_GLOBAL_STATE_KEYS` - swept from every profile on launch. The setting below is
 * deliberately spelled differently: reusing the retired name would hand the sweeper a key that is
 * meaningful again, and the user's choice would be deleted on the next start.
 */

/**
 * Whether Studio asks GitHub for a newer release on its own: shortly after launch, and again every
 * {@link UPDATE_RECHECK_INTERVAL_MS} for as long as it stays running. The key keeps the name it had
 * when the only check was the launch one, because renaming it would drop every author's answer.
 */
export const UPDATE_AUTO_CHECK_KEY = "app.updateCheckOnLaunch";

/**
 * Whether a version found by a check is downloaded and prepared without being asked.
 *
 * On by default (the user's call, 2026-10-06): an update that waits for a press is an update most
 * people never take. Off brings back the two presses - the check announces, Download starts.
 */
export const UPDATE_AUTO_DOWNLOAD_KEY = "app.updateAutoDownload";

/**
 * Where updates are downloaded from: GitHub, GitCode (the same files, served from inside mainland
 * China), or `auto` - both are asked and the faster one is used. See `updateSource.ts` in the main
 * process for how "faster" is decided.
 */
export const UPDATE_SOURCE_KEY = "app.updateSource";

export const UPDATE_SOURCE_PREFERENCES = ["auto", "github", "gitcode"] as const;

export type UpdateSourcePreference = (typeof UPDATE_SOURCE_PREFERENCES)[number];

/** What the stored setting means, with anything unrecognised read as `auto`. */
export function readUpdateSourcePreference(value: unknown): UpdateSourcePreference {
    return (UPDATE_SOURCE_PREFERENCES as readonly unknown[]).includes(value) ? value as UpdateSourcePreference : "auto";
}

/**
 * Whether this profile has already been told that closing every window leaves Studio running in
 * the notification area.
 *
 * Installation state, not a preference - no settings row, no entry in `GLOBAL_STATE_DEFAULTS`, and
 * absence is what makes the notice appear. Lives here because the residency it explains only
 * exists so an update can finish downloading with no windows open.
 */
export const TRAY_RESIDENCY_NOTICE_KEY = "app.trayResidencyNoticeShown";

/**
 * The Settings entry the update panel renders under, and therefore the `highlight` that opens
 * Settings on it. Nothing is stored here - the panel is a `SettingValueType.Custom` row whose
 * state lives in the main process (see `UpdateManager`).
 */
export const UPDATE_PANEL_SETTING_KEY = "app.update";

/** How long after launch the automatic check runs, so it never competes with opening a project. */
export const UPDATE_AUTO_CHECK_DELAY_MS = 8_000;

/**
 * How often a Studio that stays running checks again.
 *
 * Studio lives in the notification area once its windows are closed, so a session can last days;
 * a check made only at launch would leave such a session on the version it started with.
 */
export const UPDATE_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Where "View release notes" and the macOS "download it yourself" path send the user when no check
 * has said which release, or on which host.
 */
export const UPDATE_RELEASES_URL = "https://github.com/NarraLeaf/NarraLeaf-Studio/releases/latest";

/**
 * What the updater is doing, as the Settings panel and the notification see it.
 *
 * One flat enum rather than a set of booleans because the panel renders exactly one row and the
 * quit guard asks exactly one question ("is a download in flight?"). Two booleans that disagree
 * would be a state neither surface could draw.
 */
export type UpdateStatus =
    /** Nothing known yet, or a check finished with nothing to report. */
    | "idle"
    /** A check is in flight. */
    | "checking"
    /** A newer release exists and has not been downloaded. */
    | "available"
    /** The installer is downloading. */
    | "downloading"
    /**
     * The installer is on disk and is unpacking the new version beside the running one, so the
     * restart that applies it only has to swap folders. Runs while the author works.
     */
    | "preparing"
    /**
     * The update can be applied: by the restart the author asks for, or on the way out when Studio
     * quits. `fastRestart` says whether the prepared copy is there to swap in.
     */
    | "ready"
    /** The last check or download failed; `error` says how. */
    | "error"
    /**
     * A newer release exists but this build cannot install it itself (macOS, see UpdateManager).
     * The panel offers the download page instead of a button that would not work.
     */
    | "manual";

/**
 * The whole of what the renderer knows about updates. Pushed on every transition rather than
 * polled, so the panel's progress bar is the downloader's own numbers and not an animation.
 */
export interface UpdateState {
    status: UpdateStatus;
    /** The version on offer, once a check has found one. */
    availableVersion?: string;
    /** The running version, so the panel can say "0.4.0 → 0.5.0" without a second round trip. */
    currentVersion: string;
    /** Bytes transferred so far, while `status` is "downloading". */
    transferredBytes?: number;
    /** Total bytes to transfer, when the server said. */
    totalBytes?: number;
    /** Bytes per second, as reported by the downloader. */
    bytesPerSecond?: number;
    /** How much of the new version has been unpacked, 0 to 1, while `status` is "preparing". */
    prepareProgress?: number;
    /**
     * In "ready": true when the new version is already unpacked, so applying it is a swap of folders
     * and a restart; false when the installer has to do the whole install while Studio is closed.
     */
    fastRestart?: boolean;
    /** Failure text for "error", already human-readable. */
    error?: string;
    /**
     * In "error", after a download failed: when Studio will try it again on its own (epoch ms).
     * Absent when no automatic retry is waiting.
     */
    retryAt?: number;
    /** Release notes URL for the version on offer. */
    releaseUrl?: string;
    /** False where the platform cannot self-update (macOS today) - the panel links out instead. */
    canInstall: boolean;
}
