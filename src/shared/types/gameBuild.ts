import { sanitizeProjectFileName } from "@shared/utils/nlproj";

/**
 * Production game build pipeline types shared between the main process,
 * preload bridge and workspace renderer.
 */

/** Platforms a project can be packaged for. */
export type GameBuildPlatform = "windows" | "macos" | "linux" | "web";

/**
 * Desktop platforms package an Electron shell through electron-builder; the
 * "web" platform emits a static site instead and never touches the packager.
 */
export type GameBuildDesktopPlatform = Exclude<GameBuildPlatform, "web">;

/**
 * Distribution formats. "dir" is the unpacked folder (fast local check; for
 * web it is the deployable site folder), "zip" a portable archive; the rest
 * are per-platform installers.
 */
export type GameBuildFormat = "dir" | "zip" | "nsis" | "dmg" | "appimage";

/** CPU architecture a desktop target is packaged for. "universal" is macOS-only. */
export type GameBuildArch = "x64" | "arm64" | "universal";

/**
 * How hard the packager compresses the payload. "store" trades artifact size
 * for a much faster build — the point of a throwaway local check.
 */
export type GameBuildCompression = "store" | "normal" | "maximum";

/**
 * One packaging job: a platform, the formats to emit, and (desktop only) the
 * single arch to emit them for.
 *
 * `arch` is deliberately ONE value rather than a list. electron-builder folds a
 * multi-arch NSIS request into a single installer and drops the `${arch}` macro
 * from the artifact name when it does (NsisTarget.buildInstaller passes
 * primaryArch = null unless exactly one arch was requested), which makes the
 * produced filenames unpredictable from the request alone and would break the
 * artifact preview. One arch per platform keeps that mapping total, and macOS
 * "universal" already covers the both-arches case.
 */
export type GameBuildTarget = {
    platform: GameBuildPlatform;
    formats: GameBuildFormat[];
    /** Ignored when `platform` is "web": a static site has no CPU arch. */
    arch?: GameBuildArch;
};

export type GameBuildRequest = {
    targets: GameBuildTarget[];
    /**
     * Absolute output directory for finished artifacts (chosen via the native
     * folder picker). When absent, defaults to "<project>/dist".
     */
    outputDir?: string;
    /** Payload compression; defaults to "maximum" (electron-builder's own default). */
    compression?: GameBuildCompression;
    /** Reveal the output folder when the build finishes. Defaults to true. */
    openWhenDone?: boolean;
};

/** Which build-dialog section a preflight finding belongs to. */
export type BuildPreflightSection = "targets" | "identity" | "content" | "output";

/**
 * "error" blocks the build (the pipeline would throw); "warning" ships but
 * degrades something (a default icon, a derived app id).
 */
export type BuildPreflightSeverity = "error" | "warning";

export type BuildPreflightCode =
    | "no-targets"
    | "unbuildable-platform"
    | "version-invalid"
    | "version-missing"
    | "identifier-missing"
    | "icon-missing"
    | "icon-unusable"
    | "plugins-invalid"
    | "encryption-key-unavailable"
    | "web-unprotected"
    | "unsigned"
    | "cross-build-download"
    | "output-not-writable"
    | "output-not-empty";

/**
 * One thing the build would complain about, found before the user commits.
 * Carries a code plus interpolation values rather than a message: the console
 * renders English, the dialog renders the user's language from the same finding.
 */
export type BuildPreflightFinding = {
    code: BuildPreflightCode;
    severity: BuildPreflightSeverity;
    section: BuildPreflightSection;
    /** Values the message interpolates (platform name, bad version, …). */
    detail?: Record<string, string>;
};

export type GameBuildStatus =
    | "idle"
    | "preparing"
    | "compiling"
    | "packaging"
    | "done"
    | "error";

/** Snapshot returned by build.getStatus; the renderer polls this. */
export type GameBuildStateSnapshot = {
    status: GameBuildStatus;
    startedAt?: number;
    finishedAt?: number;
    /** Absolute paths of produced artifacts (installers/archives/app dirs). */
    artifacts?: string[];
    /** Absolute output directory of the finished build. */
    outputDir?: string;
    error?: string;
};

