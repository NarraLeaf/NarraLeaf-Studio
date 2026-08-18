import {
  GAME_RUNTIME_CROP_ANCHORS_X,
  GAME_RUNTIME_CROP_ANCHORS_Y,
  GAME_RUNTIME_VIEWPORT_FITS,
  type GameRuntimeCropAnchorX,
  type GameRuntimeCropAnchorY,
  type GameRuntimeViewportFit
} from "@shared/types/gameRuntime";
import {
  DEFAULT_GAME_CRASH_POLICY,
  normalizeGameCrashPolicy,
  type GameCrashPolicy
} from "@shared/types/gameRuntime";
import {
  NETWORK_POLICY_ANY,
  NETWORK_POLICY_OFF,
  normalizeNetworkAccessPolicy,
  normalizeNetworkAllowlistEntries,
  type NetworkAccessPolicy
} from "@shared/types/networkAllowlist";
import type { LocalizationConfiguration } from "@shared/types/localization";
import type { PlayerPreferences } from "@shared/types/preference";
import type { AutoSaveConfiguration } from "@shared/types/saves";
import type { SigningPlatform } from "@shared/types/signing";
import type { VoiceConfiguration } from "@shared/types/voice";
import type { WebOptimizationConfiguration } from "@shared/types/webOptimization";
import type { LintRuleSeverity } from "@/lib/lint/types";
import {
  GAME_BUILD_FORMATS_BY_PLATFORM,
  isDesktopBuildPlatform,
  normalizeGameBuildArch,
  type GameBuildArch,
  type GameBuildCompression,
  type GameBuildDesktopPlatform,
  type GameBuildFormat,
  type GameBuildPlatform
} from "@shared/types/gameBuild";

export {
  DEFAULT_LOCALIZATION_CONFIGURATION,
  normalizeLocalizationConfiguration
} from "@shared/types/localization";
export type {
  LocalizationConfiguration,
  LocalizationLocaleEntry
} from "@shared/types/localization";
export { DEFAULT_VOICE_CONFIGURATION, normalizeVoiceConfiguration } from "@shared/types/voice";
export type { VoiceConfiguration, VoiceLocaleEntry } from "@shared/types/voice";
export {
  DEFAULT_WEB_OPTIMIZATION_CONFIGURATION,
  normalizeWebOptimizationConfiguration,
  WEB_LOSSY_QUALITY_MAX,
  WEB_LOSSY_QUALITY_MIN
} from "@shared/types/webOptimization";
export type { WebOptimizationConfiguration } from "@shared/types/webOptimization";
export {
  AUTO_SAVE_INTERVAL_SECONDS_MAX,
  AUTO_SAVE_INTERVAL_SECONDS_MIN,
  AUTO_SAVE_SLOTS_MAX,
  AUTO_SAVE_SLOTS_MIN,
  DEFAULT_AUTO_SAVE_CONFIGURATION,
  normalizeAutoSaveConfiguration
} from "@shared/types/saves";
export type { AutoSaveConfiguration } from "@shared/types/saves";
export {
  DEFAULT_PLAYER_PREFERENCES,
  PLAYER_PREFERENCE_GROUPS,
  PLAYER_PREFERENCE_KEYS,
  PLAYER_PREFERENCE_SPECS,
  normalizePlayerPreference,
  normalizePlayerPreferences
} from "@shared/types/preference";
export type {
  PlayerPreferenceKey,
  PlayerPreferenceSpec,
  PlayerPreferenceValue,
  PlayerPreferences
} from "@shared/types/preference";

// Declared as object-literal `type` aliases (not interfaces) so they carry an
// implicit string index signature and remain assignable to the loose
// `Record<string, unknown>` shape used by the msgpack persistence layer
// (see ProjectConfigData in @shared/utils/nlproj).
export type NetworkConfiguration = {
  /**
   * Derived from {@link policy}, never authored and never stored on its own.
   *
   * The two used to be separate settings and could disagree; they are now one authored value with
   * three positions, and this is the half of it the runtime's CSP and `webRequest` layers read.
   * Projects written before the change carry only `allowHttp`, and it is what their policy is
   * migrated from - see {@link normalizeNetworkConfiguration}.
   */
  allowHttp: boolean;
  allowRemoteResource: boolean;
  allowRemoteScript: boolean;
  /**
   * How much of the network the build reaches. The whole setting, in one value.
   *
   * `"off"` for a new project. Turning the network on means `"any"` rather than the allowlist,
   * which is deliberate: a node an author wired up is expected to run, and a default that made
   * authored graphs fail would teach people to switch the safety off before they had a reason to
   * understand it. See `@shared/types/networkAllowlist`.
   */
  policy: NetworkAccessPolicy;
  /** The author's own allowlist entries. Only consulted when {@link policy} is `"allowlist"`. */
  allowlist: string[];
};

