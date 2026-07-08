
// Declared as object-literal `type` aliases (not interfaces) so they carry an
// implicit string index signature and remain assignable to the loose
// `Record<string, unknown>` shape used by the msgpack persistence layer
// (see ProjectConfigData in @shared/utils/nlproj).
export type NetworkConfiguration = {
    allowHttp: boolean;
    allowRemoteResource: boolean;
    allowRemoteScript: boolean;
};

export type ProjectAppConfiguration = {
    network: NetworkConfiguration;
};

/**
 * Secure-by-default network policy applied to the packaged game when the
 * project config does not specify one (older projects, freshly created ones).
 */
export const DEFAULT_NETWORK_CONFIGURATION: NetworkConfiguration = {
    allowHttp: false,
    allowRemoteResource: false,
    allowRemoteScript: false,
};

/**
 * Coerce an unknown (persisted / partially-migrated) value into a complete
 * NetworkConfiguration, falling back to the secure defaults for missing or
 * malformed fields.
 */
export function normalizeNetworkConfiguration(value: unknown): NetworkConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_NETWORK_CONFIGURATION };
    }
    const record = value as Record<string, unknown>;
    return {
        allowHttp: typeof record.allowHttp === "boolean" ? record.allowHttp : DEFAULT_NETWORK_CONFIGURATION.allowHttp,
        allowRemoteResource: typeof record.allowRemoteResource === "boolean"
            ? record.allowRemoteResource
            : DEFAULT_NETWORK_CONFIGURATION.allowRemoteResource,
        allowRemoteScript: typeof record.allowRemoteScript === "boolean"
            ? record.allowRemoteScript
            : DEFAULT_NETWORK_CONFIGURATION.allowRemoteScript,
    };
}
