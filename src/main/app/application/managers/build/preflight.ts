import fs from "fs/promises";
import { constants as fsConstants } from "fs";
import path from "path";
import type { GameBuildArch, GameBuildDesktopPlatform, GameBuildMobilePlatform } from "@shared/types/gameBuild";
import { readProjectIconSet, resolveIconFile } from "@shared/types/projectIcons";
import type {
    NormalizedPluginManifestV2,
    PluginBuildDependencyTargetContribution,
    PluginSidecarContribution,
    PluginSidecarTargetContribution,
} from "@shared/types/plugins";
import type { ProjectConfigData } from "@shared/utils/nlproj";
import type { MobileShellOrientation } from "@/buildWorker/mobile/mobileShellManifest";
// Relative rather than "@/": preflight is unit-tested, and the test runner only
// aliases "@" to the renderer tree - a value import through it would not resolve.
import {
    buildDependencySourcePath,
    probePluginBuildDependency,
} from "../../../../buildWorker/pluginBuildDependencies";

/**
 * The checks a production build applies to a project, factored out of
 * GameBuildManager so the build dialog can run them BEFORE the user commits.
 *
 * GameBuildManager still owns enforcement - it keeps throwing on the blocking
 * cases, because a stored selection carried across hosts (or any non-UI caller)
 * never passes through the dialog. What lives here is the shared judgement, so
 * the two can never disagree about what "valid" means.
 */

/** Semantic version, per semver.org's official grammar. */
const SEMVER_PATTERN =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** Minimum edge electron-builder needs to convert a PNG into .icns/.ico. */
export const MIN_ICON_SIZE = 512;

export function isValidProjectVersion(version: string): boolean {
    return SEMVER_PATTERN.test(version);
}

/** The project's version as the build will read it, or undefined when unset. */
export function readProjectVersion(projectConfig: ProjectConfigData | null): string | undefined {
    const raw = projectConfig?.metadata?.version;
    return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

/** The project's identifier as the build will read it, or undefined when unset. */
export function readProjectIdentifier(projectConfig: ProjectConfigData | null): string | undefined {
    return projectConfig?.identifier?.trim() || undefined;
}

/**
 * The orientation the mobile shells lock the game to. A project-level setting
 * (`app.mobile.orientation`), not per-target: it describes the game, and a
 * project that plays in landscape does so on both platforms. Visual novels are
 * overwhelmingly landscape, so that is the default - including for projects
 * saved before the setting existed.
 */
export function readMobileOrientation(projectConfig: ProjectConfigData | null): MobileShellOrientation {
    const configured = (projectConfig?.app as { mobile?: { orientation?: unknown } } | undefined)?.mobile?.orientation;
    return configured === "portrait" || configured === "auto" || configured === "landscape"
        ? configured
        : "landscape";
}

/**
 * Platforms that carry their own app icon. The mobile shells take one too - the
 * repack scales it into the template's icon slots - so the same configured-icon
 * lookup serves both.
 */
export type GameBuildIconPlatform = GameBuildDesktopPlatform | GameBuildMobilePlatform;

/**
 * The icon file a platform ships: its baked PNG, or the author's raw source
 * when the project has never baked. Reads through the shared icon model, so a
 * project still holding the legacy five-slot shape resolves the same way here,
 * in the artifact compiler, and in the panel.
 */
export function readIconPath(
    projectConfig: ProjectConfigData | null,
    platform: GameBuildIconPlatform,
): string | undefined {
    return resolveIconFile(readProjectIconSet(projectConfig), platform)?.path;
}

/** Resolve a project-relative path, refusing to escape the project root. */
export function resolveInsideProject(projectPath: string, relativePath: string): string {
    const root = path.resolve(projectPath);
    const resolved = path.resolve(root, relativePath.replace(/^[/\\]+/, ""));
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
        throw new Error(`Path escapes project root: ${relativePath}`);
    }
    return resolved;
}

export type IconCheck =
    | {
        status: "ok";
        iconPath: string;
        /** Below the packager's floor: it ships, upscaled, and preflight says so. */
        lowResolution: boolean;
        /** Whether the file came from the authoring bake rather than the raw source. */
        baked: boolean;
    }
    | { status: "missing" }
    | { status: "unusable" };

