import path from "path";
import { WindowAppType } from "@shared/types/window";
import { ApiCapability } from "@shared/types/pluginPermissions";
import { PrivilegedCapability } from "@shared/types/privileged";
import type { AppWindow } from "./appWindow";

export type FileSystemAccessMode = "read" | "write";
export type FileSystemGrantMode = FileSystemAccessMode | "readwrite";

export type FileSystemGrant = {
    path: string;
    recursive: boolean;
    mode: FileSystemAccessMode;
};

type RuntimeGrantPolicy = {
    selectFile?: {
        mode: FileSystemGrantMode;
        recursive: false;
    };
    selectDirectory?: {
        mode: FileSystemGrantMode;
        recursive: true;
    };
    droppedFile?: {
        mode: FileSystemGrantMode;
        recursive: false;
    };
};

type WindowPermissionContext = {
    window: AppWindow;
};

type WindowPermissionDeclaration = {
    fs: (context: WindowPermissionContext) => FileSystemGrant[];
    api?: (context: WindowPermissionContext) => ApiCapability[];
    capabilities?: (context: WindowPermissionContext) => PrivilegedCapability[];
    pluginFileSystemGrantAuthority?: (context: WindowPermissionContext) => boolean;
    runtimeGrants?: RuntimeGrantPolicy;
};

const noFileSystemAccess = (): FileSystemGrant[] => [];
const noElevatedAccess = (): ApiCapability[] => [];
const noDefaultCapabilities = (): PrivilegedCapability[] => [];
const noPluginFileSystemGrantAuthority = (): boolean => false;
const pluginFileSystemGrantAuthority = (): boolean => true;
const projectFileSystemAccess = ({ window }: WindowPermissionContext): FileSystemGrant[] => {
    const props = window.getProps();
    if (!("projectPath" in props)) {
        return [];
    }

    const projectPath = path.resolve(props.projectPath);
    return [
        { path: projectPath, recursive: true, mode: "read" },
        { path: projectPath, recursive: true, mode: "write" },
    ];
};

const workspaceImportGrants: RuntimeGrantPolicy = {
    selectFile: { mode: "read", recursive: false },
    selectDirectory: { mode: "read", recursive: true },
    droppedFile: { mode: "read", recursive: false },
};

const pluginPermissionElevatedAccess = (): ApiCapability[] => [
    ApiCapability.PluginPermissionGrant,
    ApiCapability.PluginTrustGrant,
    ApiCapability.PluginFileSystemGrant,
    ApiCapability.PluginInstallApprove,
];

const launcherDefaultCapabilities = (): PrivilegedCapability[] => [
    PrivilegedCapability.PluginInstall,
    PrivilegedCapability.PluginPermissionRequest,
];

const workspaceDefaultCapabilities = (): PrivilegedCapability[] => [
    PrivilegedCapability.PluginPermissionRequest,
    PrivilegedCapability.BashExecute,
];

export const windowPermissionDeclarations: { [T in WindowAppType]: WindowPermissionDeclaration } = {
    [WindowAppType.Launcher]: {
        fs: noFileSystemAccess,
        api: noElevatedAccess,
        capabilities: launcherDefaultCapabilities,
        pluginFileSystemGrantAuthority,
    },
    [WindowAppType.Settings]: { fs: noFileSystemAccess, api: noElevatedAccess, capabilities: noDefaultCapabilities },
    [WindowAppType.ProjectWizard]: { fs: noFileSystemAccess, api: noElevatedAccess, capabilities: noDefaultCapabilities },
    [WindowAppType.Workspace]: { fs: projectFileSystemAccess, api: noElevatedAccess, capabilities: workspaceDefaultCapabilities, runtimeGrants: workspaceImportGrants },
    [WindowAppType.DevMode]: { fs: projectFileSystemAccess, api: noElevatedAccess, capabilities: noDefaultCapabilities },
    [WindowAppType.PluginPermissionPrompt]: { fs: noFileSystemAccess, api: pluginPermissionElevatedAccess, capabilities: noDefaultCapabilities },
    [WindowAppType.Raw]: { fs: noFileSystemAccess, api: noElevatedAccess, capabilities: noDefaultCapabilities },
};

export function getDeclaredFileSystemGrants(window: AppWindow, mode: FileSystemAccessMode): FileSystemGrant[] {
    return windowPermissionDeclarations[window.getWindowType()]
        .fs({ window })
        .filter(grant => grant.mode === mode);
}

export function getRuntimeGrantPolicy(window: AppWindow, grantType: keyof RuntimeGrantPolicy): RuntimeGrantPolicy[typeof grantType] {
    return windowPermissionDeclarations[window.getWindowType()].runtimeGrants?.[grantType];
}

export function getDeclaredApiCapabilities(window: AppWindow): ApiCapability[] {
    return windowPermissionDeclarations[window.getWindowType()].api?.({ window }) ?? [];
}

export function getDeclaredDefaultCapabilities(window: AppWindow): PrivilegedCapability[] {
    return windowPermissionDeclarations[window.getWindowType()].capabilities?.({ window }) ?? [];
}

export function canUsePluginFileSystemGrantsAsWindowPolicy(window: AppWindow): boolean {
    return windowPermissionDeclarations[window.getWindowType()].pluginFileSystemGrantAuthority?.({ window })
        ?? noPluginFileSystemGrantAuthority();
}

export function getDeniedApiCapability(window: AppWindow, required: readonly ApiCapability[] | undefined): ApiCapability | null {
    if (!required || required.length === 0) {
        return null;
    }

    const available = new Set(getDeclaredApiCapabilities(window));
    return required.find(capability => !available.has(capability)) ?? null;
}