/**
 * What the shipped game does when it stops working (see {@link GameCrashPolicy}).
 *
 * A project setting rather than a build-dialog one: it is a decision about the game, not about one
 * build of it, and an author who wanted the stack on screen while testing would otherwise have to
 * remember to change it back before shipping.
 */
export type CrashConfiguration = {
  policy: GameCrashPolicy;
};

export type SecurityConfiguration = {
  /** When true, packaged and previewed builds protect game assets and data. */
  encryptAssets: boolean;
};

/**
 * Project lint policy (see `@/lib/lint`).
 *
 * `severities` and `options` are **sparse**: they hold only what the author changed away from the
 * rule's own default. A dense map would freeze today's defaults into every project ever saved, so
 * improving a default would never reach an existing project - and adding a rule would silently
 * leave it unconfigured in a file that looks exhaustive.
 */
export type LintingConfiguration = {
  /** Sweep the project as part of a production build (ruling R3: on by default). */
  runOnBuild: boolean;
  /** Lowest severity that refuses the build. */
  failBuildOn: "error" | "warning";
  /** ruleId -> severity, only where it differs from the rule's default. */
  severities: Record<string, LintRuleSeverity>;
  /** ruleId -> option values, only where they differ from the rule's declared defaults. */
  options: Record<string, Record<string, string | number>>;
};

/** Orientations a mobile build can lock to, in display order. */
export const MOBILE_ORIENTATIONS = ["landscape", "portrait", "auto"] as const;

export type MobileOrientation = (typeof MOBILE_ORIENTATIONS)[number];

/**
 * How the stage meets a screen whose aspect ratio is not the design's.
 *
 * `contain` letterboxes — the whole design is visible and bars fill the rest. `cover` fills the
 * screen and crops the overflow. Exactly one axis ever overflows: a screen that is relatively wider
 * than the design crops vertically, a relatively narrower one crops horizontally.
 */
export const MOBILE_VIEWPORT_FITS = GAME_RUNTIME_VIEWPORT_FITS;
export type MobileViewportFit = GameRuntimeViewportFit;

/** Which part survives a horizontal crop. Named for what is KEPT, like CSS `object-position`. */
export const MOBILE_CROP_ANCHORS_X = GAME_RUNTIME_CROP_ANCHORS_X;
export type MobileCropAnchorX = GameRuntimeCropAnchorX;

/** Which part survives a vertical crop. */
export const MOBILE_CROP_ANCHORS_Y = GAME_RUNTIME_CROP_ANCHORS_Y;
export type MobileCropAnchorY = GameRuntimeCropAnchorY;

export type MobileConfiguration = {
  /**
   * Orientation the mobile shells lock the game to at startup. A project-level
   * setting rather than a per-target one: it describes the game, and a project
   * that plays in landscape does so on every device.
   */
  orientation: MobileOrientation;
  /**
   * `contain` (default) keeps every project that predates this setting looking exactly as it did.
   * Opting into `cover` is a decision about the game's art, so it is never inferred.
   */
  fit: MobileViewportFit;
  /** Only consulted under `cover`, and only on the axis that actually overflows. */
  cropAnchorX: MobileCropAnchorX;
  cropAnchorY: MobileCropAnchorY;
};

/**
 * Visual novels are overwhelmingly landscape, including every project predating this setting — and
 * letterboxing is what every project predating the crop setting shipped with, so it stays the
 * default. A centred crop is the least surprising anchor once an author does opt in.
 */
export const DEFAULT_MOBILE_CONFIGURATION: MobileConfiguration = {
  orientation: "landscape",
  fit: "contain",
  cropAnchorX: "center",
  cropAnchorY: "center"
};