/**
 * Whether a platform's configured icon can be shipped. "missing" covers both
 * "none configured" and "configured but not on disk"; "unusable" means present
 * but corrupt.
 *
 * A small-but-readable icon is deliberately *not* one of those. It used to be,
 * and the build then quietly swapped in Electron's default - which is how a
 * project could carry an app icon the author had set, could show it in the
 * dialog, and could still ship a packaged game with the Electron logo on it.
 * Shipping the author's own icon upscaled is the lesser wrong, and the warning
 * carries the news.
 */
export async function checkIcon(
    projectPath: string,
    projectConfig: ProjectConfigData | null,
    platform: GameBuildIconPlatform,
): Promise<IconCheck> {
    const configured = resolveIconFile(readProjectIconSet(projectConfig), platform);
    if (!configured) {
        return { status: "missing" };
    }
    let iconPath: string;
    try {
        iconPath = resolveInsideProject(projectPath, configured.path);
        await fs.access(iconPath);
    } catch {
        return { status: "missing" };
    }
    const size = await readPngIconSize(iconPath);
    if (size === "unreadable") {
        return { status: "unusable" };
    }
    return {
        status: "ok",
        iconPath,
        baked: configured.baked,
        lowResolution: size !== null && Math.max(size.width, size.height) < MIN_ICON_SIZE,
    };
}

/**
 * A PNG's dimensions from its IHDR chunk: null for a non-PNG (.ico/.icns are
 * native multi-resolution containers, and their size cannot be read this way),
 * "unreadable" for a file that claims to be a PNG but is corrupt or truncated.
 */
export async function readPngIconSize(
    iconPath: string,
): Promise<{ width: number; height: number } | null | "unreadable"> {
    if (path.extname(iconPath).toLowerCase() !== ".png") {
        return null;
    }
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
        handle = await fs.open(iconPath, "r");
        const header = Buffer.alloc(24);
        const { bytesRead } = await handle.read(header, 0, 24, 0);
        // PNG signature (8) + IHDR length/type (8) + width (4) + height (4).
        if (bytesRead < 24 || header.toString("ascii", 12, 16) !== "IHDR") {
            return "unreadable";
        }
        const width = header.readUInt32BE(16);
        const height = header.readUInt32BE(20);
        return width > 0 && height > 0 ? { width, height } : "unreadable";
    } catch {
        return "unreadable";
    } finally {
        await handle?.close();
    }
}

/** One external binary a shipping plugin needs for one platform being built. */
export type BuildDependencyRequirement = {
    pluginId: string;
    dependencyId: string;
    /** `<platform>-<arch>`, the key the plugin declared the target under. */
    platformKey: string;
    target: PluginBuildDependencyTargetContribution;
};

/** A requirement this host can neither find cached nor fetch. */
export type BuildDependencyGap = BuildDependencyRequirement & {
    /** Why the fetch could not happen (transport error, HTTP 404, …). */
    reason: string;
    /** Where the author saves the file by hand to build with no network. */
    cachePath: string;
};

/**
 * The build dependencies the shipping plugins declare for the platforms being
 * built. A plugin that declares nothing for a platform simply has no dependency
 * there - that is a supported shape, not an omission, so it yields nothing.
 */
export function collectBuildDependencyRequirements(
    manifests: NormalizedPluginManifestV2[],
    platformKeys: string[],
): BuildDependencyRequirement[] {
    const requirements: BuildDependencyRequirement[] = [];
    for (const manifest of manifests) {
        for (const dependency of manifest.contributes.buildDependencies) {
            for (const platformKey of platformKeys) {
                const target = dependency.targets[platformKey];
                if (target) {
                    requirements.push({
                        pluginId: manifest.id,
                        dependencyId: dependency.id,
                        platformKey,
                        target,
                    });
                }
            }
        }
    }
    return requirements;
}

/** The platform key a desktop target's binaries are declared under. */
export function buildDependencyPlatformKey(platform: GameBuildDesktopPlatform, arch: GameBuildArch): string {
    return `${platform}-${arch}`;
}

/**
 * Which required dependencies this host could not obtain. Probes rather than
 * downloads: preflight runs while the build dialog is open, and pulling tens of
 * megabytes to render it would be worse than the problem it reports.
 */
