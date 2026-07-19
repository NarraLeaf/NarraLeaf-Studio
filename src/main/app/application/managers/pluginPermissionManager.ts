import path from "path";
import { UserDataNamespace } from "@shared/types/constants";
import {
    PluginApiGrantRecord,
    PluginPermissionDecision,
    PluginFileSystemGrantRecord,
    PluginFileSystemPermissionMode,
    PluginPermissionGrantResult,
    PluginPermissionPersistence,
    PluginPermissionRequest,
    PluginTrustGrantRecord,
    type PluginIdentity,
} from "@shared/types/pluginPermissions";
import { PersistentState } from "@shared/utils/persistentState";
import { PersistentStateConfig } from "@shared/types/persistentState";

interface PluginAuthorizationState extends Record<string, any> {
    "plugin.trustGrants": Record<string, PluginTrustGrantRecord>;
    "plugin.fileSystemGrants": Record<string, PluginFileSystemGrantRecord[]>;
    "plugin.apiGrants": Record<string, PluginApiGrantRecord[]>;
}

const DEFAULT_STATE: PluginAuthorizationState = {
    "plugin.trustGrants": {},
    "plugin.fileSystemGrants": {},
    "plugin.apiGrants": {},
};

export class PluginPermissionManager {
    private readonly state: PersistentState<PluginAuthorizationState>;
    private readonly temporaryTrustGrants = new Map<string, PluginTrustGrantRecord>();
    private readonly temporaryFileSystemGrants = new Map<string, PluginFileSystemGrantRecord[]>();
    private readonly temporaryApiGrants = new Map<string, PluginApiGrantRecord[]>();

    constructor(userDataDir: string) {
        const dbPath = path.join(userDataDir, UserDataNamespace.Authorization, "plugin-permissions.config");
        const config: PersistentStateConfig<PluginAuthorizationState> = {
            dbPath,
            defaults: DEFAULT_STATE,
        };

        this.state = new PersistentState(config);
    }

    public initialize(): Promise<void> {
        return Promise.resolve();
    }

    public grantPermission(request: PluginPermissionRequest, decision: PluginPermissionDecision): PluginPermissionGrantResult {
        if (request.requestId !== decision.requestId) {
            throw new Error("Permission decision does not match the permission request");
        }

        const persistence = decision.persistence ?? request.persistence ?? "temporary";
        if (!decision.approved) {
            return {
                requestId: request.requestId,
                pluginId: request.plugin.id,
                kind: request.kind,
                approved: false,
                persistence,
            };
        }

        switch (request.kind) {
            case "trust":
                return this.grantTrust(request, persistence);
            case "filesystem":
                return this.grantFileSystem(request, persistence);
            case "api":
                return this.grantApi(request, persistence);
            case "install":
                return this.grantInstall(request, persistence);
            default:
                throw new Error("Plugin permission grant is not implemented for this request kind");
        }
    }

    public isPluginTrusted(pluginId: string, version?: string): boolean {
        const key = this.getPluginGrantKey({ id: pluginId, version });
        return this.temporaryTrustGrants.has(key) || Boolean(this.getPersistentTrustGrants()[key]);
    }

    public isPluginFileSystemAllowed(pluginId: string, version: string | undefined, fsPath: string, mode: "read" | "write"): boolean {
        const target = path.resolve(fsPath);
        return this.getFileSystemGrants({ id: pluginId, version }).some(grant => {
            if (!this.fileSystemModeAllows(grant.mode, mode)) {
                return false;
            }
            const root = path.resolve(grant.path);
            return grant.recursive ? this.isSameOrChild(target, root) : target === root;
        });
    }

    public isPluginCapabilityAllowed(pluginId: string, version: string | undefined, capability: string): boolean {
        return this.getApiGrants({ id: pluginId, version }).some(grant => grant.capability === capability);
    }

    public revokePluginPermissions(pluginId: string): void {
        const normalized = pluginId.trim();
        if (!normalized) {
            throw new Error("Plugin id is required");
        }

        const trustGrants = this.getPersistentTrustGrants();
        for (const key of Object.keys(trustGrants)) {
            if (this.isPluginGrantKey(key, normalized)) {
                delete trustGrants[key];
            }
        }
        this.state.setItem("plugin.trustGrants", trustGrants);
        this.deleteTemporaryGrants(this.temporaryTrustGrants, normalized);

        const fileSystemGrants = this.getPersistentFileSystemGrants();
        for (const key of Object.keys(fileSystemGrants)) {
            if (this.isPluginGrantKey(key, normalized)) {
                delete fileSystemGrants[key];
            }
        }
        this.state.setItem("plugin.fileSystemGrants", fileSystemGrants);
        this.deleteTemporaryGrants(this.temporaryFileSystemGrants, normalized);

        const apiGrants = this.getPersistentApiGrants();
        for (const key of Object.keys(apiGrants)) {
            if (this.isPluginGrantKey(key, normalized)) {
                delete apiGrants[key];
            }
        }
        this.state.setItem("plugin.apiGrants", apiGrants);
        this.deleteTemporaryGrants(this.temporaryApiGrants, normalized);
    }

