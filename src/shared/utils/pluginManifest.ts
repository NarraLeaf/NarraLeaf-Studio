import {
    PLUGIN_RUNTIME_CAPABILITIES,
    type PluginInstallPermission,
    type PluginRuntimeCapability,
} from "../types/pluginPermissions";
import {
    EXTERNAL_LINK_PATTERN_DENIED_SCHEMES,
    externalLinkPatternKey,
} from "../types/externalLinkPattern";
import { pluginIconExtension, pluginIconExtensionList } from "./pluginIcon";
import { GAME_BUILD_FORMATS_BY_PLATFORM, type GameBuildPlatform } from "../types/gameBuild";
import {
    PLUGIN_BUILD_CONFIG_SCOPES,
    PLUGIN_BUILD_CONFIG_TYPES,
    PluginManifestVersion,
    type NormalizedPluginManifestV2,
    type PluginBuildConfigFieldContribution,
    type PluginBuildConfigScope,
    type PluginBuildConfigType,
    type PluginBuildDependencyContribution,
    type PluginBuildDependencyTargetContribution,
    type PluginContributes,
    type PluginLocaleContribution,
    type PluginManifestEntries,
    type PluginManifestV2,
    type PluginSidecarContribution,
    type PluginSidecarTargetContribution,
} from "../types/plugins";

export type PluginManifestValidationResult =
    | { ok: true; manifest: NormalizedPluginManifestV2 }
    | { ok: false; error: string };

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

export const PLUGIN_ENTRY_TARGETS = ["studio", "runtime"] as const;
export type PluginEntryTarget = (typeof PLUGIN_ENTRY_TARGETS)[number];

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

    const entries = validateEntries(value.entries);
    if (typeof entries === "string") {
        return invalid(entries);
    }

    const contributes = validateContributes(value.contributes, id);
    if (typeof contributes === "string") {
        return invalid(contributes);
    }

    // Capabilities and sidecars are powers of the *runtime* entry. Declaring them
    // without one asks the user to approve something nothing can use, so it is a
    // manifest error rather than a quiet no-op.
    if (!entries.runtime) {
        if (contributes.runtimeCapabilities.length > 0) {
            return invalid("Plugin contributes.runtimeCapabilities requires a runtime entry");
        }
        if (contributes.sidecars.length > 0) {
            return invalid("Plugin contributes.sidecars requires a runtime entry");
        }
        if (contributes.externalLinks.length > 0) {
            return invalid("Plugin contributes.externalLinks requires a runtime entry");
        }
    }

    const icon = validateIcon(value.icon);
    if (typeof icon === "object") {
        return invalid(icon.error);
    }

    const description = readOptionalString(value, "description");
    const publisher = readOptionalString(value, "publisher");
    const declared = value.permissions === undefined
        ? []
        : validatePermissions(value.permissions);
    if (!Array.isArray(declared)) {
        return invalid(declared);
    }

    // Author-declared permissions carry only the privileged Studio controls; the
    // capability-shaped ones are derived from `contributes` below so the prompt
    // and the API surface are the same set by construction.
    const permissions: PluginInstallPermission[] = [
        ...declared,
        ...derivePermissionsFromContributes(contributes),
    ];

    const manifest: NormalizedPluginManifestV2 = {
        manifestVersion: PluginManifestVersion,
        id,
        name,
        version,
        entries,
        contributes,
        permissions,
        ...(description ? { description } : {}),
        ...(publisher ? { publisher } : {}),
        ...(icon ? { icon } : {}),
    };

    return { ok: true, manifest };
}

/**
 * The declared icon path, `undefined` when none, or `{ error }`.
 *
 * Only the shape is decidable here — this validator is pure and the icon is a
 * file. Whether those bytes are a square image within the size limits is checked
 * where the package is on disk (see `validatePluginIconBytes`).
 */
function validateIcon(value: unknown): string | undefined | { error: string } {
    if (value === undefined) {
        return undefined;
    }
    const icon = typeof value === "string" ? value.trim() : "";
    if (!icon || !isSafeRelativeEntry(icon)) {
        return { error: "Plugin icon must be a relative image path inside the plugin package" };
    }
    if (!pluginIconExtension(icon)) {
        return { error: `Plugin icon must be one of: ${pluginIconExtensionList()}` };
    }
    return icon;
}