export async function checkBuildDependencies(
    userDataDir: string,
    requirements: BuildDependencyRequirement[],
): Promise<BuildDependencyGap[]> {
    // Probed together: each probe can sit out its own timeout, and a project
    // with several dependencies would otherwise stall the dialog by their sum.
    const probes = await Promise.all(requirements.map(async requirement => ({
        requirement,
        availability: await probePluginBuildDependency({ userDataDir, target: requirement.target }),
    })));
    return probes.flatMap(({ requirement, availability }) => availability.status === "unavailable"
        ? [{
            ...requirement,
            reason: availability.reason,
            cachePath: buildDependencySourcePath(userDataDir, requirement.target.sha256),
        }]
        : []);
}

/** One sidecar a shipping plugin would contribute to one platform being built. */
export type SidecarRequirement = {
    pluginId: string;
    sidecarId: string;
    kind: PluginSidecarContribution["kind"];
    /** `<platform>-<arch>`, the key the sidecar's binaries are declared under. */
    platformKey: string;
    /** Absent when the plugin ships no binaries for this platform key. */
    target?: PluginSidecarTargetContribution;
};

/**
 * Every (sidecar, platform being built) pair the shipping plugins imply -
 * including the pairs a plugin declares nothing for.
 *
 * Deliberately unlike collectBuildDependencyRequirements, which yields only
 * declared targets: a missing build dependency is nothing to report, while a
 * missing sidecar target IS the finding. A plugin whose sidecar exists on
 * Windows and not on Linux still packages, and the game still runs - whatever
 * that sidecar provided is simply gone from the Linux build, silently, unless
 * somebody says so before the author ships it.
 */
export function collectSidecarRequirements(
    manifests: NormalizedPluginManifestV2[],
    platformKeys: string[],
): SidecarRequirement[] {
    const requirements: SidecarRequirement[] = [];
    for (const manifest of manifests) {
        for (const sidecar of manifest.contributes.sidecars) {
            for (const platformKey of platformKeys) {
                const target = sidecar.targets[platformKey];
                requirements.push({
                    pluginId: manifest.id,
                    sidecarId: sidecar.id,
                    kind: sidecar.kind,
                    platformKey,
                    ...(target ? { target } : {}),
                });
            }
        }
    }
    return requirements;
}

/**
 * Whether packaging this sidecar on `hostPlatform` would strip its executable
 * bit, leaving an artifact whose sidecar cannot run.
 *
 * NTFS carries no POSIX mode: Node reports 0666 for every file, and
 * electron-builder writes that straight into the dmg/AppImage it produces. The
 * binary ships intact and unrunnable, and nothing about the build says so - the
 * failure surfaces on a player's machine as a feature that never starts. There
 * is no fix from a Windows host for the formats the packager owns, so this is
 * an error rather than a warning; the way through is to build that target on
 * that platform.
 *
 * `kind: "node"` sidecars are exempt: they run under the game's own Electron as
 * Node, which needs no executable bit on the .js file.
 */
export function sidecarLosesExecBit(
    requirement: SidecarRequirement,
    hostPlatform: GameBuildDesktopPlatform,
): boolean {
    if (hostPlatform !== "windows" || requirement.kind !== "executable" || !requirement.target) {
        return false;
    }
    const targetPlatform = sidecarTargetPlatform(requirement.platformKey);
    return targetPlatform === "macos" || targetPlatform === "linux";
}

/** The platform half of a `<platform>-<arch>` key. */
export function sidecarTargetPlatform(platformKey: string): string {
    const separator = platformKey.indexOf("-");
    return separator === -1 ? platformKey : platformKey.slice(0, separator);
}

export type OutputDirCheck = "ok" | "not-writable" | "not-empty";

/**
 * Whether the chosen output directory can be written to, and whether it already
 * holds anything (a previous build's artifacts get overwritten, which is worth
 * a heads-up but not a block). A directory that does not exist yet is fine -
 * the packager creates it - as long as its nearest existing parent is writable.
 */
export async function checkOutputDir(outputDir: string): Promise<OutputDirCheck> {
    try {
        const entries = await fs.readdir(outputDir);
        await fs.access(outputDir, fsConstants.W_OK);
        return entries.length > 0 ? "not-empty" : "ok";
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            return "not-writable";
        }
    }
    // Does not exist yet: the deepest existing ancestor must be writable.
    let candidate = path.dirname(path.resolve(outputDir));
    for (;;) {
        try {
            await fs.access(candidate, fsConstants.W_OK);
            return "ok";
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
                return "not-writable";
            }
        }
        const parent = path.dirname(candidate);
        if (parent === candidate) {
            return "not-writable";
        }
        candidate = parent;
    }
}
