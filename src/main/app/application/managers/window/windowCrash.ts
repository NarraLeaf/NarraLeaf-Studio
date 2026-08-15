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
 *
 * Both separators are cut here rather than left to `path.basename`, which is the host's: on Linux
 * it does not know that `\` divides anything, so a Windows project path comes back whole as one
 * name. Studio holds paths in both shapes - the wizard writes forward slashes on Windows too - so
 * the alternative is a name that depends on which platform the process happens to be running on.
 * The only thing given up is a directory whose name genuinely contains a backslash, which Studio
 * never creates.
 */
export function describeWindowSubject(projectPath: unknown): string | null {
    if (typeof projectPath !== "string" || projectPath.length === 0) {
        return null;
    }
    const segments = projectPath.split(/[\\/]/).filter((segment) => segment.length > 0);
    const name = segments.at(-1);
    return name !== undefined && name.length > 0 ? name : null;
}
