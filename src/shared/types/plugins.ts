import type {
    PluginIdentity,
    PluginInstallPermission,
    PluginRuntimeCapability,
} from "./pluginPermissions";

export const PluginManifestVersion = 2;

/**
 * Per-target plugin entry files. Each entry is a prebundled ESM file relative
 * to the plugin package root. At least one target must be declared.
 *
 * - `studio`: loaded in the workspace window only; talks to the
 *   `narraleaf-studio/plugin` host API (editor extensions).
 * - `runtime`: loaded in every game execution environment (Dev Mode window,
 *   Preview, Production); talks to the `narraleaf-studio/runtime` host API
 *   (game logic such as blueprint node execute bindings).
 */
export type PluginManifestEntries = {
    studio?: string;
    runtime?: string;
};

/**
 * Declarative contribution manifest. Lets Studio validate a project statically
 * (without executing plugin code): every plugin blueprint node / widget type
 * used by a project's documents must be declared here by the plugin that
 * provides its runtime binding. Registration APIs enforce consistency at load
 * time: registering an undeclared type is an error on both targets.
 */
/**
 * One Studio language-pack contribution: a locale this plugin adds (a brand-new
 * locale) or extends (fills gaps in a built-in locale). `messages` is a
 * safe-relative path to a JSON catalog (`{ "studio.key": "translation" }`).
 * Meta fields are honored only for a brand-new locale; for a built-in locale
 * they are ignored. `nativeName` is strongly recommended for a new locale (it is
 * the endonym shown in the language picker; the code is used if omitted).
 */
export type PluginLocaleContribution = {
    code: string;
    nativeName?: string;
    englishName?: string;
    intl?: string;
    dir?: "ltr" | "rtl";
    messages: string;
};

/**
 * Desktop platform/arch key a sidecar or build dependency ships binaries for,
 * spelled `<platform>-<arch>` (e.g. `windows-x64`, `macos-arm64`).
 *
 * Only the three desktop platforms are addressable: web has no process to spawn
 * and the mobile shells are WebViews. A plugin that declares nothing for the
 * platform being built simply has no sidecar there, and its runtime must degrade
 * rather than assume one exists.
 */
export type PluginBinaryPlatformKey = string;

export type PluginSidecarTargetContribution = {
    /** Executable (or, for `kind: "node"`, the .js file) to run. Must appear in `include`. */
    entry: string;
    /**
     * Everything shipped for this platform. Entries are package-relative paths,
     * or `dep:<buildDependencyId>/<path>` to pull an artifact produced by a
     * declared build dependency (that is how third-party redistributables that
     * we may not vendor ourselves reach the pack).
     */
    include: string[];
    /**
     * `sha256` of every package-relative entry in `include`, hex. Verified at
     * install and again at pack time, so a tampered package fails to install
     * instead of silently shipping a different binary. `dep:` entries are covered
     * by the build dependency's own digest instead.
     */
    sha256: Record<string, string>;
};

/**
 * One native child process the plugin ships inside the author's game.
 *
 * This is the heaviest thing a plugin can declare — it is code that reaches the
 * player's machine — so it is deliberately explicit: per-platform binaries,
 * mandatory digests, and a derived install permission the author sees by name.
 */
export type PluginSidecarContribution = {
    /** Prefixed with the plugin id, like every other contributed identifier. */
    id: string;
    /** `executable` spawns the binary directly; `node` runs it under the game's own Electron as Node. */
    kind: "executable" | "node";
    /** v1 speaks newline-delimited JSON over stdio; stderr stays a plain log channel. */
    transport: "stdio-jsonl";
    /** `onGameStart` spawns with the window; `onRequest` waits for the first call. */
    autostart: "onGameStart" | "onRequest";
    /** How long the handshake may take before the sidecar counts as unavailable. */
    startupTimeoutMs: number;
    /** Grace period between the shutdown message and SIGTERM. */
    shutdownTimeoutMs: number;
    restart: { maxRetries: number; backoffMs: number };
    targets: Record<PluginBinaryPlatformKey, PluginSidecarTargetContribution>;
};

/**
 * One external binary fetched at build time rather than vendored in the plugin
 * package — the answer for redistributables whose license lets the *game* ship
 * them but does not let a public plugin registry mirror them.
 */
export type PluginBuildDependencyTargetContribution =
    | {
        url: string;
        /** Mandatory. Doubles as the cache key, so re-pointing the URL at identical bytes never re-downloads. */
        sha256: string;
        archive: "zip";
        /** Archive-internal path -> path inside the produced dependency directory. */
        files: Record<string, string>;
    }
    | {
        url: string;
        sha256: string;
        archive: "none";
        /** Name the downloaded file takes inside the produced dependency directory. */
        fileName: string;
    };

