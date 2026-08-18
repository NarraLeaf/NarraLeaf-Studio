import type { GameBuildPlatform } from "./gameBuild";
import type {
  PluginIdentity,
  PluginInstallPermission,
  PluginRuntimeCapability,
  PluginSidecarKind
} from "./pluginPermissions";

export const PluginManifestVersion = 2;

/**
 * Per-target plugin entry files. Each entry is a prebundled ESM file relative
 * to the plugin package root. At least one target must be declared.
 *
 * - `studio`: loaded in the workspace window only; talks to the
 *   `narraleaf-studio/plugin` host API (editor extensions).
 * - `runtime`: loaded in every game execution environment (Dev Mode window,
 *   Preview, Production); talks to the `narraleaf-studio/runtime` host API
 *   (game logic such as blueprint node execute bindings).
 */
export type PluginManifestEntries = {
  studio?: string;
  runtime?: string;
};

/**
 * Declarative contribution manifest. Lets Studio validate a project statically
 * (without executing plugin code): every plugin blueprint node / widget type
 * used by a project's documents must be declared here by the plugin that
 * provides its runtime binding. Registration APIs enforce consistency at load
 * time: registering an undeclared type is an error on both targets.
 */
/**
 * One Studio language-pack contribution: a locale this plugin adds (a brand-new
 * locale) or extends (fills gaps in a built-in locale). `messages` is a
 * safe-relative path to a JSON catalog (`{ "studio.key": "translation" }`).
 * Meta fields are honored only for a brand-new locale; for a built-in locale
 * they are ignored. `nativeName` is strongly recommended for a new locale (it is
 * the endonym shown in the language picker; the code is used if omitted).
 */
export type PluginLocaleContribution = {
  code: string;
  nativeName?: string;
  englishName?: string;
  intl?: string;
  dir?: "ltr" | "rtl";
  messages: string;
};

/**
 * Desktop platform/arch key a sidecar or build dependency ships binaries for,
 * spelled `<platform>-<arch>` (e.g. `windows-x64`, `macos-arm64`).
 *
 * Only the three desktop platforms are addressable: web has no process to spawn
 * and the mobile shells are WebViews. A plugin that declares nothing for the
 * platform being built simply has no sidecar there, and its runtime must degrade
 * rather than assume one exists.
 */
export type PluginBinaryPlatformKey = string;

export type PluginSidecarTargetContribution = {
  /** Executable (or, for `kind: "node"`, the .js file) to run. Must appear in `include`. */
  entry: string;
  /**
   * Everything shipped for this platform. Entries are package-relative paths,
   * or `dep:<buildDependencyId>/<path>` to pull an artifact produced by a
   * declared build dependency (that is how third-party redistributables that
   * we may not vendor ourselves reach the pack).
   */
  include: string[];
  /**
   * `sha256` of every package-relative entry in `include`, hex. Verified at
   * install and again at pack time, so a tampered package fails to install
   * instead of silently shipping a different binary. `dep:` entries are covered
   * by the build dependency's own digest instead.
   */
  sha256: Record<string, string>;
};

/**
 * One native child process the plugin ships inside the author's game.
 *
 * This is the heaviest thing a plugin can declare — it is code that reaches the
 * player's machine — so it is deliberately explicit: per-platform binaries,
 * mandatory digests, and a derived install permission the author sees by name.
 */
export type PluginSidecarContribution = {
  /** Prefixed with the plugin id, like every other contributed identifier. */
  id: string;
  /** `executable` spawns the binary directly; `node` runs it under the game's own Electron as Node. */
  kind: PluginSidecarKind;
  /** v1 speaks newline-delimited JSON over stdio; stderr stays a plain log channel. */
  transport: "stdio-jsonl";
  /** `onGameStart` spawns with the window; `onRequest` waits for the first call. */
  autostart: "onGameStart" | "onRequest";
  /** How long the handshake may take before the sidecar counts as unavailable. */
  startupTimeoutMs: number;
  /** Grace period between the shutdown message and SIGTERM. */
  shutdownTimeoutMs: number;
  restart: { maxRetries: number; backoffMs: number };
  targets: Record<PluginBinaryPlatformKey, PluginSidecarTargetContribution>;
};

/**
 * One external binary fetched at build time rather than vendored in the plugin
 * package — the answer for redistributables whose license lets the *game* ship
 * them but does not let a public plugin registry mirror them.
 */
export type PluginBuildDependencyTargetContribution =
  | {
      url: string;
      /** Mandatory. Doubles as the cache key, so re-pointing the URL at identical bytes never re-downloads. */
      sha256: string;
      archive: "zip";
      /** Archive-internal path -> path inside the produced dependency directory. */
      files: Record<string, string>;
    }
  | {
      url: string;
      sha256: string;
      archive: "none";
      /** Name the downloaded file takes inside the produced dependency directory. */
      fileName: string;
    };

