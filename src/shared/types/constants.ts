export const RendererInterfaceKey = "__NLS_RENDERER_INTERFACE__";
export const AppProtocol = "app";
export enum AppHost {
    Public = "public",
    Windows = "windows",
    Fs = "fs",
    AppIcon = "app-icon",
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

/**
 * The directory holding everything Studio can throw away without losing work, one subdirectory
 * per {@link CacheNamespace}.
 *
 * A parent for caches rather than a sibling of the product's own data, so "is this safe to
 * delete" is answerable from the path. `plugin-icons` is the exception and stays in userData:
 * see {@link CacheNamespace.PluginIcons}.
 *
 * **The name is not `cache`, and must never become it.** Chromium keeps its own HTTP cache at
 * `<userData>/Cache`, and Windows and the default macOS filesystem do not distinguish the two
 * spellings - so a cache root called `cache` under userData *is* Chromium's directory. That was
 * the state of things until this constant existed: a Zig toolchain sat beside `Cache_Data`, the
 * inventory counted those bytes under both the `toolchains` bucket and the `browser` bucket, and
 * clearing the browser cache deleted every download Studio had made. `cacheDirNameCollides` in
 * `cacheInventory.test.ts` is the guard that keeps it that way.
 *
 * This is a *name*, not a location. Where the root sits is decided at runtime by
 * `resolveCacheRootForApp` - beside the executable where that is writable, under userData
 * otherwise.
 */
export const CACHE_ROOT_DIR_NAME = "nl-cache";

/**
 * Directories under the cache root, {@link CACHE_ROOT_DIR_NAME}.
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
    /**
     * Images a game build re-encoded, keyed by the source bytes and what was
     * asked of them.
     *
     * Global rather than per-project, which the content-addressed key is what
     * makes correct: the same artwork in two projects, or the same project built
     * from a second checkout, is the same entry. Deleting it costs the next build
     * the encoding time it already paid once.
     */
    OptimizedImages = "optimized-images",
    /**
     * Sound and video a game build re-encoded, keyed the same way and kept apart
     * from the images for one reason: size.
     *
     * A project's artwork cache is measured in tens of megabytes and its voice
     * cache in whole gigabytes, so an author looking at what Studio is holding
     * has to be able to see and clear the expensive one without losing the cheap
     * one they would rather keep.
     */
    CompressedMedia = "compressed-media",
    /**
     * Compiler toolchains a build downloads because the host has none, one
     * directory per toolchain and version.
     *
     * Listed on its own rather than folded into the build dependencies beside it,
     * for the reason the media cache is kept apart from the images: a Zig
     * toolchain is a few hundred megabytes even pruned, and an author deciding
     * what to reclaim needs to see that number by itself.
     */
    Toolchains = "toolchains",
    /**
     * Live2D SDK archives unpacked for a puppet runtime build, keyed by the archive's digest.
     *
     * Written by `live2dRuntimeBuild`, which named the directory with a string constant of its
     * own and so stayed out of the inventory entirely - an author could accumulate one unpacked
     * SDK per archive they ever picked with nothing on the interface able to say so.
     */
    PuppetRuntimes = "puppet-runtimes",
    /**
     * electron-builder's own download cache: winCodeSign, NSIS, AppImage, and the Electron
     * distribution a cross-platform target needs.
     *
     * Studio's rather than the host's. electron-builder defaults this to `%LOCALAPPDATA%` (and
     * the platform equivalents), which put several hundred megabytes Studio had fetched somewhere
     * no part of Studio was named in; `ELECTRON_BUILDER_CACHE`, which the build worker is started
     * with, brings it here. An author who exported that variable themselves still wins - see
     * `electronBuilderCacheRoot`.
     */
    ElectronBuilder = "electron-builder",
}