/**
 * Turn declared contributions into the install permissions the user approves.
 *
 * This is the only producer of the derived kinds — `validatePermissions` rejects
 * them in hand-written `permissions[]` — which is what stops "what the prompt
 * said" from drifting away from "what the plugin can do".
 *
 * `contributes.tests` is deliberately absent from this function, and its absence
 * is a decision rather than an omission: every other code-backed contribution
 * here gains a power the moment the plugin loads, but a test only ever runs
 * because the author opened Run > Test, picked it out of the dialog and pressed
 * Start. There is no ambient capability to consent to at install time, and what
 * a test may reach while running is gated separately by its own `requires`
 * (see `src/renderer/lib/testing/types.ts`). Adding a permission here would ask
 * the author to approve something that cannot happen without them asking for it.
 *
 * `contributes.buildConfig` is absent for the same reason and a simpler one: a
 * declared field is a blank the author fills in, and filling it in gives the
 * plugin no reach it did not already have.
 */
function derivePermissionsFromContributes(
    contributes: Required<PluginContributes>,
): PluginInstallPermission[] {
    const derived: PluginInstallPermission[] = [];
    for (const capability of contributes.runtimeCapabilities) {
        derived.push({ kind: "runtime", capability });
    }
    for (const sidecar of contributes.sidecars) {
        // `sidecarKind` travels with the id because it changes what is being approved: an
        // `executable` is a separate process, while a `node` sidecar is the plugin's own code
        // running with the reach of the game itself. A permission that said only "ships a helper
        // program" would describe both and distinguish neither.
        derived.push({
            kind: "sidecar",
            id: sidecar.id,
            sidecarKind: sidecar.kind,
            platforms: Object.keys(sidecar.targets).sort(),
        });
    }
    for (const dependency of contributes.buildDependencies) {
        const hosts: string[] = [];
        for (const target of Object.values(dependency.targets)) {
            const host = hostnameOf(target.url);
            if (host && !hosts.includes(host)) {
                hosts.push(host);
            }
        }
        derived.push({ kind: "buildDependency", id: dependency.id, hosts: hosts.sort() });
    }
    // One permission carrying every pattern - the author is answering one question about where this
    // plugin may send the player. Absent entirely when nothing was declared, which is what keeps a
    // plugin that opens nothing byte-identical to one written before this existed.
    if (contributes.externalLinks.length > 0) {
        derived.push({ kind: "externalLink", patterns: [...contributes.externalLinks] });
    }
    return derived;
}

function hostnameOf(url: string): string | null {
    try {
        return new URL(url).hostname || null;
    } catch {
        return null;
    }
}

/** Contribution kinds whose value is an array of `<pluginId>.`-prefixed type strings. */
const CONTRIBUTES_TYPE_KEYS = ["blueprintNodes", "widgets", "runtimeData", "tests"] as const;

/** Every recognized `contributes` key, including the object-shaped ones. */
const CONTRIBUTES_KEYS = [
    ...CONTRIBUTES_TYPE_KEYS,
    "locales",
    "runtimeCapabilities",
    "sidecars",
    "buildDependencies",
    "buildConfig",
    "externalLinks",
] as const;

/**
 * Every platform a build can target, read off the format table so the two cannot disagree: the table
 * is a `Record<GameBuildPlatform, ...>`, so a platform added to the union without a row there fails
 * to compile long before it could reach a manifest.
 */
const BUILD_CONFIG_PLATFORMS = Object.keys(GAME_BUILD_FORMATS_BY_PLATFORM) as GameBuildPlatform[];

/**
 * Desktop platforms only. Web has no process to spawn and the mobile shells are
 * WebViews, so a binary keyed to them could never run — declaring one is a
 * mistake worth failing on rather than quietly dropping.
 */
const BINARY_PLATFORMS = ["windows", "macos", "linux"] as const;
const BINARY_ARCHS = ["x64", "arm64", "universal"] as const;

const SIDECAR_DEFAULTS = {
    kind: "executable",
    transport: "stdio-jsonl",
    autostart: "onGameStart",
    startupTimeoutMs: 5000,
    shutdownTimeoutMs: 3000,
    restart: { maxRetries: 3, backoffMs: 1000 },
} as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

/** `dep:<buildDependencyId>/<path>` — an include served by a build dependency. */
const DEP_INCLUDE_PREFIX = "dep:";

export function isPluginBinaryPlatformKey(value: string): boolean {
    const separator = value.lastIndexOf("-");
    if (separator <= 0) {
        return false;
    }
    const platform = value.slice(0, separator);
    const arch = value.slice(separator + 1);
    if (!BINARY_PLATFORMS.includes(platform as (typeof BINARY_PLATFORMS)[number])) {
        return false;
    }
    if (!BINARY_ARCHS.includes(arch as (typeof BINARY_ARCHS)[number])) {
        return false;
    }
    // "universal" is a macOS fat-binary concept; elsewhere it would silently
    // never match the arch actually being built.
    return arch !== "universal" || platform === "macos";
}

