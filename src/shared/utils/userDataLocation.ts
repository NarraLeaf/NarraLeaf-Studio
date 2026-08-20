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
 * ## The two places, and why the author picks one per platform group
 *
 * A game folder the player unpacked is a place they can copy, move to another
 * machine, and back up as one thing, and on Windows and Linux that folder holds
 * the executable they launch. On macOS it does not: the executable is inside a
 * signed application bundle, and the folder holding that bundle is not a place
 * files are expected to appear. The two are different enough that the author
 * answers them separately - {@link SaveLocationConfiguration} - rather than
 * choosing once and leaving each platform to interpret it.
 *
 * ## Why the per-user directory is named after the app id
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

/** Which of the two places a shipped game writes the player's files to. */
export type SaveLocationMode =
    /** The per-user directory this platform names, keyed on the app id. */
    | "user-data"
    /** The folder the player's copy of the game sits in. */
    | "app-root";

/**
 * The author's answer for each platform group.
 *
 * Two fields rather than one because the game's own folder means something
 * different on macOS than it does on the other two, and one field would leave
 * that difference to be inferred from the platform at runtime - which is to say,
 * it would leave the author unable to state where a macOS player's saves are.
 */
export type SaveLocationConfiguration = {
    /** Windows and Linux, where the executable sits in a folder the player has. */
    windowsLinux: SaveLocationMode;
    /** macOS, where the executable sits inside an application bundle. */
    macos: SaveLocationMode;
};

/**
 * Beside the game on Windows and Linux, in the per-user directory on macOS.
 *
 * A Windows or Linux copy of a game is a folder: keeping the player's files in
 * it means the whole thing moves, copies and backs up as one. A macOS copy is a
 * bundle in a folder that belongs to the system rather than to this game, so the
 * per-user directory is the one that answers for it.
 */
export const DEFAULT_SAVE_LOCATION_CONFIGURATION: SaveLocationConfiguration = {
    windowsLinux: "app-root",
    macos: "user-data",
};

const SAVE_LOCATION_MODES: readonly SaveLocationMode[] = ["user-data", "app-root"];

/** Coerce an unknown (persisted, partially-written, absent) value into a complete configuration. */
export function normalizeSaveLocationConfiguration(value: unknown): SaveLocationConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_SAVE_LOCATION_CONFIGURATION };
    }
    const record = value as Record<string, unknown>;
    return {
        windowsLinux: readMode(record.windowsLinux, DEFAULT_SAVE_LOCATION_CONFIGURATION.windowsLinux),
        macos: readMode(record.macos, DEFAULT_SAVE_LOCATION_CONFIGURATION.macos),
    };
}

function readMode(value: unknown, fallback: SaveLocationMode): SaveLocationMode {
    return SAVE_LOCATION_MODES.includes(value as SaveLocationMode) ? value as SaveLocationMode : fallback;
}

/** The mode one platform runs under. */
export function saveLocationModeFor(
    config: SaveLocationConfiguration,
    platform: UserDataPlatform,
): SaveLocationMode {
    return platform === "macos" ? config.macos : config.windowsLinux;
}

/**
 * The per-user root the directory sits under, as the fixed lists in store
 * configuration forms name it, plus the game's own folder for the builds that
 * write there. Stable identifiers rather than paths: the whole point is that
 * each one is resolved by the machine reading it.
 */
export type UserDataRootId =
    | "windows-appdata-roaming"
    | "macos-application-support"
    | "linux-xdg-data-home"
    | "game-install-dir";

export type UserDataLocation = {
    platform: UserDataPlatform;
    root: UserDataRootId;
    /**
     * The root as a player's machine spells it, e.g. `%APPDATA%`. Null for the
     * game's own folder, which has no such spelling - it is wherever that player
     * put their copy, and only a reader who can name it in their own words can
     * write it down.
     */
    rootDisplay: string | null;
    /** What sits below the root, in this platform's separator. Empty when the root is the directory. */
    relative: string;
    /** This platform's path separator, so a caller can spell the two parts as one path. */
    separator: string;
};

/**
 * One group of files that belongs to the player, in the terms a sync rule is
 * written in. Split by group rather than published as one recursive sweep of the
 * directory because the directory may also hold files that are not the player's
 * - and, when the game writes beside itself, the game itself.
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

const ROOT_DISPLAY: Record<Exclude<UserDataRootId, "game-install-dir">, string> = {
    "windows-appdata-roaming": "%APPDATA%",
    "macos-application-support": "~/Library/Application Support",
    // The default when the variable is unset. Shown rather than `$XDG_DATA_HOME`
    // because this is the path a player will actually have; `root` carries the
    // variable for anyone filling in a form that asks for the root by name.
    "linux-xdg-data-home": "~/.local/share",
};

const PER_USER_ROOT: Record<UserDataPlatform, Exclude<UserDataRootId, "game-install-dir">> = {
    windows: "windows-appdata-roaming",
    macos: "macos-application-support",
    linux: "linux-xdg-data-home",
};

const SEPARATOR: Record<UserDataPlatform, string> = {
    windows: "\\",
    macos: "/",
    linux: "/",
};

/** Where `directoryName` resolves on each desktop platform, in display order. */
export function describeUserDataLocations(
    directoryName: string,
    config: SaveLocationConfiguration,
): UserDataLocation[] {
    return (["windows", "macos", "linux"] as const).map(platform => location(platform, directoryName, config));
}

function location(
    platform: UserDataPlatform,
    directoryName: string,
    config: SaveLocationConfiguration,
): UserDataLocation {
    const separator = SEPARATOR[platform];
    if (saveLocationModeFor(config, platform) === "app-root") {
        // The player's own folder, so there is nothing below it to name: the
        // groups above say what appears there, and the app id names nothing
        // because two copies of a game in two folders never shared a directory
        // in the first place.
        return { platform, root: "game-install-dir", rootDisplay: null, relative: "", separator };
    }
    const root = PER_USER_ROOT[platform];
    return { platform, root, rootDisplay: ROOT_DISPLAY[root], relative: directoryName, separator };
}

/**
 * One location as a line of text, given whatever the reader calls the folder a
 * game was unpacked into - the one part of this that has to come from the
 * caller, because it is the one part with no spelling of its own.
 */
export function formatUserDataLocation(location: UserDataLocation, gameFolderLabel: string): string {
    const root = location.rootDisplay ?? gameFolderLabel;
    return location.relative ? `${root}${location.separator}${location.relative}` : root;
}

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
