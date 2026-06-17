import path from "path";
import { UserDataNamespace } from "@shared/types/constants";
import {
    PluginPermissionDecision,
    PluginPermissionGrantResult,
    PluginPermissionPersistence,
    PluginPermissionRequest,
    PluginTrustGrantRecord,
} from "@shared/types/pluginPermissions";
import { PersistentState } from "@shared/utils/persistentState";
import { PersistentStateConfig } from "@shared/types/persistentState";

interface PluginAuthorizationState extends Record<string, any> {
    "plugin.trustGrants": Record<string, PluginTrustGrantRecord>;
}

const DEFAULT_STATE: PluginAuthorizationState = {
    "plugin.trustGrants": {},
};

export class PluginPermissionManager {
    private readonly state: PersistentState<PluginAuthorizationState>;
    private readonly temporaryTrustGrants = new Map<string, PluginTrustGrantRecord>();

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
            default:
                throw new Error(`Plugin permission grant is not implemented for request kind: ${request.kind}`);
        }
    }

    public isPluginTrusted(pluginId: string): boolean {
        return this.temporaryTrustGrants.has(pluginId) || Boolean(this.getPersistentTrustGrants()[pluginId]);
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

    private getPersistentTrustGrants(): Record<string, PluginTrustGrantRecord> {
        return {
            ...this.state.getItem("plugin.trustGrants"),
        };
    }
}
