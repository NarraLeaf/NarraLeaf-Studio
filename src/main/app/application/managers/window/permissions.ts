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
    /** Save-dialog picks need a write grant on the chosen destination. */
    selectSaveFile?: {
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
    /**
     * Files another window of the same Studio process offered, redeemed against a token that
     * crossed the clipboard with a paste. The manifest was verified against the offering window's
     * own read access before the token existed. See `@shared/types/assetTransfer`.
     *
     * Non-recursive for a file entry: the grant covers exactly the path the manifest named.
     * `recursiveForDirectories` is the one exception, and it is a separate field rather than a
     * looser `recursive` so that neither reach can be handed out in place of the other - a model
     * bundle is a directory, its contents are the asset, and an entry that is not one gets no reach
     * below the file it names.
     *
     * Declaring it says the window type takes part in asset transfer at all, which is why both
     * halves - offering and redeeming - are gated on it.
     */
    transferredAsset?: {
        mode: FileSystemGrantMode;
        recursive: false;
        recursiveForDirectories: true;
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
    selectSaveFile: { mode: "write", recursive: false },
    selectDirectory: { mode: "read", recursive: true },
    droppedFile: { mode: "read", recursive: false },
    transferredAsset: { mode: "read", recursive: false, recursiveForDirectories: true },
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

/**
 * `PluginInstall` is here because the workspace now manages plugins too (the Plugins panel), not
 * only the Launcher. It is the capability behind install / enable / disable / uninstall.
 *
 * It does NOT hand plugins that power: a plugin calls through its own actor identity, which is
 * checked against the permissions it was installed with (`isPluginCapabilityAllowed`), never
 * against the window's defaults. Installing from the store still raises the permission prompt
 * window the author has to answer.
 *
 * That separation is only real if a plugin cannot get hold of a service object the *renderer* bound
 * to the window's default facade. A plugin action's `onClick` and a rail button's `railAction` are
 * handed the live `Workspace`, whose `services.get(FileSystem)` is exactly such an object; the
 * renderer wraps both with a guard that refuses the service registry before plugin code sees them
 * (`pluginWorkspaceGuard`), so the only file-system path left to a plugin is `app.privileged.*`,
 * bound to the plugin's own actor and gated here.
 */
const workspaceDefaultCapabilities = (): PrivilegedCapability[] => [
    PrivilegedCapability.PluginInstall,
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
    // Nothing elevated: the one thing this window does with a yes is `vcs.trustAuthority`,
    // which is open to any window and checks the certificate against Studio's own directory
    // rather than trusting whoever named it.
    [WindowAppType.ServerTrustPrompt]: { fs: noFileSystemAccess, api: noElevatedAccess, capabilities: noDefaultCapabilities },
    // A sample of the interface, drawn from preferences and nothing else. It reads global state
    // and the list of servers this installation is signed in to, both of which are open to any
    // window; it opens no project and touches no file.
    [WindowAppType.Raw]: { fs: noFileSystemAccess, api: noElevatedAccess, capabilities: noDefaultCapabilities },
};

export function getDeclaredFileSystemGrants(window: AppWindow, mode: FileSystemAccessMode): FileSystemGrant[] {
    return windowPermissionDeclarations[window.getWindowType()]
        .fs({ window })
        .filter(grant => grant.mode === mode);
}

/**
 * The policy for one kind of runtime grant, or undefined when this window type declares none.
 *
 * Generic in the key so a caller gets that kind's own policy rather than the union of every kind's:
 * the kinds do not agree on their fields, and reading one through the union would only ever reach
 * what they all happen to share.
 */
export function getRuntimeGrantPolicy<K extends keyof RuntimeGrantPolicy>(
    window: AppWindow,
    grantType: K,
): RuntimeGrantPolicy[K] {
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