const CONTRIBUTES_KIND_LABEL: Record<(typeof CONTRIBUTES_TYPE_KEYS)[number], string> = {
    blueprintNodes: "blueprint node",
    widgets: "widget",
    runtimeData: "storage namespace",
    tests: "test",
};

/** BCP-47-ish locale code: primary subtag plus optional hyphen-joined subtags. */
const LOCALE_CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]+)*$/;

function validateContributes(value: unknown, pluginId: string): Required<PluginContributes> | string {
    const empty: Required<PluginContributes> = {
        blueprintNodes: [],
        widgets: [],
        runtimeData: [],
        tests: [],
        locales: [],
        runtimeCapabilities: [],
        sidecars: [],
        buildDependencies: [],
        buildConfig: [],
        externalLinks: [],
    };
    if (value === undefined) {
        return empty;
    }
    if (!isRecord(value)) {
        return "Plugin contributes must be an object";
    }

    const unknownKeys = Object.keys(value).filter(key => !CONTRIBUTES_KEYS.includes(key as (typeof CONTRIBUTES_KEYS)[number]));
    if (unknownKeys.length > 0) {
        return `Unsupported plugin contributes key(s): ${unknownKeys.join(", ")}`;
    }

    const result = empty;
    for (const key of CONTRIBUTES_TYPE_KEYS) {
        const raw = value[key];
        if (raw === undefined) {
            continue;
        }
        if (!Array.isArray(raw)) {
            return `Plugin contributes.${key} must be an array of strings`;
        }
        const types: string[] = [];
        for (const item of raw) {
            const type = typeof item === "string" ? item.trim() : "";
            if (!type) {
                return `Plugin contributes.${key} entries must be non-empty strings`;
            }
            if (!type.startsWith(`${pluginId}.`)) {
                return `Contributed ${CONTRIBUTES_KIND_LABEL[key]} must be prefixed with the plugin id: ${type}`;
            }
            if (!types.includes(type)) {
                types.push(type);
            }
        }
        result[key] = types;
    }

    if (value.locales !== undefined) {
        const locales = validateLocaleContributions(value.locales);
        if (typeof locales === "string") {
            return locales;
        }
        result.locales = locales;
    }

    if (value.runtimeCapabilities !== undefined) {
        const capabilities = validateRuntimeCapabilities(value.runtimeCapabilities);
        if (typeof capabilities === "string") {
            return capabilities;
        }
        result.runtimeCapabilities = capabilities;
    }

    // Build dependencies first: sidecar `dep:` includes are checked against them.
    if (value.buildDependencies !== undefined) {
        const dependencies = validateBuildDependencies(value.buildDependencies, pluginId);
        if (typeof dependencies === "string") {
            return dependencies;
        }
        result.buildDependencies = dependencies;
    }

    if (value.sidecars !== undefined) {
        const sidecars = validateSidecars(
            value.sidecars,
            pluginId,
            result.buildDependencies.map(dependency => dependency.id),
        );
        if (typeof sidecars === "string") {
            return sidecars;
        }
        result.sidecars = sidecars;
    }

    if (value.buildConfig !== undefined) {
        const fields = validateBuildConfig(value.buildConfig, pluginId);
        if (typeof fields === "string") {
            return fields;
        }
        result.buildConfig = fields;
    }

    if (value.externalLinks !== undefined) {
        const patterns = validateExternalLinks(value.externalLinks, pluginId);
        if (typeof patterns === "string") {
            return patterns;
        }
        result.externalLinks = patterns;
    }

    return result;
}

/**
 * Address patterns the plugin may open.
 *
 * Refused here rather than at the point of use, because this is the only moment before the author
 * is asked to approve them - a pattern that cannot match anything would appear in the prompt as a
 * permission being granted and then never grant it, and a pattern naming a script scheme would
 * appear as an address and not be one.
 *
 * Four things are rejected, and the fourth is the security-bearing one:
 *
 *  - a blank entry, which declares nothing while looking like it declares something;
 *  - anything that does not parse into a scheme, which is every relative or bare-host string
 *    somebody hoped would work (`store.example.com/*`);
 *  - a duplicate, compared on the canonical form so `HTTPS://X.com/` and `https://x.com/` count as
 *    the one declaration they are;
 *  - a denied scheme. `javascript:`, `data:` and `vbscript:` are not addresses at all - handing one
 *    to the platform opener is how "open a link" becomes "run this" - and `file:` is an address
 *    whose opener runs the file's registered handler, which for an executable is the same thing.
 *    Refused whatever the manifest says and whatever the author would have approved, because the
 *    prompt cannot phrase those honestly as "open a page".
 *
 * Unlike the contributed identifier lists, patterns carry no plugin-id prefix: they name places in
 * the world rather than things the plugin owns.
 */
