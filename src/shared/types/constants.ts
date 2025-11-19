export const RendererInterfaceKey = "__NLS_RENDERER_INTERFACE__";
export const AppProtocol = "app";
export enum AppHost {
    Public = "public",
    Windows = "windows",
    Fs = "fs",
}

// PersistentState constants
export const PERSISTENT_STATE_DB_EXTENSION = ".db";
export const PERSISTENT_STATE_DEFAULT_DB_NAME = "state";

// UserData namespace constants
export enum UserDataNamespace {
    State = "state",
    UserSettings = "user_settings",
    Logs = "logs",
    Plugins = "plugins",
}