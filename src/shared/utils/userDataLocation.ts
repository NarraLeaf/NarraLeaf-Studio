/**
 * Where a shipped game keeps the files that belong to the player, and how to
 * state that to whoever is configuring a store's save synchronisation.
 *
 * Those forms all ask for the same three things: a per-user root picked from a
 * fixed list, a path relative to it, and a filename mask. So that is the shape
 * described here rather than a resolved absolute path - an absolute path taken
 * from the machine that produced the build is wrong on every machine that runs
 * it, and no such form accepts one anyway.
 *
 * ## Why the directory is named after the app id
 *
 * Electron's default is the application's *display* name, which a project may
 * rename at any time and which a build variant can override per build. Either
 * one moves the folder, so a game that is renamed after release stops writing
 * where it used to - and every sync rule configured against the old location
 * silently stops covering anything. The app id is the one piece of the identity
 * that is meant to outlive renames, so the folder is keyed on it and the runtime
 * sets the path explicitly instead of letting the shell derive one.
 *
 * ## Why Linux is the odd one out
 *
 * Electron puts `userData` under `XDG_CONFIG_HOME`, which is both the wrong XDG
 * category for save data and a location most sync forms cannot name: their Linux
 * roots are the home directory and `XDG_DATA_HOME`, never the config directory.
 * Expressing it would mean writing `~/.config/...` under the home root, which is
 * a guess that breaks for any player who has set `XDG_CONFIG_HOME`. Writing to
 * `XDG_DATA_HOME` is both correct by the spec and exactly nameable.
 */

export type UserDataPlatform = "windows" | "macos" | "linux";

/**
 * The per-user root the directory sits under, as the fixed lists in store
 * configuration forms name it. Stable identifiers rather than paths: the whole
 * point is that each one is resolved by the machine reading it.
 */
export type UserDataRootId =
    | "windows-appdata-roaming"
    | "macos-application-support"
    | "linux-xdg-data-home";

export type UserDataLocation = {
    platform: UserDataPlatform;
    root: UserDataRootId;
    /** The root as a player's machine spells it, e.g. `%APPDATA%`. */
    rootDisplay: string;
    /** The directory the game writes to, root included, in this platform's separator. */
    display: string;
};

/**
 * One group of files that belongs to the player, in the terms a sync rule is
 * written in. Split by group rather than published as one recursive sweep of the
 * directory because the directory also holds the shell's own state - Chromium
 * caches, cookies, sidecar working directories - none of which is the player's
 * and none of which should travel between their machines.
 */
export type UserDataContentGroup = {
    id: "saves" | "persistence";
    /** Path relative to the user data directory. `.` when the files sit at its root. */
    subdirectory: string;
    /** Filename mask, where `*` stands for any run of characters. */
    pattern: string;
    recursive: boolean;
};

/**
 * Must stay in step with RuntimeSaveStore and RuntimePersistenceStore, which own
 * the actual paths. The save store's atomic writes leave `<name>.json.<pid>.<ts>.tmp`
 * behind mid-write; the mask ends in `.json` so those are never picked up
 * half-written.
 */
export const USER_DATA_CONTENT_GROUPS: readonly UserDataContentGroup[] = [
    { id: "saves", subdirectory: "saves", pattern: "*.json", recursive: false },
    { id: "persistence", subdirectory: ".", pattern: "persistence.json", recursive: false },
];

const ROOT_DISPLAY: Record<UserDataRootId, string> = {
    "windows-appdata-roaming": "%APPDATA%",
    "macos-application-support": "~/Library/Application Support",
    // The default when the variable is unset. Shown rather than `$XDG_DATA_HOME`
    // because this is the path a player will actually have; `root` carries the
    // variable for anyone filling in a form that asks for the root by name.
    "linux-xdg-data-home": "~/.local/share",
};

/**
 * The directory name for a game shipping under `appId`. App ids are already
 * restricted to letters, digits, dashes and dots, so this is a rename rather
 * than a sanitize; the guard is here so a malformed id fails as an empty name
 * the caller can refuse rather than as a path escape.
 */
export function userDataDirectoryName(appId: string): string {
    return appId
        .trim()
        // One path segment, never a path: separators cannot survive.
        .replace(/[/\\]+/g, "-")
        // A leading dot hides the directory on two of the three platforms, and a
        // leading `..` climbs out of the root it was joined to.
        .replace(/^[.-]+/, "")
        .replace(/-{2,}/g, "-");
}

/** Where `directoryName` resolves on each desktop platform, in display order. */
export function describeUserDataLocations(directoryName: string): UserDataLocation[] {
    return [
        location("windows", "windows-appdata-roaming", directoryName, "\\"),
        location("macos", "macos-application-support", directoryName, "/"),
        location("linux", "linux-xdg-data-home", directoryName, "/"),
    ];
}

function location(
    platform: UserDataPlatform,
    root: UserDataRootId,
    directoryName: string,
    separator: string,
): UserDataLocation {
    const rootDisplay = ROOT_DISPLAY[root];
    return {
        platform,
        root,
        rootDisplay,
        display: directoryName ? `${rootDisplay}${separator}${directoryName}` : rootDisplay,
    };
}
