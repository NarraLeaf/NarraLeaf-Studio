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
export function resolveRuntimeUserDataDir(
  directoryName: string | null,
  env: PlayerDataEnvironment
): string {
  const named = namedUserDataDir(directoryName, env);
  if (!named || named === env.shellUserDataDir) {
    return env.shellUserDataDir;
  }
  // Never write into a directory already in use; an install that has run once
  // has nothing left to carry across.
  if (env.exists(named) || !env.exists(env.shellUserDataDir)) {
    return named;
  }
  if (!PLAYER_DATA_MARKERS.some((marker) => env.exists(path.join(env.shellUserDataDir, marker)))) {
    return named;
  }
  try {
    env.makeDirectory(path.dirname(named));
    env.move(env.shellUserDataDir, named);
    return named;
  } catch (error) {
    env.warn(
      `Could not move the player's files from ${env.shellUserDataDir} to ${named} ` +
        `(${String(error)}); continuing on the old location.`
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
    const root =
      configured && path.isAbsolute(configured)
        ? configured
        : path.join(env.homeDir, ".local", "share");
    return path.join(root, directoryName);
  }
  return path.join(env.appDataDir, directoryName);
}
