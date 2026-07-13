import type { LocalizationConfiguration } from "@shared/types/localization";

export {
    DEFAULT_LOCALIZATION_CONFIGURATION,
    normalizeLocalizationConfiguration,
} from "@shared/types/localization";
export type { LocalizationConfiguration, LocalizationLocaleEntry } from "@shared/types/localization";

// Declared as object-literal `type` aliases (not interfaces) so they carry an
// implicit string index signature and remain assignable to the loose
// `Record<string, unknown>` shape used by the msgpack persistence layer
// (see ProjectConfigData in @shared/utils/nlproj).
export type NetworkConfiguration = {
    allowHttp: boolean;
    allowRemoteResource: boolean;
    allowRemoteScript: boolean;
};

export type SecurityConfiguration = {
    /** When true, packaged and previewed builds protect game assets and data. */
    encryptAssets: boolean;
};

export type ProjectAppConfiguration = {
    network: NetworkConfiguration;
    /** Game localization setup (see @shared/types/localization); absent until configured. */
    localization?: LocalizationConfiguration;
    /** Asset-protection policy applied at pack time; absent until configured. */
    security?: SecurityConfiguration;
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

/**
 * Asset protection is off by default: projects that never configured it (and all
 * projects created before this feature) ship in the clear.
 */
export const DEFAULT_SECURITY_CONFIGURATION: SecurityConfiguration = {
    encryptAssets: false,
};

/** Coerce an unknown persisted value into a complete SecurityConfiguration. */
export function normalizeSecurityConfiguration(value: unknown): SecurityConfiguration {
    if (!value || typeof value !== "object") {
        return { ...DEFAULT_SECURITY_CONFIGURATION };
    }
    const record = value as Record<string, unknown>;
    return {
        encryptAssets: typeof record.encryptAssets === "boolean"
            ? record.encryptAssets
            : DEFAULT_SECURITY_CONFIGURATION.encryptAssets,
    };
}
