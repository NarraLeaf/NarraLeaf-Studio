import path from "path";

/**
 * The Studio-side half of the "this window is in trouble" dialogs, kept apart from the dialogs
 * themselves so it can be tested without an Electron window. The crash-loop policy is shared with
 * the game runtime; see `@shared/utils/crashLoop`.
 */

/**
 * What to call the window in a dialog: the project it holds, or nothing.
 *
 * The folder name rather than the whole path - the dialog names which window is in trouble, and a
 * line of `C:\Users\...` wrapped across a message box answers that worse than one word does.
 */
export function describeWindowSubject(projectPath: unknown): string | null {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
        return null;
    }
    const name = path.basename(projectPath);
    return name.length > 0 ? name : null;
}