export const GAME_BUILD_FORMATS_BY_PLATFORM: Record<GameBuildPlatform, GameBuildFormat[]> = {
    windows: ["zip", "nsis", "dir"],
    macos: ["zip", "dmg", "dir"],
    linux: ["zip", "appimage", "dir"],
    web: ["zip", "dir"],
};

/** Reverse-domain identifiers usable as a bundle/app id verbatim. */
const APP_ID_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/**
 * Derive the packager app id from the project identifier. An identifier that is
 * already reverse-domain is used as-is; anything else (including a bare name
 * like "demo") is sanitized under the NarraLeaf namespace.
 *
 * Shared rather than mirrored: the build dialog shows the user which app id
 * their game will ship with, and a second implementation would quietly disagree
 * with the one that actually packages.
 */
export function deriveGameAppId(identifier: string | undefined, projectName: string): string {
    const trimmed = identifier?.trim();
    if (trimmed && APP_ID_PATTERN.test(trimmed)) {
        return trimmed;
    }
    const sanitized = sanitizeProjectFileName(trimmed || projectName)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "game";
    return `com.narraleaf.games.${sanitized}`;
}

/** Archs offered per desktop platform, in display order. */
export const GAME_BUILD_ARCHS_BY_PLATFORM: Record<GameBuildDesktopPlatform, GameBuildArch[]> = {
    windows: ["x64", "arm64"],
    macos: ["arm64", "x64", "universal"],
    linux: ["x64", "arm64"],
};

/**
 * The arch a target starts on: the host's own arch when packaging for the host
 * platform, x64 (the broadest player base) for a cross build. Mirrors what the
 * pipeline hardcoded before arch became selectable.
 */
export function defaultGameBuildArch(
    platform: GameBuildDesktopPlatform,
    hostPlatform: GameBuildDesktopPlatform,
    hostArch: string,
): GameBuildArch {
    if (platform !== hostPlatform) {
        return "x64";
    }
    return hostArch === "arm64" ? "arm64" : "x64";
}

/** Keep only archs the platform actually offers, falling back to its first. */
export function normalizeGameBuildArch(platform: GameBuildDesktopPlatform, arch: unknown): GameBuildArch {
    const allowed = GAME_BUILD_ARCHS_BY_PLATFORM[platform];
    return allowed.find(candidate => candidate === arch) ?? allowed[0];
}

/**
 * electron-builder's `${os}` macro — Platform.buildConfigurationKey. Note
 * Windows is "win", not "windows".
 */
const BUILDER_OS_TOKEN: Record<GameBuildDesktopPlatform, string> = {
    windows: "win",
    macos: "mac",
    linux: "linux",
};

/** electron-builder's `${ext}` macro, per installer/archive format. */
const BUILDER_EXT_TOKEN: Record<Exclude<GameBuildFormat, "dir">, string> = {
    zip: "zip",
    nsis: "exe",
    dmg: "dmg",
    appimage: "AppImage",
};

/**
 * The artifactName pattern handed to electron-builder. Lives here (rather than
 * inline in the packaging worker) because the build dialog predicts filenames
 * from the same rules: two copies would drift the moment either side changed.
 */
export function gameBuildArtifactNamePattern(artifactBaseName: string): string {
    return `${artifactBaseName}-\${version}-\${os}-\${arch}.\${ext}`;
}

/** Folder the web export's "dir" format is written to, under the output dir. */
export function webExportDirName(artifactBaseName: string, version: string): string {
    return `${artifactBaseName}-${version}-web`;
}

/** File the web export's "zip" format is written to, under the output dir. */
export function webExportZipName(artifactBaseName: string, version: string): string {
    return `${webExportDirName(artifactBaseName, version)}.zip`;
}

