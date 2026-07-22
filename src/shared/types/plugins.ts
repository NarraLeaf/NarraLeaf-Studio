import type { PluginInstallPermission, PluginIdentity } from "./pluginPermissions";

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
};

export type PluginManifestV2 = Omit<PluginIdentity, "id" | "name" | "version"> & Required<Pick<PluginIdentity, "id" | "name" | "version">> & {
    manifestVersion: typeof PluginManifestVersion;
    description?: string;
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
