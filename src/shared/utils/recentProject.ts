import { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";

/**
 * Strip trailing separators so two spellings of the same project path compare equal.
 *
 * Every comparison of project paths goes through this - the history's own dedupe, and the
 * "is this project already open" lookup that keeps one project to one window. They have to agree:
 * a history that treats `C:\game` and `C:\game\` as two projects hands out two entries, and the
 * window lookup then misses on whichever spelling it was not given.
 */
export function normalizeProjectPath(projectPath: string): string {
    return projectPath.replace(/[\\/]+$/, "");
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
export function recentProjectDisplayName(project: { name?: string | null; path?: string | null }): string {
    const named = typeof project.name === "string" ? project.name.trim() : "";
    if (named) {
        return named;
    }
    const path = typeof project.path === "string" ? normalizeProjectPath(project.path.trim()) : "";
    const folder = path.split(/[\\/]/).pop()?.trim();
    return folder || path || UNNAMED_PROJECT;
}

/**
 * The same list with every record's name filled in. Cheap enough to run on every read, and both
 * read paths do - a value that reaches a renderer having skipped this is exactly the value that
 * took the app down.
 */
export function withRecentProjectNames(projects: readonly RecentlyOpenedProject[]): RecentlyOpenedProject[] {
    return projects.map(project => ({ ...project, name: recentProjectDisplayName(project) }));
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
    const home = homeDir.replace(/[\\/]+$/, "");
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