function validateExternalLinks(value: unknown, pluginId: string): string[] | string {
    if (!Array.isArray(value)) {
        return "Plugin contributes.externalLinks must be an array of address patterns";
    }
    const seen = new Set<string>();
    const patterns: string[] = [];
    for (const item of value) {
        const pattern = typeof item === "string" ? item.trim() : "";
        if (!pattern) {
            return `Plugin contributes.externalLinks entries must be non-empty strings (plugin "${pluginId}")`;
        }
        const key = externalLinkPatternKey(pattern);
        if (!key) {
            return `Plugin contributes.externalLinks entry is not an address pattern: ${pattern}. `
                + "It must be absolute and name a scheme, must not carry credentials, may use `*` "
                + "only as a whole leading host label or as the entire host, and must not name "
                + `any of: ${EXTERNAL_LINK_PATTERN_DENIED_SCHEMES.join(", ")}`;
        }
        if (seen.has(key)) {
            return `Plugin contributes.externalLinks declares "${pattern}" more than once`;
        }
        seen.add(key);
        // The author's own spelling is kept: it is what the install prompt shows, and the person
        // approving it should read the string the manifest holds rather than a rewrite of it.
        patterns.push(pattern);
    }
    return patterns;
}

/**
 * Build config field declarations.
 *
 * Unlike the other contributed identifiers these keys are *not* prefixed with the plugin id: the
 * store is already per plugin, so a prefix would only repeat the plugin id inside every key. They
 * must be unique within the plugin, which is the whole of what keys a value.
 *
 * Nothing here is validated against the project - a field is a question, and whether the author has
 * answered it is decided where the build is described, not here.
 */
function validateBuildConfig(
    value: unknown,
    pluginId: string,
): PluginBuildConfigFieldContribution[] | string {
    if (!Array.isArray(value)) {
        return "Plugin contributes.buildConfig must be an array of field objects";
    }
    const seen = new Set<string>();
    const fields: PluginBuildConfigFieldContribution[] = [];
    for (const item of value) {
        if (!isRecord(item)) {
            return "Plugin contributes.buildConfig entries must be objects";
        }
        const key = typeof item.key === "string" ? item.key.trim() : "";
        if (!key) {
            return `Plugin contributes.buildConfig entries must declare a key (plugin "${pluginId}")`;
        }
        if (seen.has(key)) {
            return `Plugin contributes.buildConfig declares "${key}" more than once`;
        }
        seen.add(key);

        // The label is what the author sees; a blank one produces a field nothing on screen
        // identifies, which is worse than a manifest that fails to install.
        const label = typeof item.label === "string" ? item.label.trim() : "";
        if (!label) {
            return `Plugin contributes.buildConfig["${key}"] must declare a label`;
        }

        const type = item.type;
        if (!PLUGIN_BUILD_CONFIG_TYPES.includes(type as PluginBuildConfigType)) {
            return `Plugin contributes.buildConfig["${key}"] type must be one of: `
                + PLUGIN_BUILD_CONFIG_TYPES.join(", ");
        }
        const scope = item.scope;
        if (!PLUGIN_BUILD_CONFIG_SCOPES.includes(scope as PluginBuildConfigScope)) {
            return `Plugin contributes.buildConfig["${key}"] scope must be one of: `
                + PLUGIN_BUILD_CONFIG_SCOPES.join(", ");
        }

        const platforms = validateBuildConfigPlatforms(item.platforms, key);
        if (typeof platforms === "string") {
            return platforms;
        }

        const description = typeof item.description === "string" && item.description.trim()
            ? item.description.trim()
            : undefined;
        fields.push({
            key,
            label,
            type: type as PluginBuildConfigType,
            scope: scope as PluginBuildConfigScope,
            ...(description ? { description } : {}),
            ...(platforms ? { platforms } : {}),
            ...(item.required === true ? { required: true } : {}),
        });
    }
    return fields;
}

