/**
 * Writing a screenshot to disk, and opening the folder it went into.
 *
 * Split from `@shared/types/blueprint/screenshot` for the reason `gameProgressFile` is split from
 * `gameProgress`: that half is the shape and travels everywhere, renderer included, while this half
 * imports Node. Two processes reach for it - Studio's main process, for the Dev Mode window, and
 * the packaged game's - and they hand it two different directories, which is the only thing about a
 * screenshot the two shells legitimately disagree on. Everything else is here so that they cannot
 * disagree about it: the name of the file, the fact that the folder is created on the way, and what
 * a failure reads as.
 *
 * The capture itself is injected. Both callers get their bytes from `webContents.capturePage()`,
 * but Electron is not something this module should need in order to be exercised.
 *
 * Comments in English per project convention.
 */

import fs from "fs/promises";
import path from "path";
import {
    blueprintScreenshotFileName,
    type BlueprintOpenScreenshotsResult,
    type BlueprintScreenshotResult,
} from "../types/blueprint/screenshot";

export type ScreenshotWriteOptions = {
    /** The folder this shell keeps its screenshots in, absolute. Created if it is not there. */
    directory: string;
    /** The PNG bytes of the frame. Rejecting is a `failed` result, not a thrown error. */
    capture: () => Promise<Uint8Array>;
    /** Injected so a test does not have to wait a millisecond to get two different names. */
    now?: () => Date;
};

/**
 * Capture and write one screenshot.
 *
 * Total: everything that can go wrong - no window to capture, a directory that cannot be created, a
 * disk that refused the write - comes back as a `failed` result with the reason, because the node
 * above this has a `Failed` branch and an author's answer to all of them is the same.
 */
export async function writeScreenshotFile(
    options: ScreenshotWriteOptions,
): Promise<BlueprintScreenshotResult> {
    const { directory, capture, now } = options;
    const file = path.join(directory, blueprintScreenshotFileName(now ? now() : new Date()));
    try {
        const bytes = await capture();
        if (!bytes || bytes.length === 0) {
            // An empty capture is what an occluded or minimised window can answer with on some
            // platforms. Writing a zero-byte PNG would leave the player a file that opens as
            // nothing, which is worse than saying the frame could not be taken.
            return { outcome: "failed", path: null, error: "The window could not be captured." };
        }
        await fs.mkdir(directory, { recursive: true });
        await fs.writeFile(file, bytes);
        return { outcome: "saved", path: file, error: null };
    } catch (error) {
        return {
            outcome: "failed",
            path: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

export type ScreenshotFolderOptions = {
    directory: string;
    /**
     * `shell.openPath`, which answers with an empty string on success and a message on failure.
     * Injected for the same reason the capture is.
     */
    openPath: (directory: string) => Promise<string>;
};

/**
 * Show the player the folder screenshots go into, making it first if they have taken none.
 *
 * Created rather than reported missing: the folder is where this game's pictures go whether or not
 * any are there yet, and a settings screen that refused to open it until the player had taken one
 * would be answering a question nobody asked.
 */
export async function openScreenshotsFolder(
    options: ScreenshotFolderOptions,
): Promise<BlueprintOpenScreenshotsResult> {
    const { directory, openPath } = options;
    try {
        await fs.mkdir(directory, { recursive: true });
        const failure = await openPath(directory);
        if (failure) {
            return { outcome: "failed", path: null, error: failure };
        }
        return { outcome: "opened", path: directory, error: null };
    } catch (error) {
        return {
            outcome: "failed",
            path: null,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}
