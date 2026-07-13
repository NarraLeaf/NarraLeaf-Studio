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
export type PluginContributes = {
    /** Blueprint node types this plugin provides (editor def + runtime execute). */
    blueprintNodes?: string[];
    /** Widget element types this plugin provides (editor module + runtime renderer). */
    widgets?: string[];
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
    | { kind: "builtin"; path: string };

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