/**
 * The platforms a field applies to, or `undefined` for "every platform".
 *
 * An empty list is refused rather than read as "every platform": it is a field that applies nowhere,
 * so nothing would ever ask for it, and the author would never learn why the value they were told to
 * supply has no place to be typed.
 */
function validateBuildConfigPlatforms(
    value: unknown,
    key: string,
): GameBuildPlatform[] | undefined | string {
    if (value === undefined) {
        return undefined;
    }
    if (!Array.isArray(value) || value.length === 0) {
        return `Plugin contributes.buildConfig["${key}"] platforms must be a non-empty array, or absent for every platform`;
    }
    const platforms: GameBuildPlatform[] = [];
    for (const item of value) {
        const platform = typeof item === "string" ? item.trim() : "";
        if (!BUILD_CONFIG_PLATFORMS.includes(platform as GameBuildPlatform)) {
            return `Plugin contributes.buildConfig["${key}"] names an unknown platform: ${String(item)} `
                + `(known: ${BUILD_CONFIG_PLATFORMS.join(", ")})`;
        }
        if (!platforms.includes(platform as GameBuildPlatform)) {
            platforms.push(platform as GameBuildPlatform);
        }
    }
    return platforms;
}

function validateRuntimeCapabilities(value: unknown): PluginRuntimeCapability[] | string {
    if (!Array.isArray(value)) {
        return "Plugin contributes.runtimeCapabilities must be an array of capability strings";
    }
    const capabilities: PluginRuntimeCapability[] = [];
    for (const item of value) {
        const capability = typeof item === "string" ? item.trim() : "";
        if (!capability) {
            return "Plugin contributes.runtimeCapabilities entries must be non-empty strings";
        }
        if (!PLUGIN_RUNTIME_CAPABILITIES.includes(capability as PluginRuntimeCapability)) {
            return `Unknown plugin runtime capability: ${capability} `
                + `(known: ${PLUGIN_RUNTIME_CAPABILITIES.join(", ")})`;
        }
        if (!capabilities.includes(capability as PluginRuntimeCapability)) {
            capabilities.push(capability as PluginRuntimeCapability);
        }
    }
    // Writing a variable lets you observe what you wrote, so `state.write` alone
    // would understate the plugin's reach in the install prompt. Implying the
    // read half keeps the prompt honest and lets the runtime hand out one
    // coherent `state` object instead of a half-populated one.
    if (capabilities.includes("state.write") && !capabilities.includes("state.read")) {
        capabilities.push("state.read");
    }
    return capabilities;
}

function validateSidecars(
    value: unknown,
    pluginId: string,
    buildDependencyIds: string[],
): PluginSidecarContribution[] | string {
    if (!Array.isArray(value)) {
        return "Plugin contributes.sidecars must be an array of sidecar objects";
    }
    const seen = new Set<string>();
    const sidecars: PluginSidecarContribution[] = [];
    for (const item of value) {
        if (!isRecord(item)) {
            return "Plugin contributes.sidecars entries must be objects";
        }
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id || !id.startsWith(`${pluginId}.`)) {
            return `Contributed sidecar id must be prefixed with the plugin id: ${String(item.id)}`;
        }
        if (seen.has(id)) {
            return `Plugin contributes.sidecars declares "${id}" more than once`;
        }
        seen.add(id);

        const kind = item.kind ?? SIDECAR_DEFAULTS.kind;
        if (kind !== "executable" && kind !== "node") {
            return `Plugin sidecar "${id}" kind must be "executable" or "node"`;
        }
        const transport = item.transport ?? SIDECAR_DEFAULTS.transport;
        if (transport !== "stdio-jsonl") {
            return `Plugin sidecar "${id}" transport must be "stdio-jsonl"`;
        }
        const autostart = item.autostart ?? SIDECAR_DEFAULTS.autostart;
        if (autostart !== "onGameStart" && autostart !== "onRequest") {
            return `Plugin sidecar "${id}" autostart must be "onGameStart" or "onRequest"`;
        }
        const startupTimeoutMs = readPositiveInt(item.startupTimeoutMs, SIDECAR_DEFAULTS.startupTimeoutMs);
        if (startupTimeoutMs === null) {
            return `Plugin sidecar "${id}" startupTimeoutMs must be a positive integer`;
        }
        const shutdownTimeoutMs = readPositiveInt(item.shutdownTimeoutMs, SIDECAR_DEFAULTS.shutdownTimeoutMs);
        if (shutdownTimeoutMs === null) {
            return `Plugin sidecar "${id}" shutdownTimeoutMs must be a positive integer`;
        }
        const restart = validateSidecarRestart(item.restart, id);
        if (typeof restart === "string") {
            return restart;
        }

        const targets = validateSidecarTargets(item.targets, id, buildDependencyIds);
        if (typeof targets === "string") {
            return targets;
        }

        sidecars.push({
            id,
            kind,
            transport,
            autostart,
            startupTimeoutMs,
            shutdownTimeoutMs,
            restart,
            targets,
        });
    }
    return sidecars;
}

