import type { PluginInstallPermission } from "../types/pluginPermissions";
import {
    PluginManifestVersion,
    type NormalizedPluginManifestV1,
    type PluginManifestV1,
} from "../types/plugins";

export type PluginManifestValidationResult =
    | { ok: true; manifest: NormalizedPluginManifestV1 }
    | { ok: false; error: string };

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export function validatePluginManifest(value: unknown): PluginManifestValidationResult {
    if (!isRecord(value)) {
        return invalid("Manifest must be a JSON object");
    }

    if (value.manifestVersion !== PluginManifestVersion) {
        return invalid(`Unsupported plugin manifestVersion: ${String(value.manifestVersion)}`);
    }

    const id = readString(value, "id");
    if (!id || !PLUGIN_ID_PATTERN.test(id)) {
        return invalid("Plugin id must be namespaced, for example publisher.plugin-name");
    }

    const name = readString(value, "name");
    if (!name) {
        return invalid("Plugin name is required");
    }

    const version = readString(value, "version");
    if (!version || !VERSION_PATTERN.test(version)) {
        return invalid("Plugin version must use semver format, for example 1.0.0");
    }

    const entry = readString(value, "entry") || "main.js";
    if (!isSafeRelativeEntry(entry)) {
        return invalid("Plugin entry must be a relative file path inside the plugin package");
    }

    const description = readOptionalString(value, "description");
    const publisher = readOptionalString(value, "publisher");
    const permissions = value.permissions === undefined
        ? []
        : validatePermissions(value.permissions);
    if (!Array.isArray(permissions)) {
        return invalid(permissions);
    }

    const manifest: NormalizedPluginManifestV1 = {
        manifestVersion: PluginManifestVersion,
        id,
        name,
        version,
        entry,
        permissions,
        ...(description ? { description } : {}),
        ...(publisher ? { publisher } : {}),
    };

    return { ok: true, manifest };
}

export function isSafeRelativeEntry(entry: string): boolean {
    if (!entry || entry.startsWith("/") || entry.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(entry)) {
        return false;
    }
    if (entry.includes("\0") || entry.includes("?") || entry.includes("#")) {
        return false;
    }
    const segments = entry.split(/[\\/]+/).filter(Boolean);
    return segments.length > 0 && segments.every(segment => segment !== "." && segment !== "..");
}

function validatePermissions(value: unknown): PluginInstallPermission[] | string {
    if (!Array.isArray(value)) {
        return "Plugin permissions must be an array";
    }

    const permissions: PluginInstallPermission[] = [];
    for (const permission of value) {
        if (!isRecord(permission)) {
            return "Plugin permission entries must be objects";
        }

        if (permission.kind === "filesystem") {
            const path = readString(permission, "path");
            const mode = readString(permission, "mode");
            const recursive = permission.recursive;
            if (!path) {
                return "Filesystem permission path is required";
            }
            if (mode !== "read" && mode !== "write" && mode !== "readwrite") {
                return "Filesystem permission mode must be read, write, or readwrite";
            }
            if (typeof recursive !== "boolean") {
                return "Filesystem permission recursive flag is required";
            }
            permissions.push({ kind: "filesystem", path, mode, recursive });
            continue;
        }

        if (permission.kind === "api") {
            const capability = readString(permission, "capability");
            if (!capability) {
                return "API permission capability is required";
            }
            permissions.push({ kind: "api", capability });
            continue;
        }

        return `Unsupported plugin permission kind: ${String(permission.kind)}`;
    }

    return permissions;
}

function readString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key as string];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalString(record: Record<string, unknown>, key: keyof PluginManifestV1): string | undefined {
    return readString(record, key) ?? undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(error: string): PluginManifestValidationResult {
    return { ok: false, error };
}
