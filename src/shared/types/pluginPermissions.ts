export const ApiCapability = {
    PluginPermissionGrant: "plugin.permission.grant",
    PluginTrustGrant: "plugin.trust.grant",
    PluginFileSystemGrant: "plugin.fs.grant",
    PluginInstallApprove: "plugin.install.approve",
    BashExecute: "bash.execute",
} as const;

export type ApiCapability = typeof ApiCapability[keyof typeof ApiCapability];

export type PluginPermissionPersistence = "temporary" | "permanent";
export type PluginFileSystemPermissionMode = "read" | "write" | "readwrite";

export interface PluginIdentity {
    id: string;
    name?: string;
    version?: string;
    publisher?: string;
}

interface PluginPermissionRequestBase {
    requestId: string;
    plugin: PluginIdentity;
    reason?: string;
    requestedAt?: number;
}

export type PluginPermissionRequest =
    | (PluginPermissionRequestBase & {
        kind: "trust";
        persistence?: PluginPermissionPersistence;
    })
    | (PluginPermissionRequestBase & {
        kind: "filesystem";
        path: string;
        mode: PluginFileSystemPermissionMode;
        recursive: boolean;
        persistence: PluginPermissionPersistence;
    })
    | (PluginPermissionRequestBase & {
        kind: "install";
        source: string;
        persistence?: PluginPermissionPersistence;
    })
    | (PluginPermissionRequestBase & {
        kind: "api";
        capability: string;
        persistence?: PluginPermissionPersistence;
    });

export interface PluginPermissionDecision {
    requestId: string;
    approved: boolean;
    persistence?: PluginPermissionPersistence;
}

export interface PluginPermissionGrantPayload {
    request: PluginPermissionRequest;
    decision: PluginPermissionDecision;
}

export interface PluginPermissionGrantResult {
    requestId: string;
    pluginId: string;
    kind: PluginPermissionRequest["kind"];
    approved: boolean;
    persistence: PluginPermissionPersistence;
    grantedAt?: number;
}

export interface PluginTrustGrantRecord {
    plugin: PluginIdentity;
    trusted: true;
    persistence: PluginPermissionPersistence;
    grantedAt: number;
    sourceRequestId: string;
}

export interface PluginFileSystemGrantRecord {
    plugin: PluginIdentity;
    path: string;
    mode: PluginFileSystemPermissionMode;
    recursive: boolean;
    persistence: PluginPermissionPersistence;
    grantedAt: number;
    sourceRequestId: string;
}

export interface PluginApiGrantRecord {
    plugin: PluginIdentity;
    capability: string;
    persistence: PluginPermissionPersistence;
    grantedAt: number;
    sourceRequestId: string;
}

export interface PluginPermissionPromptProps {
    request: PluginPermissionRequest;
}

export type PluginPermissionPromptResult = PluginPermissionGrantResult | null;