/** Coerce a persisted value into a complete MobileConfiguration. */
export function normalizeMobileConfiguration(value: unknown): MobileConfiguration {
  const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const pick = <T extends string>(candidate: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(candidate as T) ? (candidate as T) : fallback;
  return {
    orientation: pick(
      record.orientation,
      MOBILE_ORIENTATIONS,
      DEFAULT_MOBILE_CONFIGURATION.orientation
    ),
    fit: pick(record.fit, MOBILE_VIEWPORT_FITS, DEFAULT_MOBILE_CONFIGURATION.fit),
    cropAnchorX: pick(
      record.cropAnchorX,
      MOBILE_CROP_ANCHORS_X,
      DEFAULT_MOBILE_CONFIGURATION.cropAnchorX
    ),
    cropAnchorY: pick(
      record.cropAnchorY,
      MOBILE_CROP_ANCHORS_Y,
      DEFAULT_MOBILE_CONFIGURATION.cropAnchorY
    )
  };
}

/**
 * Remembered production-build selection, so the build dialog re-opens with the
 * user's last platforms/formats/output dir. Purely a renderer-side convenience;
 * the actual build request is sent with explicit targets.
 */
export type BuildConfiguration = {
  /**
   * The build variant selected last time. Absent means the release variant, which is also what a
   * stored id whose variant has since been deleted resolves to.
   */
  appTagId?: string;
  platforms: GameBuildPlatform[];
  formats: Partial<Record<GameBuildPlatform, GameBuildFormat[]>>;
  /** Arch chosen per desktop platform; the web export has none. */
  archs: Partial<Record<GameBuildDesktopPlatform, GameBuildArch>>;
  /** Absolute output directory chosen last time; empty means the default. */
  outputDir: string;
  compression: GameBuildCompression;
  /** Reveal the output folder when a build finishes. */
  openWhenDone: boolean;
};

/** Compression levels offered, in display order (slowest/smallest first). */
export const BUILD_COMPRESSIONS: GameBuildCompression[] = ["maximum", "normal", "store"];

/**
 * electron-builder's own default compression, and the level every build used
 * before the setting existed.
 */
export const DEFAULT_BUILD_COMPRESSION: GameBuildCompression = "maximum";

/**
 * Which signing credential the project uses for each platform, by credential
 * **id** and nothing else.
 *
 * A project is version controlled, so this file travels: no path, no password
 * and no certificate may appear here. The ids point into the machine's vault
 * (`<userData>/signing/`, see @shared/types/signing), and opening the project on
 * another machine leaves them dangling on purpose - preflight then says which
 * credential to import, rather than the build silently shipping unsigned.
 *
 * Every platform but the web export has an entry; a web export is files on a
 * server, with nothing to sign.
 */
export type SigningConfiguration = {
  /** Credential id for the Windows target (Authenticode). */
  windows?: string;
  /** Credential id for the macOS target (codesign, optionally notarized). */
  macos?: string;
  /** Credential id for the GPG detached signatures over the artifacts. */
  linux?: string;
  /** Credential id for the Android release keystore. */
  android?: string;
  /** Credential id for the Apple identity the .ipa is signed with. */
  ios?: string;
};

/**
 * Keyed by platform rather than written as a list, so a new signable platform
 * fails to compile here until it is given an answer.
 */
const SIGNING_PLATFORM_KEYS: Record<SigningPlatform, true> = {
  windows: true,
  macos: true,
  linux: true,
  android: true,
  ios: true
};

/** The platforms a project can point at a signing credential, in display order. */
export const SIGNING_PLATFORMS = Object.keys(SIGNING_PLATFORM_KEYS) as SigningPlatform[];

/** Nothing signed: what every project that never configured signing means. */
export const DEFAULT_SIGNING_CONFIGURATION: SigningConfiguration = {};

/**
 * Coerce an unknown persisted value into a SigningConfiguration, dropping
 * unknown platforms and anything that is not a non-empty id string. An absent
 * platform is the meaningful state ("build this one unsigned"), so a blank or
 * malformed entry is dropped rather than kept as "".
 */
export function normalizeSigningConfiguration(value: unknown): SigningConfiguration {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SIGNING_CONFIGURATION };
  }
  const record = value as Record<string, unknown>;
  const normalized: SigningConfiguration = {};
  for (const platform of SIGNING_PLATFORMS) {
    const id = record[platform];
    if (typeof id === "string" && id.trim()) {
      normalized[platform] = id.trim();
    }
  }
  return normalized;
}

