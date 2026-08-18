import { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";
import { isWindowsPlatform, win32 } from "@shared/utils/path";

/**
 * A project's identity: the key two spellings of the same project path have to agree on.
 *
 * Every comparison of project paths goes through this - the history's own dedupe, the
 * "is this project already open" lookup that keeps one project to one window, and the in-flight
 * map that closes the double-click race. They have to agree: a history that treats `C:\game` and
 * `C:\game\` as two projects hands out two entries, and the window lookup then misses on whichever
 * spelling it was not given.
 *
 * **On Windows that is far more than a trailing separator.** `D:\game`, `D:/game`, `D:\\game` and
 * `d:\game` are one directory to the OS and were four projects to Studio - which is exactly what
 * happened, because the spellings come from different places and there is no reason for them to
 * match: a native folder picker answers with `\`, a path typed or scripted in usually carries `/`,
 * and the history remembers whichever one opened the project last. Switching to a project the
 * history knew under the other spelling therefore opened a second window over the same files and
 * left a second entry in the list.
 *
 * Only a comparison key is produced - nothing here is ever stored or shown. The path the author
 * gave is what gets remembered and displayed, however they spelled it.
 *
 * POSIX gets the separator rules it actually has: `\` is a legal character in a file name there,
 * so `/games/a\` is not `/games/a`, and case is significant.
 */
export function normalizeProjectPath(projectPath: string): string {
  return projectPathIdentity(projectPath, isWindowsPlatform);
}

/** {@link normalizeProjectPath} with the platform named, so both sets of rules can be tested. */
export function projectPathIdentity(projectPath: string, windows: boolean): string {
  // A hand-edited `global.json` can hold anything. Throwing here would take out the window
  // lookup, and with it every way to open a project at all.
  if (typeof projectPath !== "string" || projectPath === "") {
    return "";
  }
  if (!windows) {
    return projectPath.replace(/\/+$/, "");
  }
  // `win32.normalize` collapses repeated separators and `.`/`..` while leaving the UNC root's
  // leading pair alone; it writes back whichever separator the input used, so fold afterwards.
  return win32.normalize(projectPath).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

/**
 * Trailing separators off, nothing else touched.
 *
 * Deliberately not {@link normalizeProjectPath}: this feeds what the author *reads* - the folder a
 * project is named after, the home prefix a menu collapses - and the identity key is lower-cased on
 * Windows, which would have renamed "Game One" to "game one" in every list that shows it.
 */
function stripTrailingSeparators(path: string): string {
  return path.replace(/[\\/]+$/, "");
}

/** Last resort when a record has neither a usable name nor a usable path. */
const UNNAMED_PROJECT = "Untitled Project";

/**
 * What to call a remembered project.
 *
 * A history record is supposed to carry the name off the project's manifest, but it is written
 * from whatever the workspace managed to read, and a `.nlproj` that had to be recovered from
 * corruption comes back without one. A record like that used to reach the launcher's avatar helper
 * as `undefined` and throw on `name.length`, which the critical error boundary answered by
 * terminating the app - on every launch from then on, because the record is persisted. Nobody
 * could reach the launcher to delete it.
 *
 * So the name is derived rather than trusted: the folder a project lives in is nearly always what
 * its author calls it anyway. Used on the way in AND on the way out (see `RecentlyOpened` and
 * `useRecentProjects`), which is what heals a store that is already holding a broken record.
 */
export function recentProjectDisplayName(project: {
  name?: string | null;
  path?: string | null;
}): string {
  const named = typeof project.name === "string" ? project.name.trim() : "";
  if (named) {
    return named;
  }
  const path = typeof project.path === "string" ? stripTrailingSeparators(project.path.trim()) : "";
  const folder = path.split(/[\\/]/).pop()?.trim();
  return folder || path || UNNAMED_PROJECT;
}

/**
 * The history as a surface should read it: one record per project, every name filled in.
 *
 * Cheap enough to run on every read, and every read path does - the main process's own
 * `RecentlyOpened.list` and the renderers' `useRecentProjects`, which reads the raw stored array
 * and would otherwise show whatever is in it. A value that reaches a renderer having skipped this
 * is exactly the value that took the app down (see {@link recentProjectDisplayName}).
 *
 * Repairing on read is what heals a store that is already broken, and the same argument carries the
 * dedupe: an installation whose list already holds `D:\game` *and* `D:/game` would otherwise keep
 * offering both until one of them happened to be opened again. The list is newest-first, so the
 * first spelling of a project wins - the one it was last opened by.
 */
export function withRecentProjectNames(
  projects: readonly RecentlyOpenedProject[]
): RecentlyOpenedProject[] {
  const seen = new Set<string>();
  const unique: RecentlyOpenedProject[] = [];
  for (const project of projects) {
    const identity = normalizeProjectPath(project?.path);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    unique.push({ ...project, name: recentProjectDisplayName(project) });
  }
  return unique;
}

/**
 * Collapse a home-directory prefix to `~`, the way a path reads in a menu. Only an exact
 * segment match counts, so `/Users/aria-notes` is never mistaken for a child of `/Users/aria`.
 * A missing or empty `homeDir` leaves the path untouched - the renderer has no cheap way to know
 * the home directory, so it simply shows the full path.
 */
export function collapseHomePath(path: string, homeDir?: string): string {
  if (!homeDir) {
    return path;
  }
  const home = stripTrailingSeparators(homeDir);
  if (path === home) {
    return "~";
  }
  if (path.startsWith(home + "/") || path.startsWith(home + "\\")) {
    return "~" + path.slice(home.length);
  }
  return path;
}

/**
 * The one-line label a recent project gets in a menu: `name (path)`. Shared by the native macOS
 * "Open Recent" submenu and the in-app File dropdown so both read identically. The top-bar
 * switcher shows name and path on separate lines instead and does not use this.
 */
export function formatRecentProjectLabel(project: RecentlyOpenedProject, homeDir?: string): string {
  return `${project.name} (${collapseHomePath(project.path, homeDir)})`;
}
