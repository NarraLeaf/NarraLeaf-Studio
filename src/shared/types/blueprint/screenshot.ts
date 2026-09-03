/**
 * The Save Screenshot family's wire contract, shared by every shell that implements it.
 *
 * A screenshot is a picture of the frame the player is looking at, written to a file they can find
 * again. Both halves of that are the shell's business and no two shells answer them the same way:
 * the packaged desktop game captures its own window and writes beside the player's saves, Dev Mode
 * captures the window Studio drew and writes into the author's Dev Mode data, and a page in a
 * browser can do neither - it has no window to capture from outside and nowhere to put a file that
 * would still be there tomorrow.
 *
 * So the request carries nothing and the result carries the path. The renderer never names a
 * directory: where a game may write is a fact about the installation, and a graph that could pass a
 * path would be a graph that could write anywhere the player's account can.
 *
 * ## Why a failure rather than a throw
 *
 * The same reason `Open Link` reports one: a shell that cannot take a screenshot is not a broken
 * game, and an author's graph should be able to say "and if it did not work, show this instead".
 * The node leaves by `Failed` with `Error` saying which - no capture support here, or a disk that
 * refused the write - because the author's answer to both is the same.
 *
 * Comments in English per project convention.
 */

/** Where a shell keeps this title's screenshots, relative to whatever root it writes player files in. */
export const BLUEPRINT_SCREENSHOTS_DIR_NAME = "screenshots";

export type BlueprintScreenshotOutcome = "saved" | "failed";

export type BlueprintScreenshotResult = {
    outcome: BlueprintScreenshotOutcome;
    /** The file that was written, absolute, or null when nothing was. */
    path: string | null;
    /** Why nothing was written. Null on success. */
    error: string | null;
};

export type BlueprintOpenScreenshotsResult = {
    outcome: "opened" | "failed";
    /** The folder that was opened, absolute, or null when none was. */
    path: string | null;
    error: string | null;
};

/**
 * One sentence in one place, so the packaged game, Dev Mode, the web export and the story preview
 * all name the same absence the same way.
 *
 * Names the platform rather than the shell because that is the part a player could act on, and it
 * is what an author reading their own `Failed` branch in Dev Mode needs to know about the export
 * they have not built yet.
 */
export const SCREENSHOT_UNSUPPORTED_MESSAGE =
    "Screenshots are not available on this platform.";

/**
 * The file name for a capture taken at `date`, seconds resolved to the millisecond.
 *
 * Sortable, filename-safe on every platform, and free of anything the author or the player named -
 * a story title in a file name is a locale away from being unwritable. The millisecond is there
 * because two captures a frame apart are an ordinary thing for a graph to do, and a collision would
 * silently overwrite the first.
 */
export function blueprintScreenshotFileName(date: Date): string {
    const pad = (value: number, width = 2) => String(value).padStart(width, "0");
    return `screenshot-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
        + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
        + `-${pad(date.getMilliseconds(), 3)}.png`;
}
