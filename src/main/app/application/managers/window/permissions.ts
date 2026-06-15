import path from "path";
import { WindowAppType } from "@shared/types/window";
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
    runtimeGrants?: RuntimeGrantPolicy;
};

const noFileSystemAccess = (): FileSystemGrant[] => [];
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

export const windowPermissionDeclarations: { [T in WindowAppType]: WindowPermissionDeclaration } = {
    [WindowAppType.Launcher]: { fs: noFileSystemAccess },
    [WindowAppType.Settings]: { fs: noFileSystemAccess },
    [WindowAppType.ProjectWizard]: { fs: noFileSystemAccess },
    [WindowAppType.Workspace]: { fs: projectFileSystemAccess, runtimeGrants: workspaceImportGrants },
    [WindowAppType.DevMode]: { fs: projectFileSystemAccess },
    [WindowAppType.Raw]: { fs: noFileSystemAccess },
};

export function getDeclaredFileSystemGrants(window: AppWindow, mode: FileSystemAccessMode): FileSystemGrant[] {
    return windowPermissionDeclarations[window.getWindowType()]
        .fs({ window })
        .filter(grant => grant.mode === mode);
}

export function getRuntimeGrantPolicy(window: AppWindow, grantType: keyof RuntimeGrantPolicy): RuntimeGrantPolicy[typeof grantType] {
    return windowPermissionDeclarations[window.getWindowType()].runtimeGrants?.[grantType];
}
