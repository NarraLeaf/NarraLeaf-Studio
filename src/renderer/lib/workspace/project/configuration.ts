import type { LocalizationConfiguration } from "@shared/types/localization";
import {
    GAME_BUILD_FORMATS_BY_PLATFORM,
    type GameBuildFormat,
    type GameBuildPlatform,
} from "@shared/types/gameBuild";

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

/**
 * Remembered production-build selection, so the build dialog re-opens with the
 * user's last platforms/formats/output dir. Purely a renderer-side convenience;
 * the actual build request is sent with explicit targets.
 */
export type BuildConfiguration = {
    platforms: GameBuildPlatform[];
    formats: Partial<Record<GameBuildPlatform, GameBuildFormat[]>>;
    /** Absolute output directory chosen last time; empty means the default. */
    outputDir: string;
};

export type ProjectAppConfiguration = {
    network: NetworkConfiguration;
    /** Game localization setup (see @shared/types/localization); absent until configured. */
    localization?: LocalizationConfiguration;
    /** Asset-protection policy applied at pack time; absent until configured. */
    security?: SecurityConfiguration;
    /** Last production-build dialog selection; absent until the first build. */
    build?: BuildConfiguration;
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

const ALL_BUILD_PLATFORMS: GameBuildPlatform[] = ["windows", "macos", "linux", "web"];

/** Keep only formats electron-builder supports for the given platform. */
function sanitizeFormats(platform: GameBuildPlatform, value: unknown): GameBuildFormat[] {
    const allowed = GAME_BUILD_FORMATS_BY_PLATFORM[platform];
    if (!Array.isArray(value)) {
        return [];
    }
    return allowed.filter(format => value.includes(format));
}

/**
 * Coerce an unknown persisted value into a complete BuildConfiguration,
 * dropping unknown platforms/formats. Returns null when nothing usable was
 * stored, so callers can fall back to a host-appropriate default.
 */
export function normalizeBuildConfiguration(value: unknown): BuildConfiguration | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const record = value as Record<string, unknown>;
    const rawPlatforms: unknown[] = Array.isArray(record.platforms) ? record.platforms : [];
    const selectedPlatforms = ALL_BUILD_PLATFORMS.filter(platform => rawPlatforms.includes(platform));
    const rawFormats = (record.formats && typeof record.formats === "object")
        ? record.formats as Record<string, unknown>
        : {};
    const formats: Partial<Record<GameBuildPlatform, GameBuildFormat[]>> = {};
    for (const platform of selectedPlatforms) {
        const sanitized = sanitizeFormats(platform, rawFormats[platform]);
        if (sanitized.length > 0) {
            formats[platform] = sanitized;
        }
    }
    // Keep `platforms` and `formats` in sync: a selected platform with no valid
    // formats is dropped, so callers never see a platform they can't act on.
    const platforms = selectedPlatforms.filter(platform => formats[platform]);
    if (platforms.length === 0) {
        return null;
    }
    return {
        platforms,
        formats,
        outputDir: typeof record.outputDir === "string" ? record.outputDir.trim() : "",
    };
}