export type PluginBuildDependencyContribution = {
  /** Prefixed with the plugin id. Referenced from sidecar `include` as `dep:<id>/<path>`. */
  id: string;
  /** Shown to the author at install and in build logs; say what the binaries are. */
  description?: string;
  targets: Record<PluginBinaryPlatformKey, PluginBuildDependencyTargetContribution>;
};

/** How a build config value is typed. See {@link PluginBuildConfigFieldContribution}. */
export const PLUGIN_BUILD_CONFIG_TYPES = ["text", "secret"] as const;

export type PluginBuildConfigType = (typeof PLUGIN_BUILD_CONFIG_TYPES)[number];

/**
 * Which builds share one value.
 *
 * The four are the two independent axes a build varies along - the variant it is built as, and the
 * platform it is built for - so a field says which of them its value depends on rather than being
 * stored once per build and re-typed for every combination.
 */
export const PLUGIN_BUILD_CONFIG_SCOPES = [
  "global",
  "variant",
  "platform",
  "variant-platform"
] as const;

export type PluginBuildConfigScope = (typeof PLUGIN_BUILD_CONFIG_SCOPES)[number];

/**
 * One value a plugin needs the author to supply before a build can ship - a storefront app id, a
 * publisher account name, an upload token.
 *
 * # Declared, never registered
 *
 * There is no runtime registration API for this and there must not be one. A build has to be
 * describable before any plugin code runs - the dialog lists the fields, and the checks refuse a
 * build that is missing a required one - and no plugin code runs during a build at all. A field that
 * only existed once the plugin had loaded could not be asked about at either moment.
 *
 * # It grants nothing
 *
 * Declaring a field derives no install permission, for the reason `contributes.tests` derives none:
 * it is data the author fills in, not a capability the plugin gains. Nothing here can be read,
 * written or acted on except by the author typing into the field the declaration produced.
 *
 * # Where the value goes
 *
 * A `text` value is stored in the project (in `editor/app-tags.json`, under the variant that states
 * it), so a collaborator who checks the project out has it. A `secret` value is not: the project
 * stores a handle, and the value itself is sealed on the machine that entered it. A handle whose
 * secret is not on this machine reads as set-but-unavailable, which is the normal state for a
 * project someone else configured.
 *
 * A build then carries the `text` values of the plugins it ships into the pack, where the plugin's
 * own runtime reads them back as `app.game.config`. That route is declarative end to end - the
 * build folds declarations into values and writes them down, and nothing on it runs plugin code -
 * so it is the same channel as above and not a way around it. Its consequence is that a `text`
 * value reaches every player: `secret` is what a field takes when the value must not.
 */
export type PluginBuildConfigFieldContribution = {
  /** Unique within the plugin. Keys the stored value; never displayed. */
  key: string;
  /** Author-facing name of the field. */
  label: string;
  /** One line saying what the value is for. */
  description?: string;
  /** `text` is stored in the project; `secret` is not - the project stores a handle. */
  type: PluginBuildConfigType;
  /** Which builds share one value. */
  scope: PluginBuildConfigScope;
  /** Platforms the field applies to. Absent means every platform. */
  platforms?: GameBuildPlatform[];
  /** A build that would ship without a value for this field is refused. */
  required?: boolean;
};

/**
 * One declared field with the plugin that declared it.
 *
 * The declaration alone cannot key a value: two plugins may both call a field `appId`, and the store
 * is per plugin. Everything that resolves, writes or checks a value works with this shape rather
 * than passing the plugin id alongside the field and relying on callers to keep the two together.
 */
export type PluginBuildConfigField = PluginBuildConfigFieldContribution & {
  pluginId: string;
  /** The declaring plugin's name, for surfaces that group fields by plugin. */
  pluginName: string;
};

/**
 * A field whose value the project actually holds.
 *
 * A `secret` field is outside this type rather than filtered out by whoever moves values around.
 * What the project stores for one is a handle, and the secret it names is sealed on the machine
 * that typed it - so there is no value here to move, and moving the handle instead would put a
 * credential's name in front of everyone the artifact reaches. Anything that carries a value out of
 * the project takes this type, which turns a missing check into a compile error instead of a leak.
 */
export type PluginBuildConfigValueField = PluginBuildConfigField & { type: "text" };

/**
 * Whether the project holds the field's value itself.
 *
 * A total map over {@link PLUGIN_BUILD_CONFIG_TYPES} rather than a comparison: a third type added
 * later does not compile until someone has said which side of this line it falls on, whereas an
 * `if (type !== "secret")` would quietly answer yes for it - and yes is the answer that leaks.
 */