    public getExistingGrantResult(request: PluginPermissionRequest): PluginPermissionGrantResult | null {
        switch (request.kind) {
            case "trust": {
                const grant = this.getTrustGrant(request.plugin);
                return grant ? this.grantRecordToResult(request, grant.persistence, grant.grantedAt) : null;
            }
            case "filesystem": {
                const grants = this.getMatchingFileSystemGrants(
                    request.plugin,
                    request.path,
                    request.mode,
                    request.recursive,
                );
                if (!grants) {
                    return null;
                }
                return this.grantRecordToResult(
                    request,
                    grants.every(grant => grant.persistence === "permanent") ? "permanent" : "temporary",
                    Math.max(...grants.map(grant => grant.grantedAt)),
                );
            }
            case "api": {
                const grant = this.getApiGrants(request.plugin)
                    .find(record => record.capability === request.capability);
                return grant ? this.grantRecordToResult(request, grant.persistence, grant.grantedAt) : null;
            }
            case "install":
                return null;
            default:
                return null;
        }
    }

    private grantTrust(
        request: Extract<PluginPermissionRequest, { kind: "trust" }>,
        persistence: PluginPermissionPersistence,
    ): PluginPermissionGrantResult {
        const record: PluginTrustGrantRecord = {
            plugin: request.plugin,
            trusted: true,
            persistence,
            grantedAt: Date.now(),
            sourceRequestId: request.requestId,
        };

        if (persistence === "permanent") {
            const grants = this.getPersistentTrustGrants();
            grants[this.getPluginGrantKey(request.plugin)] = record;
            this.state.setItem("plugin.trustGrants", grants);
        } else {
            this.temporaryTrustGrants.set(this.getPluginGrantKey(request.plugin), record);
        }

        return {
            requestId: request.requestId,
            pluginId: request.plugin.id,
            kind: request.kind,
            approved: true,
            persistence,
            grantedAt: record.grantedAt,
        };
    }

    private grantFileSystem(
        request: Extract<PluginPermissionRequest, { kind: "filesystem" }>,
        persistence: PluginPermissionPersistence,
    ): PluginPermissionGrantResult {
        const record: PluginFileSystemGrantRecord = {
            plugin: request.plugin,
            path: path.resolve(request.path),
            mode: request.mode,
            recursive: request.recursive,
            persistence,
            grantedAt: Date.now(),
            sourceRequestId: request.requestId,
        };

        if (persistence === "permanent") {
            const grants = this.getPersistentFileSystemGrants();
            const key = this.getPluginGrantKey(request.plugin);
            const pluginGrants = grants[key] ?? [];
            grants[key] = [...pluginGrants, record];
            this.state.setItem("plugin.fileSystemGrants", grants);
        } else {
            const key = this.getPluginGrantKey(request.plugin);
            const pluginGrants = this.temporaryFileSystemGrants.get(key) ?? [];
            this.temporaryFileSystemGrants.set(key, [...pluginGrants, record]);
        }

        return {
            requestId: request.requestId,
            pluginId: request.plugin.id,
            kind: request.kind,
            approved: true,
            persistence,
            grantedAt: record.grantedAt,
        };
    }

    private grantApi(
        request: Extract<PluginPermissionRequest, { kind: "api" }>,
        persistence: PluginPermissionPersistence,
    ): PluginPermissionGrantResult {
        const record: PluginApiGrantRecord = {
            plugin: request.plugin,
            capability: request.capability,
            persistence,
            grantedAt: Date.now(),
            sourceRequestId: request.requestId,
        };

        if (persistence === "permanent") {
            const grants = this.getPersistentApiGrants();
            const key = this.getPluginGrantKey(request.plugin);
            const pluginGrants = grants[key] ?? [];
            grants[key] = [...pluginGrants, record];
            this.state.setItem("plugin.apiGrants", grants);
        } else {
            const key = this.getPluginGrantKey(request.plugin);
            const pluginGrants = this.temporaryApiGrants.get(key) ?? [];
            this.temporaryApiGrants.set(key, [...pluginGrants, record]);
        }

        return {
            requestId: request.requestId,
            pluginId: request.plugin.id,
            kind: request.kind,
            approved: true,
            persistence,
            grantedAt: record.grantedAt,
        };
    }

