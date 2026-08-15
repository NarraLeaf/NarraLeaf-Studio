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
    /**
     * Everything Studio can throw away without losing work, one directory per
     * {@link CacheNamespace}.
     *
     * A parent for caches rather than a sibling of the product's own data, so
     * "is this safe to delete" is answerable from the path. `plugin-icons` is
     * the exception and stays where it is: see {@link CacheNamespace.PluginIcons}.
     */
    Cache = "cache",
}

/**
 * Directories under {@link UserDataNamespace.Cache}.
 *
 * The rule for putting something here: **deleting it must cost time, never
 * work.** Anything that fails that test is the product's own data and belongs in
 * its own `UserDataNamespace` - which is why `backgrounds/` (the wallpaper the
 * author chose), `dev-mode-saves/` and `signing/` are not here despite looking
 * cache-shaped.
 *
 * Per-project caches do NOT live here. They live under the project's
 * `editor/cache/`, which `@shared/vcs/workingSet` excludes from version control,
 * so a derived file is never committed and never a merge conflict about a fact
 * nobody decided.
 */
export enum CacheNamespace {
    /** Dependencies fetched for game builds. */
    BuildDependencies = "build-deps",
    /**
     * Theme posters from the UI template store, keyed `<themeId>@<version>`.
     * Bytes fetched by main on the renderer's behalf, as with plugin icons.
     */
    UITemplatePosters = "ui-template-posters",
    /**
     * Spellchecker word lists, one gzipped `<code>.txt.gz` per language beside a
     * `<code>.json` naming its source, licence and sha256.
     *
     * A cache in the strict sense: deleting it costs one re-download per language
     * the author checks in, and never a word of their own - the project's own
     * terms live in `editor/dictionary.json`, which is the project's and is
     * version controlled. A dictionary is never written into a project.
     */
    SpellcheckDictionaries = "spellcheck-dictionaries",
}