const PLUGIN_BUILD_CONFIG_VALUE_IS_STORED: Record<PluginBuildConfigType, boolean> = {
  text: true,
  secret: false
};

export function holdsPluginBuildConfigValue(
  field: PluginBuildConfigField
): field is PluginBuildConfigValueField {
  return PLUGIN_BUILD_CONFIG_VALUE_IS_STORED[field.type];
}

/** Whether a variant may state its own value, or the project holds the only one. */
export function isVariantScopedBuildConfig(scope: PluginBuildConfigScope): boolean {
  return scope === "variant" || scope === "variant-platform";
}

/** Whether the field takes one value per platform rather than one value overall. */
export function isPlatformScopedBuildConfig(scope: PluginBuildConfigScope): boolean {
  return scope === "platform" || scope === "variant-platform";
}

/**
 * Where one field's value sits inside a plugin's record: the field key, and the platform appended
 * when the scope takes one value per platform.
 *
 * Flattening the platform into the key rather than nesting a second record keeps the store one shape
 * - `Record<pluginId, Record<storageKey, string>>` - so one normalizer covers every scope and a
 * scope added later needs no new storage.
 */
export function pluginBuildConfigStorageKey(key: string, platform?: GameBuildPlatform): string {
  return platform ? `${key}@${platform}` : key;
}

export type PluginContributes = {
  /** Blueprint node types this plugin provides (editor def + runtime execute). */
  blueprintNodes?: string[];
  /** Widget element types this plugin provides (editor module + runtime renderer). */
  widgets?: string[];
  /** Studio language packs: locales this plugin adds or fills. */
  locales?: PluginLocaleContribution[];
  /**
   * Plugin storage namespaces to publish with the game, readable at runtime
   * through `app.game.data.readJson(namespace)`.
   *
   * Plugin stores live under the project's `editor/` directory, which is never
   * packaged. A plugin whose runtime needs authored data (catalogs, tables)
   * must list those namespaces here. The list is an explicit allowlist so
   * editor-only plugin state cannot leak into a shipped game by accident.
   */
  runtimeData?: string[];
  /**
   * Test ids this plugin registers with `app.services.tests` (see
   * `docs/plugin-test-protocol.md`). Declaring them lets the Launcher say what
   * a plugin checks before any of its code runs, and registering an
   * undeclared id throws at load.
   *
   * Unlike every other code-backed contribution here, this one derives no
   * install permission — a test only ever executes because the author picked
   * it out of the Run > Test dialog and pressed Start, so there is no ambient
   * capability to consent to at install time.
   */
  tests?: string[];
  /**
   * Capability domains the `runtime` entry may use. Each maps 1:1 onto a
   * namespace on `app.game`, and an undeclared domain is absent from that
   * object rather than present-and-throwing — so what the install prompt
   * listed and what the plugin can reach are the same set by construction.
   */
  runtimeCapabilities?: PluginRuntimeCapability[];
  /** Native child processes shipped inside the author's game. */
  sidecars?: PluginSidecarContribution[];
  /** External binaries fetched (and cached) at build time. */
  buildDependencies?: PluginBuildDependencyContribution[];
  /**
   * Values the author supplies before a build can ship. Declaration only - see
   * {@link PluginBuildConfigFieldContribution} for why there is no registration API and why this
   * grants the plugin nothing.
   */
  buildConfig?: PluginBuildConfigFieldContribution[];
  /**
   * Address patterns this plugin may hand to the player's browser or platform handler, through
   * `app.game.navigation.openExternal`.
   *
   * Unlike everything else here, this one is *not* a list of identifiers the plugin owns - it is a
   * list of places outside the game it may reach, so it derives an install permission the author
   * approves by name (see `PluginInstallPermission` `kind: "externalLink"`) and adding one to a
   * later version re-prompts.
   *
   * Patterns are matched structurally, never as strings: see `isExternalLinkPatternDeclared` in
   * `@shared/types/externalLinkPattern` for the exact semantics. Wildcards are allowed
   * (`https://*.example.com/app/*`) and the scheme is not restricted to `http(s)`, because the
   * storefronts a plugin integrates with speak their own (`steam://run/480`). A handful of schemes
   * are refused at validation whatever a manifest says; that list and its reasoning live in the
   * same module.
   *
   * This is separate from, and grants nothing towards, {@link network}: opening a page and
   * fetching bytes are different acts, and the Open Link node the author writes is a third thing
   * again, governed only by its scheme.
   */
  externalLinks?: string[];
  /**
   * Address patterns this plugin's runtime code requests bytes from.
   *
   * Like {@link externalLinks} and unlike everything else here, this is a list of places outside
   * the game rather than identifiers the plugin owns, so it derives an install permission the
   * author approves by name (`PluginInstallPermission` `kind: "network"`) and adding one to a
   * later version re-prompts.
   *
   * Two rules narrower than the external-link patterns, both for the same reason - what comes
   * back from a fetch runs inside the game, while an opened page does not:
   *
   *  - **`http(s)` only.** There is no storefront-scheme case here; a plugin that fetches speaks
   *    HTTP.
   *  - **The path is written out.** `https://api.example.com/*` is a declaration and
   *    `https://api.example.com` is not, because the pattern language reads the second as the
   *    single path `/`. It is refused rather than rewritten: this string is what the install
   *    prompt shows, and a manifest whose text differs from what was approved is the one thing
   *    this whole mechanism exists to prevent.
   *
   * What this reaches is *not* widened by the project's own network allowlist and does not widen
   * it. A build narrowed to a list still reaches these hosts - the author approved them at
   * install - and the list shows them attributed to this plugin rather than quietly making room.
   */
  network?: string[];
};

