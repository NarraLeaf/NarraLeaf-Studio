
export type RecentlyOpenedProject = {
    name: string;
    path: string;
    openedAt: number;
    securityScopedBookmark?: string;
};

/**
 * One remembered project's own app icon, ready to draw.
 *
 * Not part of the record above, and deliberately: the history is persisted global state, rewritten
 * whenever a project is opened and broadcast to every window, so carrying a few hundred kilobytes
 * of base64 per project in it would make each of those writes expensive - and would still be
 * showing the logo the project had the last time it was opened. The main process reads the
 * project's `metadata.icons` instead, on demand (see `readProjectLogo`).
 */
export type RecentProjectIcon = {
    /** The project path, spelled exactly as the history holds it. */
    path: string;
    /** A `data:` URL. Projects with no drawable icon are absent rather than listed with an empty one. */
    icon: string;
};

/**
 * Why a remembered project can no longer be opened.
 *
 * Only absence is described here - a folder that exists but cannot be read (permissions, an
 * offline volume) is never one of these, because offering to forget a project we simply failed to
 * look at is worse than letting the user open it and find out.
 */
export type RecentProjectMissingReason =
    /** Nothing at that path anymore - moved, renamed, or deleted. */
    | "folder-missing"
    /** The folder is there, but its project config is gone, so it is no longer a project. */
    | "not-a-project";

/** A recent-list entry that failed the existence sweep, with enough to name it in a prompt. */
export type MissingRecentProject = {
    name: string;
    path: string;
    reason: RecentProjectMissingReason;
};
