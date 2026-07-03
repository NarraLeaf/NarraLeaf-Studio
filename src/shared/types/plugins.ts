import type { PluginInstallPermission, PluginIdentity } from "./pluginPermissions";

export const PluginManifestVersion = 1;

export type PluginManifestV1 = Omit<PluginIdentity, "id" | "name" | "version"> & Required<Pick<PluginIdentity, "id" | "name" | "version">> & {
    manifestVersion: typeof PluginManifestVersion;
    description?: string;
    entry?: string;
    permissions?: PluginInstallPermission[];
};

export type NormalizedPluginManifestV1 = PluginManifestV1 & {
    entry: string;
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
    manifest: NormalizedPluginManifestV1;
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
    manifest: NormalizedPluginManifestV1;
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

export type WorkspacePluginDescriptor = {
    plugin: PluginIdentity;
    manifest: NormalizedPluginManifestV1;
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