export type PluginManifestV2 = Omit<PluginIdentity, "id" | "name" | "version"> &
  Required<Pick<PluginIdentity, "id" | "name" | "version">> & {
    manifestVersion: typeof PluginManifestVersion;
    description?: string;
    /**
     * Package-relative path to the thumbnail shown beside the plugin's name in
     * the Launcher list. Square, at most 512x512, and one of the extensions in
     * `PLUGIN_ICON_EXTENSIONS`. Plugins without one keep the name monogram.
     */
    icon?: string;
    entries: PluginManifestEntries;
    contributes?: PluginContributes;
    permissions?: PluginInstallPermission[];
  };

export type NormalizedPluginManifestV2 = PluginManifestV2 & {
  contributes: Required<PluginContributes>;
  permissions: PluginInstallPermission[];
};

export type PluginInstallSource =
  | { kind: "local-directory"; path: string }
  | { kind: "builtin"; path: string }
  | { kind: "registry"; url: string };

export type PluginInstallRecord = {
  pluginId: string;
  installPath: string;
  enabled: boolean;
  builtIn: boolean;
  manifest: NormalizedPluginManifestV2;
  installSource: PluginInstallSource;
  installedAt: number;
  updatedAt: number;
  grantedManifestVersion?: string | null;
  /**
   * The permission set the user actually approved, recorded so a later version
   * that does not widen it can inherit the grant instead of re-prompting.
   * Absent on records written before this was tracked — the manifest at
   * `grantedManifestVersion` is the fallback source of truth for those.
   */
  grantedPermissions?: PluginInstallPermission[] | null;
  lastError?: string | null;
};

export type PluginStatus = "enabled" | "disabled" | "needsAuthorization" | "error";

export type PluginListItem = {
  pluginId: string;
  manifest: NormalizedPluginManifestV2;
  /**
   * `app://` address of the declared icon, absent when the plugin ships none.
   * Resolved here rather than in the renderer because only the main process
   * knows where the package landed on disk.
   */
  iconUrl?: string;
  installPath: string;
  enabled: boolean;
  builtIn: boolean;
  status: PluginStatus;
  installSource: PluginInstallSource;
  installedAt: number;
  updatedAt: number;
  grantedManifestVersion?: string | null;
  lastError?: string | null;
};

/** Descriptor handed to the workspace window: plugins with a studio entry. */
export type WorkspacePluginDescriptor = {
  plugin: PluginIdentity;
  manifest: NormalizedPluginManifestV2;
  entryUrl: string;
};

/** Descriptor handed to game execution environments: plugins with a runtime entry. */
export type RuntimePluginDescriptor = {
  plugin: PluginIdentity;
  manifest: NormalizedPluginManifestV2;
  entryUrl: string;
  /**
   * Published plugin storage, keyed by the namespaces declared in
   * `contributes.runtimeData`. Absent namespaces simply have no entry - a
   * plugin must tolerate missing data (the project may never have written it).
   */
  data?: Record<string, unknown>;
  /**
   * This plugin's own `contributes.buildConfig` values, as the build that produced the pack
   * resolved them, keyed by field key. Only ever the declaring plugin's own values: the pack
   * holds one record per plugin and a descriptor is built from one entry.
   *
   * Absent outside a compiled pack - the editor and Dev Mode hand out descriptors that were never
   * built for a variant, so there is nothing resolved to carry.
   */
  buildConfig?: Record<string, string>;
};

export type PluginInstallResult =
  | {
      canceled: true;
      plugin?: never;
    }
  | {
      canceled: false;
      plugin: PluginListItem;
    };

export type PluginApproveResult = {
  plugin: PluginListItem;
  approved: boolean;
};