export type ProjectAppConfiguration = {
  network: NetworkConfiguration;
  /** Game localization setup (see @shared/types/localization); absent until configured. */
  localization?: LocalizationConfiguration;
  /** Game voice-over setup (see @shared/types/voice); absent until configured. */
  voice?: VoiceConfiguration;
  /** Asset-protection policy applied at pack time; absent until configured. */
  security?: SecurityConfiguration;
  /** What the shipped game does when it stops working; absent until configured. */
  crash?: CrashConfiguration;
  /** What the exported static site may do to the author's bytes; absent until configured. */
  webOptimization?: WebOptimizationConfiguration;
  /** Mobile shell behaviour; absent until configured (see the defaults). */
  mobile?: MobileConfiguration;
  /** Automatic saving in the shipped game; absent until configured (see the defaults). */
  autoSave?: AutoSaveConfiguration;
  /**
   * What the player's settings start at (see @shared/types/preference); absent until configured.
   *
   * The starting point only. Everything here is writable at runtime by the player and by the
   * `Set ...` preference nodes, and what they choose is kept in the app's own storage - so this
   * is what a *new* player gets, not a cap on what the game may do.
   */
  preferences?: PlayerPreferences;
  /** Which signing credential each platform uses - ids only; absent until configured. */
  signing?: SigningConfiguration;
  /** Last production-build dialog selection; absent until the first build. */
  build?: BuildConfiguration;
  /** Project lint policy; absent until configured (see the defaults). */
  linting?: LintingConfiguration;
};

/**
 * Secure-by-default network policy applied to the packaged game when the
 * project config does not specify one (older projects, freshly created ones).
 */
export const DEFAULT_NETWORK_CONFIGURATION: NetworkConfiguration = {
  allowHttp: false,
  allowRemoteResource: false,
  allowRemoteScript: false,
  policy: NETWORK_POLICY_OFF,
  allowlist: []
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
  // One authored value decides both. A project written before the tri-state carries only
  // `allowHttp`, so that is what its position is read from; after that the boolean is derived and
  // the two cannot drift apart the way two independent settings could.
  const policy =
    record.policy === undefined
      ? record.allowHttp === true
        ? NETWORK_POLICY_ANY
        : NETWORK_POLICY_OFF
      : normalizeNetworkAccessPolicy(record.policy);
  return {
    allowHttp: policy !== NETWORK_POLICY_OFF,
    allowRemoteResource:
      typeof record.allowRemoteResource === "boolean"
        ? record.allowRemoteResource
        : DEFAULT_NETWORK_CONFIGURATION.allowRemoteResource,
    allowRemoteScript:
      typeof record.allowRemoteScript === "boolean"
        ? record.allowRemoteScript
        : DEFAULT_NETWORK_CONFIGURATION.allowRemoteScript,
    policy,
    allowlist: normalizeNetworkAllowlistEntries(record.allowlist)
  };
}

/**
 * A project that never chose shows the failure on screen, which is what every build did before
 * this setting existed. Changing this default would quietly change what an existing project ships.
 */
export const DEFAULT_CRASH_CONFIGURATION: CrashConfiguration = {
  policy: DEFAULT_GAME_CRASH_POLICY
};

export function normalizeCrashConfiguration(value: unknown): CrashConfiguration {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CRASH_CONFIGURATION };
  }
  return { policy: normalizeGameCrashPolicy((value as Record<string, unknown>).policy) };
}

/**
 * Asset protection is off by default: projects that never configured it (and all
 * projects created before this feature) ship in the clear.
 */
export const DEFAULT_SECURITY_CONFIGURATION: SecurityConfiguration = {
  encryptAssets: false
};

/** Coerce an unknown persisted value into a complete SecurityConfiguration. */
export function normalizeSecurityConfiguration(value: unknown): SecurityConfiguration {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_SECURITY_CONFIGURATION };
  }
  const record = value as Record<string, unknown>;
  return {
    encryptAssets:
      typeof record.encryptAssets === "boolean"
        ? record.encryptAssets
        : DEFAULT_SECURITY_CONFIGURATION.encryptAssets
  };
}

/**
 * Lint on, blocking on errors: what a project that never opened the settings panel means. Ruling
 * R3 - a gate nobody enabled is a gate nobody has.
 */
export const DEFAULT_LINTING_CONFIGURATION: LintingConfiguration = {
  runOnBuild: true,
  failBuildOn: "error",
  severities: {},
  options: {}
};

