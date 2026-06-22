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

    public isPluginTrusted(pluginId: string): boolean {
        return this.temporaryTrustGrants.has(pluginId) || Boolean(this.getPersistentTrustGrants()[pluginId]);
    }

    public isPluginFileSystemAllowed(pluginId: string, fsPath: string, mode: "read" | "write"): boolean {
        const target = path.resolve(fsPath);
        return this.getFileSystemGrants(pluginId).some(grant => {
            if (!this.fileSystemModeAllows(grant.mode, mode)) {
                return false;
            }
            const root = path.resolve(grant.path);
            return grant.recursive ? this.isSameOrChild(target, root) : target === root;
        });
    }

    public isPluginCapabilityAllowed(pluginId: string, capability: string): boolean {
        return this.getApiGrants(pluginId).some(grant => grant.capability === capability);
    }

    public revokePluginPermissions(pluginId: string): void {
        const normalized = pluginId.trim();
        if (!normalized) {
            throw new Error("Plugin id is required");
        }

        const trustGrants = this.getPersistentTrustGrants();
        delete trustGrants[normalized];
        this.state.setItem("plugin.trustGrants", trustGrants);
        this.temporaryTrustGrants.delete(normalized);

        const fileSystemGrants = this.getPersistentFileSystemGrants();
        delete fileSystemGrants[normalized];
        this.state.setItem("plugin.fileSystemGrants", fileSystemGrants);
        this.temporaryFileSystemGrants.delete(normalized);

        const apiGrants = this.getPersistentApiGrants();
        delete apiGrants[normalized];
        this.state.setItem("plugin.apiGrants", apiGrants);
        this.temporaryApiGrants.delete(normalized);
    }

    public getExistingGrantResult(request: PluginPermissionRequest): PluginPermissionGrantResult | null {
        switch (request.kind) {
            case "trust": {
                const grant = this.getTrustGrant(request.plugin.id);
                return grant ? this.grantRecordToResult(request, grant.persistence, grant.grantedAt) : null;
            }
            case "filesystem": {
                const grants = this.getMatchingFileSystemGrants(
                    request.plugin.id,
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
                const grant = this.getApiGrants(request.plugin.id)
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
            grants[request.plugin.id] = record;
            this.state.setItem("plugin.trustGrants", grants);
        } else {
            this.temporaryTrustGrants.set(request.plugin.id, record);
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
            const pluginGrants = grants[request.plugin.id] ?? [];
            grants[request.plugin.id] = [...pluginGrants, record];
            this.state.setItem("plugin.fileSystemGrants", grants);
        } else {
            const pluginGrants = this.temporaryFileSystemGrants.get(request.plugin.id) ?? [];
            this.temporaryFileSystemGrants.set(request.plugin.id, [...pluginGrants, record]);
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
            const pluginGrants = grants[request.plugin.id] ?? [];
            grants[request.plugin.id] = [...pluginGrants, record];
            this.state.setItem("plugin.apiGrants", grants);
        } else {
            const pluginGrants = this.temporaryApiGrants.get(request.plugin.id) ?? [];
            this.temporaryApiGrants.set(request.plugin.id, [...pluginGrants, record]);
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

    private getTrustGrant(pluginId: string): PluginTrustGrantRecord | undefined {
        return this.getPersistentTrustGrants()[pluginId] ?? this.temporaryTrustGrants.get(pluginId);
    }

    private getFileSystemGrants(pluginId: string): PluginFileSystemGrantRecord[] {
        return [
            ...(this.getPersistentFileSystemGrants()[pluginId] ?? []),
            ...(this.temporaryFileSystemGrants.get(pluginId) ?? []),
        ];
    }

    private getApiGrants(pluginId: string): PluginApiGrantRecord[] {
        return [
            ...(this.getPersistentApiGrants()[pluginId] ?? []),
            ...(this.temporaryApiGrants.get(pluginId) ?? []),
        ];
    }

    private getMatchingFileSystemGrants(
        pluginId: string,
        fsPath: string,
        mode: PluginFileSystemPermissionMode,
        recursive: boolean,
    ): PluginFileSystemGrantRecord[] | null {
        const target = path.resolve(fsPath);
        const grants = this.getFileSystemGrants(pluginId)
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
}
