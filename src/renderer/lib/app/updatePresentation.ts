import type { UpdateState } from "@shared/constants/update";
import type { TranslationKey } from "@shared/i18n";

/**
 * How the surfaces that show an update - the title bar's button and its panel, the Settings row,
 * the launcher's line - read one `UpdateState`. Kept in one place so none of them can disagree about
 * what "ready" says or how far along the update is.
 */

/** The status line for a state. A ready update reads differently when the restart is only a swap. */
export function updateStatusKey(state: UpdateState): TranslationKey {
    switch (state.status) {
        case "idle":
            return "update.status.idle";
        case "checking":
            return "update.status.checking";
        case "available":
            return "update.status.available";
        case "downloading":
            return "update.status.downloading";
        case "preparing":
            return "update.status.preparing";
        case "ready":
            return state.fastRestart ? "update.status.readyFast" : "update.status.ready";
        case "error":
            return state.availableVersion ? "update.status.failed" : "update.status.error";
        case "manual":
            return "update.status.manual";
    }
}

/**
 * How far the update has got, 0 to 1, while it is under way; null when nothing is moving or the
 * downloader has not said how big the download is.
 *
 * One measure for the two steps, so a ring that has filled once does not empty and start again:
 * the download is the first half and the unpacking the second. A differential download is usually
 * a few seconds and the unpacking most of a minute, so the halves are not the same length - but the
 * ring only ever moves forward, which is the promise it makes.
 */
export function updateProgress(state: UpdateState): number | null {
    if (state.status === "downloading") {
        if (!state.totalBytes || state.totalBytes <= 0) {
            return null;
        }
        return clamp((state.transferredBytes ?? 0) / state.totalBytes) / 2;
    }
    if (state.status === "preparing") {
        return 0.5 + clamp(state.prepareProgress ?? 0) / 2;
    }
    if (state.status === "ready") {
        return 1;
    }
    return null;
}

/**
 * Whether there is an update to show at all: a version has been found and not yet applied. A check
 * that failed before finding one is not shown in the title bar - the Settings row says it, and an
 * icon for "could not ask" would be a permanent alarm on an offline machine.
 */
export function updateIsOnOffer(state: UpdateState | null): state is UpdateState {
    if (!state) {
        return false;
    }
    switch (state.status) {
        case "available":
        case "downloading":
        case "preparing":
        case "ready":
        case "manual":
            return true;
        case "error":
            return Boolean(state.availableVersion);
        default:
            return false;
    }
}

/** Whether the update in progress can be stopped. */
export function updateCanCancel(state: UpdateState): boolean {
    return state.status === "downloading" || state.status === "preparing";
}

function clamp(value: number): number {
    return Math.min(1, Math.max(0, value));
}

/**
 * Opens the title bar's update panel, for a notification that wants to show it.
 *
 * The panel belongs to the button that draws it; this lets a notification raised elsewhere in the
 * same window open it without either knowing about the other. Null while no button is mounted - a
 * window in recovery, say - and the caller then opens Settings instead.
 */
let openUpdatePanel: (() => void) | null = null;

export function registerUpdatePanel(open: () => void): () => void {
    openUpdatePanel = open;
    return () => {
        if (openUpdatePanel === open) {
            openUpdatePanel = null;
        }
    };
}

export function revealUpdatePanel(): boolean {
    if (!openUpdatePanel) {
        return false;
    }
    openUpdatePanel();
    return true;
}