const LINT_RULE_SEVERITIES: readonly LintRuleSeverity[] = ["error", "warning", "info", "off"];

/**
 * Coerce an unknown persisted value into a complete LintingConfiguration.
 *
 * Malformed entries are dropped rather than repaired, and never throw: an unreadable severity for
 * one rule must not cost the whole lint config, and a rule id this Studio has never heard of is
 * kept as-is (it may belong to a newer version - dropping it would silently discard the author's
 * choice when the project travels back).
 */
export function normalizeLintingConfiguration(value: unknown): LintingConfiguration {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_LINTING_CONFIGURATION, severities: {}, options: {} };
  }
  const record = value as Record<string, unknown>;

  const severities: Record<string, LintRuleSeverity> = {};
  if (record.severities && typeof record.severities === "object") {
    for (const [ruleId, severity] of Object.entries(record.severities as Record<string, unknown>)) {
      if (ruleId && LINT_RULE_SEVERITIES.includes(severity as LintRuleSeverity)) {
        severities[ruleId] = severity as LintRuleSeverity;
      }
    }
  }

  const options: Record<string, Record<string, string | number>> = {};
  if (record.options && typeof record.options === "object") {
    for (const [ruleId, raw] of Object.entries(record.options as Record<string, unknown>)) {
      if (!ruleId || !raw || typeof raw !== "object") {
        continue;
      }
      const entries: Record<string, string | number> = {};
      for (const [key, optionValue] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof optionValue === "string") {
          entries[key] = optionValue;
        } else if (typeof optionValue === "number" && Number.isFinite(optionValue)) {
          entries[key] = optionValue;
        }
      }
      // The rule's own spec has the final say on whether a value is usable (see
      // resolveRuleOptions); this only guarantees the shape.
      if (Object.keys(entries).length > 0) {
        options[ruleId] = entries;
      }
    }
  }

  return {
    runOnBuild:
      typeof record.runOnBuild === "boolean"
        ? record.runOnBuild
        : DEFAULT_LINTING_CONFIGURATION.runOnBuild,
    failBuildOn:
      record.failBuildOn === "warning" || record.failBuildOn === "error"
        ? record.failBuildOn
        : DEFAULT_LINTING_CONFIGURATION.failBuildOn,
    severities,
    options
  };
}

/** Platforms a stored selection may name. */
const ALL_BUILD_PLATFORMS: GameBuildPlatform[] = [
  "windows",
  "macos",
  "linux",
  "web",
  "android",
  "ios"
];

/** Keep only formats electron-builder supports for the given platform. */
function sanitizeFormats(platform: GameBuildPlatform, value: unknown): GameBuildFormat[] {
  const allowed = GAME_BUILD_FORMATS_BY_PLATFORM[platform];
  if (!Array.isArray(value)) {
    return [];
  }
  return allowed.filter((format) => value.includes(format));
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
  const selectedPlatforms = ALL_BUILD_PLATFORMS.filter((platform) =>
    rawPlatforms.includes(platform)
  );
  const rawFormats =
    record.formats && typeof record.formats === "object"
      ? (record.formats as Record<string, unknown>)
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
  const platforms = selectedPlatforms.filter((platform) => formats[platform]);
  if (platforms.length === 0) {
    return null;
  }
  // Projects built before arch/compression/openWhenDone existed have none of
  // these keys; each falls back to the behaviour that build would have had.
  const rawArchs =
    record.archs && typeof record.archs === "object"
      ? (record.archs as Record<string, unknown>)
      : {};
  const archs: Partial<Record<GameBuildDesktopPlatform, GameBuildArch>> = {};
  for (const platform of platforms) {
    // Only desktop platforms carry an arch; web and mobile have none.
    if (!isDesktopBuildPlatform(platform)) {
      continue;
    }
    const stored = rawArchs[platform];
    if (stored === undefined) {
      continue;
    }
    archs[platform] = normalizeGameBuildArch(platform, stored);
  }
  return {
    platforms,
    formats,
    archs,
    outputDir: typeof record.outputDir === "string" ? record.outputDir.trim() : "",
    compression:
      BUILD_COMPRESSIONS.find((level) => level === record.compression) ?? DEFAULT_BUILD_COMPRESSION,
    openWhenDone: typeof record.openWhenDone === "boolean" ? record.openWhenDone : true
  };
}
