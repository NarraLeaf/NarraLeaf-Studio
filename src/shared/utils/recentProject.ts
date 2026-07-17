import { RecentlyOpenedProject } from "@shared/types/state/appStateTypes";

/**
 * Collapse a home-directory prefix to `~`, the way a path reads in a menu. Only an exact
 * segment match counts, so `/Users/aria-notes` is never mistaken for a child of `/Users/aria`.
 * A missing or empty `homeDir` leaves the path untouched — the renderer has no cheap way to know
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