    private grantInstall(
        request: Extract<PluginPermissionRequest, { kind: "install" }>,
        persistence: PluginPermissionPersistence,
    ): PluginPermissionGrantResult {
        for (const permission of request.permissions ?? []) {
            if (permission.kind === "filesystem") {
                this.grantFileSystem({
                    kind: "filesystem",
                    requestId: request.requestId,
                    plugin: request.plugin,
                    path: permission.path,
                    mode: permission.mode,
                    recursive: permission.recursive,
                    persistence,
                    reason: request.reason,
                    requestedAt: request.requestedAt,
                }, persistence);
            } else if (permission.kind === "api") {
                this.grantApi({
                    kind: "api",
                    requestId: request.requestId,
                    plugin: request.plugin,
                    capability: permission.capability,
                    persistence,
                    reason: request.reason,
                    requestedAt: request.requestedAt,
                }, persistence);
            }
        }

        return {
            requestId: request.requestId,
            pluginId: request.plugin.id,
            kind: request.kind,
            approved: true,
            persistence,
            grantedAt: Date.now(),
        };
    }

    private getPersistentTrustGrants(): Record<string, PluginTrustGrantRecord> {
        return {
            ...this.state.getItem("plugin.trustGrants"),
        };
    }

    private getPersistentFileSystemGrants(): Record<string, PluginFileSystemGrantRecord[]> {
        return {
            ...this.state.getItem("plugin.fileSystemGrants"),
        };
    }

    private getPersistentApiGrants(): Record<string, PluginApiGrantRecord[]> {
        return {
            ...this.state.getItem("plugin.apiGrants"),
        };
    }

    private getTrustGrant(plugin: PluginIdentity): PluginTrustGrantRecord | undefined {
        const key = this.getPluginGrantKey(plugin);
        return this.getPersistentTrustGrants()[key] ?? this.temporaryTrustGrants.get(key);
    }

    private getFileSystemGrants(plugin: PluginIdentity): PluginFileSystemGrantRecord[] {
        const key = this.getPluginGrantKey(plugin);
        return [
            ...(this.getPersistentFileSystemGrants()[key] ?? []),
            ...(this.temporaryFileSystemGrants.get(key) ?? []),
        ];
    }

    private getApiGrants(plugin: PluginIdentity): PluginApiGrantRecord[] {
        const key = this.getPluginGrantKey(plugin);
        return [
            ...(this.getPersistentApiGrants()[key] ?? []),
            ...(this.temporaryApiGrants.get(key) ?? []),
        ];
    }

    private getMatchingFileSystemGrants(
        plugin: PluginIdentity,
        fsPath: string,
        mode: PluginFileSystemPermissionMode,
        recursive: boolean,
    ): PluginFileSystemGrantRecord[] | null {
        const target = path.resolve(fsPath);
        const grants = this.getFileSystemGrants(plugin)
            .filter(grant => this.fileSystemPathAllows(grant, target, recursive));

        if (mode === "readwrite") {
            const readGrant = grants.find(grant => this.fileSystemModeAllows(grant.mode, "read"));
            const writeGrant = grants.find(grant => this.fileSystemModeAllows(grant.mode, "write"));
            return readGrant && writeGrant ? Array.from(new Set([readGrant, writeGrant])) : null;
        }

        const grant = grants.find(record => this.fileSystemModeAllows(record.mode, mode));
        return grant ? [grant] : null;
    }

    private fileSystemModeAllows(grantMode: PluginFileSystemPermissionMode, requestedMode: "read" | "write"): boolean {
        return grantMode === "readwrite" || grantMode === requestedMode;
    }

    private fileSystemPathAllows(
        grant: PluginFileSystemGrantRecord,
        target: string,
        requestedRecursive: boolean,
    ): boolean {
        if (requestedRecursive && !grant.recursive) {
            return false;
        }
        const root = path.resolve(grant.path);
        return grant.recursive ? this.isSameOrChild(target, root) : target === root;
    }

    private grantRecordToResult(
        request: PluginPermissionRequest,
        persistence: PluginPermissionPersistence,
        grantedAt: number,
    ): PluginPermissionGrantResult {
        return {
            requestId: request.requestId,
            pluginId: request.plugin.id,
            kind: request.kind,
            approved: true,
            persistence,
            grantedAt,
        };
    }

    private isSameOrChild(target: string, root: string): boolean {
        const relativePath = path.relative(root, target);
        return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
    }

    private getPluginGrantKey(plugin: PluginIdentity): string {
        const id = plugin.id.trim();
        const version = plugin.version?.trim();
        return version ? `${id}@${version}` : id;
    }

    private isPluginGrantKey(key: string, pluginId: string): boolean {
        return key === pluginId || key.startsWith(`${pluginId}@`);
    }

    private deleteTemporaryGrants<T>(map: Map<string, T>, pluginId: string): void {
        for (const key of map.keys()) {
            if (this.isPluginGrantKey(key, pluginId)) {
                map.delete(key);
            }
        }
    }
}
