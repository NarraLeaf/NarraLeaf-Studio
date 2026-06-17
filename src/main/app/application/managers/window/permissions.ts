import path from "path";
import { WindowAppType } from "@shared/types/window";
import { ApiCapability } from "@shared/types/pluginPermissions";
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
};

type WindowPermissionContext = {
    window: AppWindow;
};

type WindowPermissionDeclaration = {
    fs: (context: WindowPermissionContext) => FileSystemGrant[];
    api?: (context: WindowPermissionContext) => ApiCapability[];
    runtimeGrants?: RuntimeGrantPolicy;
};

const noFileSystemAccess = (): FileSystemGrant[] => [];
const noElevatedAccess = (): ApiCapability[] => [];
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
};

const pluginPermissionElevatedAccess = (): ApiCapability[] => [
    ApiCapability.PluginPermissionGrant,
    ApiCapability.PluginTrustGrant,
    ApiCapability.PluginFileSystemGrant,
    ApiCapability.PluginInstallApprove,
];

export const windowPermissionDeclarations: { [T in WindowAppType]: WindowPermissionDeclaration } = {
    [WindowAppType.Launcher]: { fs: noFileSystemAccess, api: noElevatedAccess },
    [WindowAppType.Settings]: { fs: noFileSystemAccess, api: noElevatedAccess },
    [WindowAppType.ProjectWizard]: { fs: noFileSystemAccess, api: noElevatedAccess },
    [WindowAppType.Workspace]: { fs: projectFileSystemAccess, runtimeGrants: workspaceImportGrants },
    [WindowAppType.DevMode]: { fs: projectFileSystemAccess, api: noElevatedAccess },
    [WindowAppType.PluginPermissionPrompt]: { fs: noFileSystemAccess, api: pluginPermissionElevatedAccess },
    [WindowAppType.Raw]: { fs: noFileSystemAccess, api: noElevatedAccess },
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

export function getDeniedApiCapability(window: AppWindow, required: readonly ApiCapability[] | undefined): ApiCapability | null {
    if (!required || required.length === 0) {
        return null;
    }

    const available = new Set(getDeclaredApiCapabilities(window));
    return required.find(capability => !available.has(capability)) ?? null;
}