function validateSidecarRestart(
    value: unknown,
    sidecarId: string,
): PluginSidecarContribution["restart"] | string {
    if (value === undefined) {
        return { ...SIDECAR_DEFAULTS.restart };
    }
    if (!isRecord(value)) {
        return `Plugin sidecar "${sidecarId}" restart must be an object`;
    }
    const maxRetries = readPositiveInt(value.maxRetries, SIDECAR_DEFAULTS.restart.maxRetries, true);
    if (maxRetries === null) {
        return `Plugin sidecar "${sidecarId}" restart.maxRetries must be a non-negative integer`;
    }
    const backoffMs = readPositiveInt(value.backoffMs, SIDECAR_DEFAULTS.restart.backoffMs);
    if (backoffMs === null) {
        return `Plugin sidecar "${sidecarId}" restart.backoffMs must be a positive integer`;
    }
    return { maxRetries, backoffMs };
}

function validateSidecarTargets(
    value: unknown,
    sidecarId: string,
    buildDependencyIds: string[],
): Record<string, PluginSidecarTargetContribution> | string {
    if (!isRecord(value) || Object.keys(value).length === 0) {
        return `Plugin sidecar "${sidecarId}" must declare at least one platform target`;
    }
    const targets: Record<string, PluginSidecarTargetContribution> = {};
    for (const [platformKey, rawTarget] of Object.entries(value)) {
        if (!isPluginBinaryPlatformKey(platformKey)) {
            return `Plugin sidecar "${sidecarId}" has an unsupported platform key: ${platformKey} `
                + "(expected <windows|macos|linux>-<x64|arm64>, or macos-universal)";
        }
        if (!isRecord(rawTarget)) {
            return `Plugin sidecar "${sidecarId}" target "${platformKey}" must be an object`;
        }
        const entry = typeof rawTarget.entry === "string" ? rawTarget.entry.trim() : "";
        if (!entry || !isSafeRelativeEntry(entry)) {
            return `Plugin sidecar "${sidecarId}" target "${platformKey}" entry must be a relative path inside the package`;
        }
        if (!Array.isArray(rawTarget.include) || rawTarget.include.length === 0) {
            return `Plugin sidecar "${sidecarId}" target "${platformKey}" must list the files it ships in "include"`;
        }
        const include: string[] = [];
        for (const rawInclude of rawTarget.include) {
            const item = typeof rawInclude === "string" ? rawInclude.trim() : "";
            if (!item) {
                return `Plugin sidecar "${sidecarId}" target "${platformKey}" include entries must be non-empty strings`;
            }
            if (item.startsWith(DEP_INCLUDE_PREFIX)) {
                const reference = item.slice(DEP_INCLUDE_PREFIX.length);
                const separator = reference.indexOf("/");
                const dependencyId = separator === -1 ? reference : reference.slice(0, separator);
                const relative = separator === -1 ? "" : reference.slice(separator + 1);
                if (!buildDependencyIds.includes(dependencyId)) {
                    return `Plugin sidecar "${sidecarId}" include references undeclared build dependency "${dependencyId}"`;
                }
                if (!relative || !isSafeRelativeEntry(relative)) {
                    return `Plugin sidecar "${sidecarId}" include "${item}" must name a path inside the dependency`;
                }
            } else if (!isSafeRelativeEntry(item)) {
                return `Plugin sidecar "${sidecarId}" include "${item}" must be a relative path inside the package`;
            }
            if (!include.includes(item)) {
                include.push(item);
            }
        }
        if (!include.includes(entry)) {
            return `Plugin sidecar "${sidecarId}" target "${platformKey}" entry "${entry}" must also appear in "include"`;
        }

        const sha256 = validateSidecarDigests(rawTarget.sha256, include, sidecarId, platformKey);
        if (typeof sha256 === "string") {
            return sha256;
        }
        targets[platformKey] = { entry, include, sha256 };
    }
    return targets;
}

/**
 * Every package-relative include needs a digest. `dep:` includes are exempt —
 * their bytes are pinned by the build dependency's own `sha256`, and the plugin
 * package does not contain them to hash.
 */