export type PluginBuildDependencyContribution = {
    /** Prefixed with the plugin id. Referenced from sidecar `include` as `dep:<id>/<path>`. */
    id: string;
    /** Shown to the author at install and in build logs; say what the binaries are. */
    description?: string;
    targets: Record<PluginBinaryPlatformKey, PluginBuildDependencyTargetContribution>;
};

export type PluginContributes = {
    /** Blueprint node types this plugin provides (editor def + runtime execute). */
    blueprintNodes?: string[];
    /** Widget element types this plugin provides (editor module + runtime renderer). */
    widgets?: string[];
    /** Studio language packs: locales this plugin adds or fills. */
    locales?: PluginLocaleContribution[];
    /**
     * Plugin storage namespaces to publish with the game, readable at runtime
     * through `app.game.data.readJson(namespace)`.
     *
     * Plugin stores live under the project's `editor/` directory, which is never
     * packaged. A plugin whose runtime needs authored data (catalogs, tables)
     * must list those namespaces here. The list is an explicit allowlist so
     * editor-only plugin state cannot leak into a shipped game by accident.
     */
    runtimeData?: string[];
    /**
     * Capability domains the `runtime` entry may use. Each maps 1:1 onto a
     * namespace on `app.game`, and an undeclared domain is absent from that
     * object rather than present-and-throwing — so what the install prompt
     * listed and what the plugin can reach are the same set by construction.
     */
    runtimeCapabilities?: PluginRuntimeCapability[];
    /** Native child processes shipped inside the author's game. */
    sidecars?: PluginSidecarContribution[];
    /** External binaries fetched (and cached) at build time. */
    buildDependencies?: PluginBuildDependencyContribution[];
};

export type PluginManifestV2 = Omit<PluginIdentity, "id" | "name" | "version"> & Required<Pick<PluginIdentity, "id" | "name" | "version">> & {
    manifestVersion: typeof PluginManifestVersion;
    description?: string;
    /**
     * Package-relative path to the thumbnail shown beside the plugin's name in
     * the Launcher list. Square, at most 512x512, and one of the extensions in
     * `PLUGIN_ICON_EXTENSIONS`. Plugins without one keep the name monogram.
     */
    icon?: string;
    entries: PluginManifestEntries;
    contributes?: PluginContributes;
    permissions?: PluginInstallPermission[];
};

export type NormalizedPluginManifestV2 = PluginManifestV2 & {
    contributes: Required<PluginContributes>;
    permissions: PluginInstallPermission[];
};

export type PluginInstallSource =
    | { kind: "local-directory"; path: string }
    | { kind: "builtin"; path: string }
    | { kind: "registry"; url: string };

export type PluginInstallRecord = {
    pluginId: string;
    installPath: string;
    enabled: boolean;
    builtIn: boolean;
    manifest: NormalizedPluginManifestV2;
    installSource: PluginInstallSource;
    installedAt: number;
    updatedAt: number;
    grantedManifestVersion?: string | null;
    /**
     * The permission set the user actually approved, recorded so a later version
     * that does not widen it can inherit the grant instead of re-prompting.
     * Absent on records written before this was tracked — the manifest at
     * `grantedManifestVersion` is the fallback source of truth for those.
     */
    grantedPermissions?: PluginInstallPermission[] | null;
    lastError?: string | null;
};

export type PluginStatus =
    | "enabled"
    | "disabled"
    | "needsAuthorization"
    | "error";

export type PluginListItem = {
    pluginId: string;
    manifest: NormalizedPluginManifestV2;
    /**
     * `app://` address of the declared icon, absent when the plugin ships none.
     * Resolved here rather than in the renderer because only the main process
     * knows where the package landed on disk.
     */
    iconUrl?: string;
    installPath: string;
    enabled: boolean;
    builtIn: boolean;
    status: PluginStatus;
    installSource: PluginInstallSource;
    installedAt: number;
    updatedAt: number;
    grantedManifestVersion?: string | null;
    lastError?: string | null;
};

/** Descriptor handed to the workspace window: plugins with a studio entry. */
export type WorkspacePluginDescriptor = {
    plugin: PluginIdentity;
    manifest: NormalizedPluginManifestV2;
    entryUrl: string;
};

/** Descriptor handed to game execution environments: plugins with a runtime entry. */
export type RuntimePluginDescriptor = {
    plugin: PluginIdentity;
    manifest: NormalizedPluginManifestV2;
    entryUrl: string;
    /**
     * Published plugin storage, keyed by the namespaces declared in
     * `contributes.runtimeData`. Absent namespaces simply have no entry - a
     * plugin must tolerate missing data (the project may never have written it).
     */
    data?: Record<string, unknown>;
};

export type PluginInstallResult =
    | {
        canceled: true;
        plugin?: never;
    }
    | {
        canceled: false;
        plugin: PluginListItem;
    };

export type PluginApproveResult = {
    plugin: PluginListItem;
    approved: boolean;
};