/**
 * electron-builder's `${arch}` macro — builder-util's getArtifactArchName.
 * AppImage (and rpm/flatpak) rename x64 to "x86_64"; everything else uses the
 * arch verbatim. Getting this wrong prints a filename the build never produces,
 * which is the one thing the artifact preview must not do.
 */
function artifactArchToken(arch: GameBuildArch, extToken: string): string {
    if (arch === "x64" && extToken === "AppImage") {
        return "x86_64";
    }
    return arch;
}

/**
 * Folder name a "dir" (unpacked) target produces — PlatformPackager.computeAppOutDir:
 * `<os><archSuffix>` for macOS, `<os><archSuffix>-unpacked` elsewhere, where the
 * arch suffix is empty for the default arch (x64).
 */
function unpackedDirName(platform: GameBuildDesktopPlatform, arch: GameBuildArch): string {
    const archSuffix = arch === "x64" ? "" : `-${arch}`;
    return `${BUILDER_OS_TOKEN[platform]}${archSuffix}${platform === "macos" ? "" : "-unpacked"}`;
}

export type PredictedGameBuildArtifact = {
    /** Name as it will appear directly under the output directory. */
    name: string;
    kind: "file" | "folder";
    platform: GameBuildPlatform;
    format: GameBuildFormat;
};

/**
 * The artifacts a request will produce, named exactly as the build will write
 * them. Desktop names replay electron-builder's macro expansion over
 * `gameBuildArtifactNamePattern`; the web export is named by GameBuildManager
 * from the same helpers used here.
 */
export function predictGameBuildArtifacts(input: {
    artifactBaseName: string;
    version: string;
    targets: GameBuildTarget[];
}): PredictedGameBuildArtifact[] {
    const { artifactBaseName, version, targets } = input;
    const predicted: PredictedGameBuildArtifact[] = [];
    for (const target of targets) {
        if (target.platform === "web") {
            for (const format of target.formats) {
                if (format === "dir") {
                    predicted.push({
                        name: webExportDirName(artifactBaseName, version),
                        kind: "folder",
                        platform: "web",
                        format,
                    });
                } else if (format === "zip") {
                    predicted.push({
                        name: webExportZipName(artifactBaseName, version),
                        kind: "file",
                        platform: "web",
                        format,
                    });
                }
            }
            continue;
        }
        const platform = target.platform as GameBuildDesktopPlatform;
        const arch = normalizeGameBuildArch(platform, target.arch);
        for (const format of target.formats) {
            if (format === "dir") {
                predicted.push({
                    name: unpackedDirName(platform, arch),
                    kind: "folder",
                    platform,
                    format,
                });
                continue;
            }
            const extToken = BUILDER_EXT_TOKEN[format];
            predicted.push({
                name: `${artifactBaseName}-${version}-${BUILDER_OS_TOKEN[platform]}-${artifactArchToken(arch, extToken)}.${extToken}`,
                kind: "file",
                platform,
                format,
            });
        }
    }
    return predicted;
}

/** The platform value describing the machine Studio itself runs on. */
export function currentGameBuildPlatform(): GameBuildDesktopPlatform {
    return platformFromSystem(process.platform);
}

/** Map a Node `process.platform` string to a build platform. */
export function platformFromSystem(system: string): GameBuildDesktopPlatform {
    if (system === "darwin") {
        return "macos";
    }
    if (system === "win32") {
        return "windows";
    }
    return "linux";
}

/**
 * Whether `host` can package for `target`. macOS targets need Apple tooling
 * (mac host only); Linux packaging (AppImage) needs a Unix host; Windows
 * targets build from any host. Mirrors electron-builder's cross-build support
 * for unsigned artifacts. The web target is plain file copying/zipping and
 * builds everywhere.
 */
export function hostCanBuildTarget(host: GameBuildPlatform, target: GameBuildPlatform): boolean {
    if (target === "web") {
        return true;
    }
    if (target === "macos") {
        return host === "macos";
    }
    if (target === "linux") {
        return host !== "windows";
    }
    return true;
}
