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

/**
 * Whether every permission in `next` is already covered by something the user
 * granted in `granted` — i.e. an update that does not *widen* the blast radius.
 *
 * This is what lets a version bump skip the approval prompt. It is deliberately
 * one-directional and conservative: anything this cannot prove is covered counts
 * as a widening, and the user gets asked again. Dropping a permission is fine;
 * only additions matter.
 */
export function isPermissionSubset(
    next: readonly PluginInstallPermission[] | undefined,
    granted: readonly PluginInstallPermission[] | undefined,
): boolean {
    const wanted = next ?? [];
    const held = granted ?? [];
    return wanted.every(permission => held.some(existing => covers(existing, permission)));
}

/** Whether a granted permission fully subsumes a requested one. */
function covers(granted: PluginInstallPermission, requested: PluginInstallPermission): boolean {
    if (granted.kind !== requested.kind) {
        return false;
    }
    if (granted.kind === "api" && requested.kind === "api") {
        return granted.capability === requested.capability;
    }
    if (granted.kind === "filesystem" && requested.kind === "filesystem") {
        return coversFileSystemMode(granted.mode, requested.mode)
            && coversPath(granted, requested);
    }
    return false;
}

function coversFileSystemMode(
    granted: PluginFileSystemPermissionMode,
    requested: PluginFileSystemPermissionMode,
): boolean {
    return granted === "readwrite" || granted === requested;
}

/**
 * A non-recursive grant covers only its exact path. A recursive one also covers
 * anything beneath it — compared on normalized `/`-separated segments so
 * `/a/bc` is not mistaken for a child of `/a/b`.
 */
function coversPath(
    granted: Extract<PluginInstallPermission, { kind: "filesystem" }>,
    requested: Extract<PluginInstallPermission, { kind: "filesystem" }>,
): boolean {
    const from = normalizePathSegments(granted.path);
    const to = normalizePathSegments(requested.path);
    if (!granted.recursive) {
        return !requested.recursive && from.join("/") === to.join("/");
    }
    return to.length >= from.length && from.every((segment, index) => segment === to[index]);
}

function normalizePathSegments(value: string): string[] {
    return value.replace(/\\/g, "/").split("/").filter(Boolean);
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