function validateSidecarDigests(
    value: unknown,
    include: string[],
    sidecarId: string,
    platformKey: string,
): Record<string, string> | string {
    if (!isRecord(value)) {
        return `Plugin sidecar "${sidecarId}" target "${platformKey}" must declare sha256 digests for its shipped files`;
    }
    const packaged = include.filter(item => !item.startsWith(DEP_INCLUDE_PREFIX));
    const digests: Record<string, string> = {};
    for (const file of packaged) {
        const digest = typeof value[file] === "string" ? (value[file] as string).trim() : "";
        if (!SHA256_PATTERN.test(digest)) {
            return `Plugin sidecar "${sidecarId}" target "${platformKey}" is missing a valid sha256 for "${file}"`;
        }
        digests[file] = digest.toLowerCase();
    }
    const extra = Object.keys(value).filter(file => !packaged.includes(file));
    if (extra.length > 0) {
        return `Plugin sidecar "${sidecarId}" target "${platformKey}" declares sha256 for files it does not ship: ${extra.join(", ")}`;
    }
    return digests;
}

function validateBuildDependencies(
    value: unknown,
    pluginId: string,
): PluginBuildDependencyContribution[] | string {
    if (!Array.isArray(value)) {
        return "Plugin contributes.buildDependencies must be an array of dependency objects";
    }
    const seen = new Set<string>();
    const dependencies: PluginBuildDependencyContribution[] = [];
    for (const item of value) {
        if (!isRecord(item)) {
            return "Plugin contributes.buildDependencies entries must be objects";
        }
        const id = typeof item.id === "string" ? item.id.trim() : "";
        if (!id || !id.startsWith(`${pluginId}.`)) {
            return `Contributed build dependency id must be prefixed with the plugin id: ${String(item.id)}`;
        }
        if (seen.has(id)) {
            return `Plugin contributes.buildDependencies declares "${id}" more than once`;
        }
        seen.add(id);

        if (!isRecord(item.targets) || Object.keys(item.targets).length === 0) {
            return `Plugin build dependency "${id}" must declare at least one platform target`;
        }
        const targets: Record<string, PluginBuildDependencyTargetContribution> = {};
        for (const [platformKey, rawTarget] of Object.entries(item.targets)) {
            if (!isPluginBinaryPlatformKey(platformKey)) {
                return `Plugin build dependency "${id}" has an unsupported platform key: ${platformKey}`;
            }
            const target = validateBuildDependencyTarget(rawTarget, id, platformKey);
            if (typeof target === "string") {
                return target;
            }
            targets[platformKey] = target;
        }

        const description = typeof item.description === "string" && item.description.trim()
            ? item.description.trim()
            : undefined;
        dependencies.push({ id, targets, ...(description ? { description } : {}) });
    }
    return dependencies;
}

function validateBuildDependencyTarget(
    value: unknown,
    dependencyId: string,
    platformKey: string,
): PluginBuildDependencyTargetContribution | string {
    const where = `Plugin build dependency "${dependencyId}" target "${platformKey}"`;
    if (!isRecord(value)) {
        return `${where} must be an object`;
    }
    const url = typeof value.url === "string" ? value.url.trim() : "";
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return `${where} url must be an absolute URL`;
    }
    // Plain HTTP would let anyone on the path swap the bytes; the digest check
    // would catch it, but the failure mode should be "cannot be attacked", not
    // "attack is detected after downloading it".
    if (parsed.protocol !== "https:") {
        return `${where} url must use https`;
    }
    const sha256 = typeof value.sha256 === "string" ? value.sha256.trim() : "";
    if (!SHA256_PATTERN.test(sha256)) {
        return `${where} must declare a valid sha256`;
    }

    const archive = value.archive ?? "zip";
    if (archive === "none") {
        const fileName = typeof value.fileName === "string" ? value.fileName.trim() : "";
        if (!fileName || !isSafeRelativeEntry(fileName)) {
            return `${where} fileName must be a relative path inside the dependency directory`;
        }
        return { url, sha256: sha256.toLowerCase(), archive: "none", fileName };
    }
    if (archive !== "zip") {
        return `${where} archive must be "zip" or "none"`;
    }
    if (!isRecord(value.files) || Object.keys(value.files).length === 0) {
        return `${where} must map at least one archive path in "files"`;
    }
    const files: Record<string, string> = {};
    for (const [inner, rawOut] of Object.entries(value.files)) {
        const out = typeof rawOut === "string" ? rawOut.trim() : "";
        if (!inner.trim()) {
            return `${where} files keys must be non-empty archive paths`;
        }
        if (!out || !isSafeRelativeEntry(out)) {
            return `${where} files["${inner}"] must be a relative path inside the dependency directory`;
        }
        files[inner.trim()] = out;
    }
    return { url, sha256: sha256.toLowerCase(), archive: "zip", files };
}

