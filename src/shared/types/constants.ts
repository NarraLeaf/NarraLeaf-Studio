export const RendererInterfaceKey = "__NLS_RENDERER_INTERFACE__";
export const AppProtocol = "app";
export enum AppHost {
    Public = "public",
    Windows = "windows",
    Fs = "fs",
    Plugins = "plugins",
    PluginApi = "plugin-api",
}

// PersistentState constants
export const PERSISTENT_STATE_DB_EXTENSION = ".db";
export const PERSISTENT_STATE_DEFAULT_DB_NAME = "state";

// UserData namespace constants
export enum UserDataNamespace {
    State = "state",
    Logs = "logs",
    Plugins = "plugins",
    Authorization = "authorization",
    BlueprintPersistence = "blueprint-persistence",
    DevModeSaves = "dev-mode-saves",
    /** Cache of the pictures picked as a custom workspace background, named by content hash. */
    Backgrounds = "backgrounds",
    /**
     * Store thumbnails the main process fetched on the renderer's behalf, named
     * `<pluginId>@<version>`. A cache in the true sense: deleting it costs one
     * re-download per plugin the user looks at.
     */
    PluginIcons = "plugin-icons",
    /**
     * The machine's code-signing credential vault: sealed passwords and the key
     * material copied in at import. Machine-level, never inside a project - a
     * project is version controlled and would carry the keys with it.
     */
    Signing = "signing",
}
