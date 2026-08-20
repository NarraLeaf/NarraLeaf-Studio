/**
 * Where a shipped game keeps the player's files, decided before Chromium starts.
 *
 * Named by the build rather than derived from the application's name, which is
 * what Electron does on its own: that name is a display string a project may
 * change at any time and a build variant may override per build, and each such
 * change silently moves every player's saves somewhere the previous build was
 * not writing. Nothing reports that move, so it is found by players and not by
 * the author. See shared/utils/userDataLocation.ts for the rest of the reasoning,
 * including why Linux does not go through Electron's `appData`.
 *
 * Free of Electron imports so the decision can be exercised for all three
 * platforms from any one of them: everything environmental arrives in
 * {@link PlayerDataEnvironment}.
 */

import path from "path";
import {
    saveLocationModeFor,
    type SaveLocationConfiguration,
    type UserDataPlatform,
} from "@shared/utils/userDataLocation";

export type PlayerDataEnvironment = {
    platform: NodeJS.Platform;
    /** `app.getPath("appData")`: roaming app data on Windows, Application Support on macOS. */
    appDataDir: string;
    /** `app.getPath("userData")`: where the shell would have put it, and where a previous install did. */
    shellUserDataDir: string;
    homeDir: string;
    /** `process.env.XDG_DATA_HOME`, unresolved. */
    xdgDataHome?: string;
    exists: (target: string) => boolean;
    makeDirectory: (target: string) => void;
    move: (from: string, to: string) => void;
    warn: (message: string) => void;
};

/**
 * Files whose presence means a previous install left the player something. The
 * shell creates its own userData eagerly, so the directory existing is no
 * evidence anyone ever played; these are the two the game itself writes.
 */
const PLAYER_DATA_MARKERS = ["saves", "persistence.json"];

/**
 * The directory to use, carrying an earlier install's files across when they are
 * still where the shell used to put them.
 *
 * A failed move keeps the game on the old directory for this run. Starting a
 * player on an empty one is indistinguishable from having lost every save, and
 * writing to the less convenient place is much the smaller of the two problems.
 */
export function resolveRuntimeUserDataDir(directoryName: string | null, env: PlayerDataEnvironment): string {
    const named = namedUserDataDir(directoryName, env);
    if (!named || named === env.shellUserDataDir) {
        return env.shellUserDataDir;
    }
    // Never write into a directory already in use; an install that has run once
    // has nothing left to carry across.
    if (env.exists(named) || !env.exists(env.shellUserDataDir)) {
        return named;
    }
    if (!PLAYER_DATA_MARKERS.some(marker => env.exists(path.join(env.shellUserDataDir, marker)))) {
        return named;
    }
    try {
        env.makeDirectory(path.dirname(named));
        env.move(env.shellUserDataDir, named);
        return named;
    } catch (error) {
        env.warn(
            `Could not move the player's files from ${env.shellUserDataDir} to ${named} `
            + `(${String(error)}); continuing on the old location.`,
        );
        return env.shellUserDataDir;
    }
}

/**
 * The named directory, or null when the manifest names none - every preview, and
 * any pack produced before the name was written. The caller then keeps the
 * shell's own answer rather than inventing one.
 */
function namedUserDataDir(directoryName: string | null, env: PlayerDataEnvironment): string | null {
    if (!directoryName) {
        return null;
    }
    if (env.platform === "linux") {
        // Per the XDG base directory specification a relative value is to be
        // ignored rather than resolved against the working directory.
        const configured = env.xdgDataHome?.trim();
        const root = configured && path.isAbsolute(configured)
            ? configured
            : path.join(env.homeDir, ".local", "share");
        return path.join(root, directoryName);
    }
    return path.join(env.appDataDir, directoryName);
}

/**
 * What this build was told about the folder its own copy sits in.
 *
 * `resourcesPath` rather than the module's own directory, which is inside the
 * archive and is nobody's folder. An AppImage is the case that cannot be derived
 * from it at all: its resources are on a read-only mount under `/tmp`, while the
 * folder the player actually has is the one holding the `.AppImage` file, and
 * only the environment knows where that is.
 */
export type GameRootEnvironment = {
    platform: NodeJS.Platform;
    /** `app.isPackaged`. */
    packaged: boolean;
    /** `process.resourcesPath`. */
    resourcesPath: string;
    /** The runtime main module's own directory. */
    appDir: string;
    /** `process.env.APPIMAGE`, unresolved. */
    appImagePath?: string;
};

/** The runtime's view of the three platforms this configuration is written for. */
export function userDataPlatformOf(platform: NodeJS.Platform): UserDataPlatform {
    if (platform === "win32") {
        return "windows";
    }
    return platform === "darwin" ? "macos" : "linux";
}

/**
 * The folder holding the player's copy of the game: where a patch is looked for,
 * and where the player's files go when the author keeps them beside the game.
 *
 * On Windows and Linux that is the folder holding the executable. On macOS the
 * executable is three levels inside an application bundle, and the folder that
 * answers to "where the player put this game" is the one holding the bundle -
 * not `Contents/`, which is sealed by the signature, is not a place anything may
 * write, and is not somewhere a player would think to drop a file.
 */
export function resolveGameRootDir(env: GameRootEnvironment): string {
    if (!env.packaged) {
        // Preview, and a compiled app directory started by hand: no bundle, no
        // resources directory of its own, so the app directory's parent is the
        // closest thing to a folder somebody has.
        return path.resolve(env.appDir, "..");
    }
    const appImage = env.appImagePath?.trim();
    if (env.platform === "linux" && appImage && path.isAbsolute(appImage)) {
        return path.dirname(appImage);
    }
    if (env.platform === "darwin") {
        // <folder>/Game.app/Contents/Resources -> <folder>
        return path.resolve(env.resourcesPath, "..", "..", "..");
    }
    return path.dirname(env.resourcesPath);
}

/**
 * Where the save and persistence stores write, which is not necessarily where
 * Electron's `userData` points.
 *
 * Only the player's own files follow this setting. The profile Chromium keeps -
 * caches, cookies, code caches - and this process's log stay in the per-user
 * directory whatever the author chose: none of it is the player's, a game folder
 * is not a place any of it would be looked for, and an installation the player
 * cannot write is a reason for saves to fail rather than for the browser to.
 */
export function resolvePlayerFilesDir(input: {
    platform: NodeJS.Platform;
    config: SaveLocationConfiguration;
    gameRootDir: string;
    userDataDir: string;
}): string {
    const mode = saveLocationModeFor(input.config, userDataPlatformOf(input.platform));
    return mode === "app-root" ? input.gameRootDir : input.userDataDir;
}
