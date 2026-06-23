import type {
    PluginFileSystemPermissionMode,
    PluginInstallPermission,
} from "../types/pluginPermissions";

export const NO_INSTALL_PERMISSIONS_COPY = "No privileged Studio controls are included in this install approval.";

export function describePluginInstallPermissions(permissions: readonly PluginInstallPermission[] | undefined): string[] {
    if (!permissions?.length) {
        return [NO_INSTALL_PERMISSIONS_COPY];
    }

    return permissions.map(describePluginInstallPermission);
}

export function describePluginInstallPermission(permission: PluginInstallPermission): string {
    switch (permission.kind) {
        case "filesystem":
            return `${formatFileSystemMode(permission.mode)} ${permission.recursive ? "inside" : "for"} ${singleLine(permission.path, "declared path")}`;
        case "api":
            return `Use Studio API capability: ${singleLine(permission.capability, "declared capability")}`;
        default:
            return exhaustive(permission);
    }
}

function formatFileSystemMode(mode: PluginFileSystemPermissionMode): string {
    switch (mode) {
        case "read":
            return "Read access";
        case "write":
            return "Write access";
        case "readwrite":
            return "Read and write access";
        default:
            return mode;
    }
}

function singleLine(value: string, fallback: string): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    return normalized || fallback;
}

function exhaustive(value: never): never {
    throw new Error(`Unsupported plugin install permission: ${JSON.stringify(value)}`);
}