function readPositiveInt(value: unknown, fallback: number, allowZero = false): number | null {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
        return null;
    }
    return value > 0 || (allowZero && value === 0) ? value : null;
}

function validateLocaleContributions(value: unknown): PluginLocaleContribution[] | string {
    if (!Array.isArray(value)) {
        return "Plugin contributes.locales must be an array of locale objects";
    }
    const seen = new Set<string>();
    const out: PluginLocaleContribution[] = [];
    for (const item of value) {
        if (!isRecord(item)) {
            return "Plugin contributes.locales entries must be objects";
        }
        const code = typeof item.code === "string" ? item.code.trim() : "";
        if (!code || !LOCALE_CODE_PATTERN.test(code)) {
            return `Plugin contributes.locales entry has an invalid locale code: ${String(item.code)}`;
        }
        if (seen.has(code)) {
            return `Plugin contributes.locales declares "${code}" more than once`;
        }
        const messages = typeof item.messages === "string" ? item.messages.trim() : "";
        if (!messages || !isSafeRelativeEntry(messages)) {
            return `Plugin contributes.locales["${code}"].messages must be a relative JSON file path inside the plugin package`;
        }
        if (item.dir !== undefined && item.dir !== "ltr" && item.dir !== "rtl") {
            return `Plugin contributes.locales["${code}"].dir must be "ltr" or "rtl"`;
        }
        seen.add(code);
        const entry: PluginLocaleContribution = { code, messages };
        const nativeName = typeof item.nativeName === "string" && item.nativeName.trim() ? item.nativeName.trim() : undefined;
        const englishName = typeof item.englishName === "string" && item.englishName.trim() ? item.englishName.trim() : undefined;
        const intl = typeof item.intl === "string" && item.intl.trim() ? item.intl.trim() : undefined;
        if (nativeName) entry.nativeName = nativeName;
        if (englishName) entry.englishName = englishName;
        if (intl) entry.intl = intl;
        if (item.dir === "ltr" || item.dir === "rtl") entry.dir = item.dir;
        out.push(entry);
    }
    return out;
}

function validateEntries(value: unknown): PluginManifestEntries | string {
    if (!isRecord(value)) {
        return "Plugin entries must be an object declaring at least one of: studio, runtime";
    }

    const unknownKeys = Object.keys(value).filter(key => !PLUGIN_ENTRY_TARGETS.includes(key as PluginEntryTarget));
    if (unknownKeys.length > 0) {
        return `Unsupported plugin entry target(s): ${unknownKeys.join(", ")}`;
    }

    const entries: PluginManifestEntries = {};
    for (const target of PLUGIN_ENTRY_TARGETS) {
        const raw = value[target];
        if (raw === undefined) {
            continue;
        }
        const entry = typeof raw === "string" ? raw.trim() : "";
        if (!entry || !isSafeRelativeEntry(entry)) {
            return `Plugin ${target} entry must be a relative file path inside the plugin package`;
        }
        entries[target] = entry;
    }

    if (!entries.studio && !entries.runtime) {
        return "Plugin entries must declare at least one of: studio, runtime";
    }

    return entries;
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

        if (DERIVED_PERMISSION_KINDS.includes(String(permission.kind))) {
            // Hand-writing one of these would be a second place a capability is
            // declared, and two places is how the prompt and the real surface
            // drift apart. There is exactly one source of truth: `contributes`.
            return `Plugin permission kind "${String(permission.kind)}" is derived from contributes and must not be declared by hand`;
        }
        return `Unsupported plugin permission kind: ${String(permission.kind)}`;
    }

    return permissions;
}

/** Permission kinds produced by {@link derivePermissionsFromContributes}, never authored. */
const DERIVED_PERMISSION_KINDS = ["runtime", "sidecar", "buildDependency", "externalLink"];

function readString(record: Record<string, unknown>, key: string): string | null {
    const value = record[key as string];
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readOptionalString(record: Record<string, unknown>, key: keyof PluginManifestV2): string | undefined {
    return readString(record, key) ?? undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(error: string): PluginManifestValidationResult {
    return { ok: false, error };
}
