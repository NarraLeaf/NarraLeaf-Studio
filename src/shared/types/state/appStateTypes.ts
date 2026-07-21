
export type RecentlyOpenedProject = {
    name: string;
    path: string;
    icon?: string;
    openedAt: number;
    securityScopedBookmark?: string;
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
