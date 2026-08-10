/**
 * Software update: the keys the main process and the Settings window have to agree on.
 *
 * `app.autoCheckUpdates` used to sit in `GLOBAL_STATE_DEFAULTS` as a key nothing read, and is now
 * in `RETIRED_GLOBAL_STATE_KEYS` - swept from every profile on launch. The setting below is
 * deliberately spelled differently: reusing the retired name would hand the sweeper a key that is
 * meaningful again, and the user's choice would be deleted on the next start.
 */

/** Whether Studio asks GitHub for a newer release shortly after launch. */
export const UPDATE_AUTO_CHECK_KEY = "app.updateCheckOnLaunch";

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

/** Where "View release notes" and the macOS "download it yourself" path send the user. */
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
    /** The installer is downloading. This is the state the quit guard asks about. */
    | "downloading"
    /** The installer is on disk and will be applied on quit. */
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
    /** Failure text for "error", already human-readable. */
    error?: string;
    /** Release notes URL for the version on offer. */
    releaseUrl?: string;
    /** False where the platform cannot self-update (macOS today) - the panel links out instead. */
    canInstall: boolean;
}
