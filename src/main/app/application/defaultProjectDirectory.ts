import path from "path";

/**
 * Where the wizard offers to put a new project.
 *
 * A container of projects rather than a project (the wizard appends the app id), so the answer is a
 * folder the author already thinks of as theirs. On macOS and Linux that is `~/Projects` and there
 * is nothing to decide.
 *
 * Windows is the one that needs a decision. `app.getPath("documents")` returns the *shell* Documents
 * folder, and OneDrive's Known Folder Move points that at the sync root - so the plain answer put
 * every new project inside a cloud-synced folder. A game project is the wrong shape for that: it is
 * gigabytes of assets plus a version history that is written on every save, and the sync client
 * uploads all of it, locks files while it does, and can hydrate a placeholder in the middle of a
 * build. Authors who want their project in the cloud can still put it there; what this decides is
 * only what the field is filled in with.
 *
 * The order below is the preference, and each step is skipped when it lands back inside the sync
 * root: the author's own local Documents, then Downloads, then the home folder itself. Nothing is
 * created here - a candidate that does not exist is not offered, because a second "Documents" beside
 * a redirected one would be its own confusion.
 */

/** The environment as this decision reads it. Passed in so the choice is testable off a real machine. */
export type ProjectDirectoryEnvironment = {
    platform: NodeJS.Platform;
    /** `app.getPath("documents")` - the shell folder, wherever it currently points. */
    documents: string;
    /** `app.getPath("downloads")`. */
    downloads: string;
    /** `app.getPath("home")`. */
    home: string;
    /** `process.env`, for the roots OneDrive publishes. */
    env: Record<string, string | undefined>;
    /** Whether a directory is there now. Never creates one. */
    directoryExists: (candidate: string) => boolean;
};

/** The folder name a project container takes under whichever parent wins. */
const CONTAINER = "Projects";

/**
 * The sync roots to keep out of.
 *
 * The three variables OneDrive sets (personal, commercial, and the one that names whichever is
 * signed in), plus a path-segment check for the setups that have the folder without the variables -
 * a second account, a machine where the client has not run in this session.
 */
function syncRoots(env: Record<string, string | undefined>): string[] {
    return ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .map(name => env[name])
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map(value => path.resolve(value));
}

/** Whether `candidate` is the sync root or sits under it. Compared case-insensitively, as Windows is. */
function isInsideSyncRoot(candidate: string, roots: readonly string[]): boolean {
    const target = path.resolve(candidate).toLowerCase();
    // Prefix rather than an exact segment: a work account's root is "OneDrive - Contoso".
    if (target.split(/[\\/]/).some(segment => segment.startsWith("onedrive"))) {
        return true;
    }
    return roots.some(root => {
        const lower = root.toLowerCase();
        return target === lower || target.startsWith(lower.endsWith(path.sep) ? lower : `${lower}${path.sep}`);
    });
}

export function resolveDefaultProjectDirectory(environment: ProjectDirectoryEnvironment): string {
    const { platform, documents, downloads, home, env, directoryExists } = environment;
    if (platform !== "win32") {
        return path.join(home, CONTAINER);
    }

    const roots = syncRoots(env);
    if (!isInsideSyncRoot(documents, roots)) {
        return path.join(documents, CONTAINER);
    }

    // The redirected case. `%USERPROFILE%\Documents` is where a local Documents folder stays when one
    // survived the move; Downloads is next because it is the one personal folder Known Folder Move
    // leaves alone by default.
    const candidates = [path.join(home, "Documents"), downloads];
    for (const candidate of candidates) {
        if (!isInsideSyncRoot(candidate, roots) && directoryExists(candidate)) {
            return path.join(candidate, CONTAINER);
        }
    }
    return path.join(home, CONTAINER);
}
