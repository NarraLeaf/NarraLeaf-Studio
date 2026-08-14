import { sanitizeProjectFileName } from "@shared/utils/nlproj";

/**
 * Production game build pipeline types shared between the main process,
 * preload bridge and workspace renderer.
 */

/** Platforms a project can be packaged for. */
export type GameBuildPlatform = "windows" | "macos" | "linux" | "web" | "android" | "ios";

/**
 * Mobile platforms repack a prebuilt WebView shell template (pure TS, offline);
 * like "web" they never touch electron-builder and have no CPU arch.
 */
export type GameBuildMobilePlatform = "android" | "ios";

/**
 * Desktop platforms package an Electron shell through electron-builder; the
 * "web" platform emits a static site and the mobile platforms repack a shell
 * template - neither touches the packager.
 */
export type GameBuildDesktopPlatform = Exclude<GameBuildPlatform, "web" | GameBuildMobilePlatform>;

/**
 * Distribution formats. "dir" is the unpacked folder (fast local check; for
 * web it is the deployable site folder), "zip" a portable archive,
 * "apk"/"aab"/"ipa" the mobile packages; the rest are per-platform installers.
 */
export type GameBuildFormat = "dir" | "zip" | "nsis" | "dmg" | "appimage" | "apk" | "aab" | "ipa";

/**
 * The packages a mobile platform emits. Android has two, and they are formats
 * of the one platform rather than platforms of their own: the APK installs on a
 * device (sideloading, and the stores that take APKs), the AAB is the upload
 * Google Play accepts. Both come out of the same repack, off the same payload
 * and the same signing credential - only the container and the signature scheme
 * differ.
 */
export type GameBuildMobileFormat = "apk" | "aab" | "ipa";

/** CPU architecture a desktop target is packaged for. "universal" is macOS-only. */
export type GameBuildArch = "x64" | "arm64" | "universal";

/**
 * How hard the packager compresses the payload. "store" trades artifact size
 * for a much faster build - the point of a throwaway local check.
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
    /**
     * Ignored for "web" and the mobile platforms: a static site has no CPU
     * arch, and the WebView shell templates are ABI-independent.
     */
    arch?: GameBuildArch;
};

export type GameBuildRequest = {
    targets: GameBuildTarget[];
    /**
     * Which build variant this build is. Absent, or the release id, means the project's own values.
     *
     * A variant states its own application name, identifier and version and inherits the rest, so
     * this is what decides the identity the artifacts carry. An id naming a variant the project does
     * not have is refused rather than fallen back on: falling back would ship the release identity
     * under the name of a variant the author selected, which is the one way this can be wrong
     * without anyone noticing.
     */
    appTagId?: string;
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

/**
 * Which build-dialog section a preflight finding belongs to.
 *
 * `plugins` is the one section whose page is not always on screen: it exists only where an installed
 * plugin declares a value for the platforms being built. That is safe because a finding in it can
 * only come from a declared field, which is the same fact that puts the page there.
 */
export type BuildPreflightSection = "targets" | "identity" | "content" | "plugins" | "signing" | "output";

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
    /**
     * The project's build variants are on disk but could not be read, so nothing here knows which
     * identity this build would carry. The build itself refuses the same file, so this is an error
     * rather than a note about a degraded reading.
     */
    | "variants-unreadable"
    | "icon-missing"
    | "icon-unusable"
    | "icon-low-resolution"
    | "icon-stale"
    | "plugins-invalid"
    /**
     * A plugin declared a value the build cannot ship without, and the variant being built has none.
     * Reported once per value asked for, so a field taking one value per platform names the platform
     * it is missing for.
     */
    | "plugin-config-missing"
    /**
     * A plugin secret the project names by handle whose value is not sealed on this machine. The
     * ordinary state of a project a collaborator configured - key material never travels with a
     * project - rather than a damaged one.
     */
    | "plugin-secret-unavailable"
    /**
     * A `/cut` row naming the variant being built that would take nothing with it - the last row of
     * its scene, or one below an unconditional jump. It reads on the page as an ending and produces
     * a package identical to the one without it, so the author believes their demo stops there while
     * every line of the book ships.
     */
    | "cut-point-inert"
    /**
     * The variant shortens the story and nobody has said what the player sees when it ends. The
     * story simply runs out of rows and the last frame stays on screen, which is what an author
     * discovers by playing the build to the end. Picking "show nothing" on the variant answers it.
     */
    | "variant-ending-missing"
    /**
     * The story parts into routes and only some of them end for this variant. Not a mistake by
     * itself - a demo may ship one route whole on purpose - so it ships, and says so.
     */
    | "variant-branch-uncut"
    | "build-dependency-unavailable"
    | "sidecar-target-missing"
    | "sidecar-crossbuild-exec-bit"
    | "encryption-key-unavailable"
    | "web-unprotected"
    /**
     * The project carries progress between editions, and this target's shell cannot: a page has no
     * shared file to write, and the mobile shells serve that same page.
     */
    | "progress-carry-unsupported"
    | "web-lossy-images"
    | "mobile-template-missing"
    | "mobile-payload-too-large"
    | "version-uncodable"
    | "appid-android-adjusted"
    | "bundleid-ios-adjusted"
    // Reported only for a platform the project has NOT pointed at a signing
    // credential: once one is configured, the specific signing-* codes below
    // carry whatever is wrong with it instead.
    | "unsigned"
    | "unsigned-android"
    | "unsigned-ios"
    // The project names a credential this machine does not hold - the expected
    // shape when a version-controlled project is opened somewhere else, since
    // the key material never travels with it.
    | "signing-credential-missing"
    | "signing-credential-expired"
    | "signing-credential-expiring"
    /** The password is on disk but cannot be unsealed here (keyring gone, or another OS account). */
    | "signing-secret-unavailable"
    /** Configured, but the host lacks the program that does the signing (gpg, the Azure module). */
    | "signing-tool-missing"
    /** The host cannot drive this credential at all - e.g. the Windows certificate store off Windows. */
    | "signing-host-unsupported"
    /** Signing reaches the network (timestamping, cloud signing, fetching signtool). */
    | "signing-needs-network"
    /**
     * The Android target is producing only an APK, which Google Play does not
     * accept. Reported against a configured release keystore, because that is
     * the point at which an author means to publish; selecting the AAB format
     * alongside answers it.
     */
    | "signing-android-not-play"
    | "signing-ios-profile-mismatch"
    /** The keychain identity the macOS credential names is not on this machine. */
    | "signing-macos-identity-missing"
    /**
     * The identity is in the keychain but `security` will not offer it: expired,
     * missing its private key, or not chaining to a trusted root. A distinct
     * code from "missing" because the author has to fix the certificate they
     * have rather than go looking for one they do not.
     */
    | "signing-macos-identity-unusable"
    /**
     * The macOS identity is not a `Developer ID Application` one, so Gatekeeper
     * will reject the result on a player's machine and Apple will refuse to
     * notarize it.
     */
    | "signing-macos-not-developer-id"
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

/**
 * What one produced artifact came to on disk.
 *
 * `bytes` is optional because measuring is best-effort: an artifact whose size cannot be read is
 * still reported, without a number. That is deliberately a different fact from `0` - an artifact
 * shown as "0 B" reads as an empty build output, and the whole point of this measurement is that a
 * wrong size is worse than no size.
 */
export type GameBuildArtifactSize = {
    /** Absolute path; matches the entry of `artifacts` this size belongs to. */
    path: string;
    /**
     * Total bytes. For an artifact that is a directory (the web export, a macOS `.app`) this is the
     * sum of the whole tree, not what `stat` reports for the directory entry itself.
     */
    bytes?: number;
};

/**
 * Bytes over the artifacts whose size could be read. Unmeasured artifacts contribute nothing rather
 * than zero, so the total never claims to cover something it could not see; pair it with the count
 * of measured artifacts when showing it.
 */
export function totalGameBuildArtifactBytes(sizes: GameBuildArtifactSize[]): number {
    return sizes.reduce((total, size) => total + (size.bytes ?? 0), 0);
}

/** Snapshot returned by build.getStatus; the renderer polls this. */
export type GameBuildStateSnapshot = {
    status: GameBuildStatus;
    startedAt?: number;
    finishedAt?: number;
    /**
     * Platforms this build was asked to produce, deduplicated in request order. Carried on the
     * snapshot rather than left to the caller because the renderer only ever sees the snapshot -
     * the dashboard archives finished builds off this poll and has no other route to the request.
     *
     * Absent on the idle snapshot, which describes no build.
     */
    platforms?: GameBuildPlatform[];
    /** Absolute paths of produced artifacts (installers/archives/app dirs). */
    artifacts?: string[];
    /**
     * What each of those artifacts came to on disk, in `artifacts` order.
     *
     * Carried on the snapshot rather than left in the console line that prints it, because the
     * console line is not the only place an author meets a finished build - anything polling the
     * status can show what was shipped without walking the output folder a second time.
     *
     * Absent on any snapshot that is not a finished build, and an individual entry may carry no
     * size (see {@link GameBuildArtifactSize}).
     */
    artifactSizes?: GameBuildArtifactSize[];
    /** Absolute output directory of the finished build. */
    outputDir?: string;
    error?: string;
};

export const GAME_BUILD_FORMATS_BY_PLATFORM: Record<GameBuildPlatform, GameBuildFormat[]> = {
    windows: ["zip", "nsis", "dir"],
    macos: ["zip", "dmg", "dir"],
    linux: ["zip", "appimage", "dir"],
    web: ["zip", "dir"],
    android: ["apk", "aab"],
    ios: ["ipa"],
};

/**
 * Explicit membership tests instead of `platform !== "web"`: these are type
 * predicates, whose bodies TypeScript never checks - when the platform union
 * grew, every "not web means desktop" site silently misrouted mobile targets
 * into the electron-builder path. Keeping the one exhaustive answer here.
 */
export function isDesktopBuildPlatform(platform: GameBuildPlatform): platform is GameBuildDesktopPlatform {
    return platform === "windows" || platform === "macos" || platform === "linux";
}

export function isMobileBuildPlatform(platform: GameBuildPlatform): platform is GameBuildMobilePlatform {
    return platform === "android" || platform === "ios";
}

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

/**
 * Archs offered per desktop platform, in display order.
 *
 * **This is where the author's game runs, not where Studio runs. Do not "tidy" the two into
 * agreement.**
 *
 * Studio itself is no longer shipped for Intel Macs: three of its subsystems have no darwin-x64
 * implementation and two of them are upstream gaps we cannot close (@lore-vcs publishes only
 * `sdk-arm64-apple-darwin`, so version control - a core feature - is simply missing; zsign publishes
 * no macOS x64 asset, so iOS signing is missing; our LGPL FFmpeg is compiled host-arch-only, so
 * media conversion is missing). See .github/workflows/release.yml.
 *
 * None of that touches this table. A game packaged on Apple Silicon still ships for Intel Macs, and
 * must keep doing so - that is a large installed base of *players*, who are not running Studio.
 * Nothing in the pipeline needs an Intel Mac to produce it either: @narraleaf/encryption vendors a
 * prebuilt `darwin-x64` bindings.node, and Electron's own x64 runtime is downloaded by
 * electron-builder. `macos: [..., "x64", ...]` is therefore load-bearing, and gameBuild.test.ts
 * asserts it stays.
 */
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
 * electron-builder's `${os}` macro - Platform.buildConfigurationKey. Note
 * Windows is "win", not "windows".
 */
const BUILDER_OS_TOKEN: Record<GameBuildDesktopPlatform, string> = {
    windows: "win",
    macos: "mac",
    linux: "linux",
};

/**
 * electron-builder's `${ext}` macro, per installer/archive format. The mobile
 * formats never reach the desktop naming path (they are named by
 * `mobileExportFileName`); they are listed to keep the map total.
 */
const BUILDER_EXT_TOKEN: Record<Exclude<GameBuildFormat, "dir">, string> = {
    zip: "zip",
    nsis: "exe",
    dmg: "dmg",
    appimage: "AppImage",
    apk: "apk",
    aab: "aab",
    ipa: "ipa",
};

/**
 * What every artifact of a build is named from.
 *
 * Derived from the project's own name and the variant's name, deliberately not from a variant's
 * overridden `displayName`: the file names a project and an edition of it, while `displayName` names
 * the application a player installs. Two variants that rename the application to the same thing
 * still write different files, and - the reason this exists - a variant that overrides nothing no
 * longer writes byte-identical file names to the release build, which silently overwrote it when
 * both were built into one output folder.
 *
 * `null` is the release variant, whose artifacts are named from the project alone. Its names are
 * therefore exactly what they were before variants existed.
 */
export function gameBuildArtifactBaseName(projectName: string, variantName: string | null): string {
    const base = sanitizeProjectFileName(projectName);
    return variantName === null ? base : `${base}-${sanitizeProjectFileName(variantName)}`;
}

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
 * File a mobile package is written to, under the output dir. Same naming family
 * as the web export: no arch token (the shells are ABI-independent), the
 * platform spelled out. Lives here for the same reason as the helpers above:
 * the build dialog predicts the exact name the repack worker writes, and two
 * copies would drift.
 *
 * The format is a parameter rather than derived from the platform: Android
 * emits two packages that differ only in their container, so the one name has
 * to be able to end in either.
 */
export function mobileExportFileName(
    platform: GameBuildMobilePlatform,
    format: GameBuildMobileFormat,
    artifactBaseName: string,
    version: string,
): string {
    return `${artifactBaseName}-${version}-${platform}.${format}`;
}

/**
 * The package a mobile platform emits for a requested format, or null when it
 * offers no such package. The dialog only sends what it offers, but a stored
 * selection carried across Studio versions - or any non-UI caller - can name
 * anything.
 *
 * GAME_BUILD_FORMATS_BY_PLATFORM stays the one offer list; the check after it is
 * what makes the answer a mobile package at the type level, written out rather
 * than asserted through a type predicate (whose body TypeScript never checks).
 */
function mobilePackageFormat(
    platform: GameBuildMobilePlatform,
    format: GameBuildFormat,
): GameBuildMobileFormat | null {
    if (!GAME_BUILD_FORMATS_BY_PLATFORM[platform].includes(format)) {
        return null;
    }
    return format === "apk" || format === "aab" || format === "ipa" ? format : null;
}

/**
 * Android versionCode derived from the project's semver: major*1e6 +
 * minor*1e3 + patch, so successive releases stay monotonic. The pre-release
 * suffix is ignored - "1.2.0-beta.3" shares 1.2.0's code, which sideloading
 * accepts (same code + same signature installs as an update); strict
 * "pre-release < release" ordering is a Play-upload concern for the future
 * signing batch. The major cap is Google Play's 2_100_000_000 ceiling, adopted
 * deliberately ahead of the store batch (the OS itself accepts Int32.max).
 * Returns null when the version cannot be encoded; preflight reports that as
 * an error rather than silently truncating and breaking monotonicity.
 */
export function deriveAndroidVersionCode(version: string): number | null {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
    if (!match) {
        return null;
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (major > 2099 || minor > 999 || patch > 999) {
        return null;
    }
    // 0.0.0 (the no-version fallback) still needs a valid code; installers
    // reject versionCode 0.
    return Math.max(1, major * 1_000_000 + minor * 1_000 + patch);
}

/**
 * CFBundleShortVersionString / CFBundleVersion from the project's semver. iOS
 * accepts only dot-separated integers, so the pre-release and build-metadata
 * suffixes semver allows ("1.2.0-beta.3") are stripped. Both keys take this one
 * value: they mean different things to the App Store (marketing version vs.
 * build number), but that distinction only exists once uploads do - and two
 * different-looking versions on a sideloaded build would be a lie about which
 * one shipped. The store batch gives CFBundleVersion its own meaning.
 */
export function deriveIosBundleVersion(version: string): string {
    const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
    // Callers validate the version first (isValidProjectVersion), so the
    // fallback only guards non-UI callers passing something unparseable.
    return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : "0.0.0";
}

/**
 * Make an app id usable as an Android package name, which is stricter than
 * reverse-domain: every segment must start with a letter and may contain only
 * letters, digits and underscores (hyphens are invalid anywhere). Hyphens and
 * other invalid characters become underscores; a segment not starting with a
 * letter gets an "n" prefix. Callers compare input and output to warn the
 * author when the shipped package name differs from the displayed app id.
 */
export function normalizeAndroidPackageName(appId: string): string {
    const segments = appId.split(".").map(segment => {
        const cleaned = segment.replace(/[^A-Za-z0-9_]/g, "_");
        return /^[A-Za-z]/.test(cleaned) ? cleaned : `n${cleaned}`;
    });
    // deriveGameAppId always emits at least two segments; guard non-UI callers.
    return segments.length >= 2 ? segments.join(".") : `com.narraleaf.games.${segments[0]}`;
}

/**
 * Make an app id usable as an iOS bundle identifier: alphanumerics, hyphens
 * and periods only. Apple rejects underscores - the mirror image of Android's
 * rule, which is why the two normalizations are separate functions.
 */
export function normalizeIosBundleId(appId: string): string {
    return appId
        .split(".")
        .map(segment => segment.replace(/[^A-Za-z0-9-]/g, "-") || "app")
        .join(".");
}

/**
 * electron-builder's `${arch}` macro - builder-util's getArtifactArchName.
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
 * Folder name a "dir" (unpacked) target produces - PlatformPackager.computeAppOutDir:
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
        const { platform } = target;
        if (platform === "web") {
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
        if (platform === "android" || platform === "ios") {
            // One artifact per selected format, not one per platform: an Android
            // target asked for both packages writes both, off the same repack.
            for (const format of target.formats) {
                const packageFormat = mobilePackageFormat(platform, format);
                if (!packageFormat) {
                    continue;
                }
                predicted.push({
                    name: mobileExportFileName(platform, packageFormat, artifactBaseName, version),
                    kind: "file",
                    platform,
                    format,
                });
            }
            continue;
        }
        // The narrowing above (not web, not mobile) is what makes `platform`
        // desktop here - no cast, so the next platform addition fails to
        // compile instead of falling into the desktop path at runtime (the
        // old cast let non-desktop platforms through, crashing in the arch
        // lookup below before any name was produced).
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
 * for unsigned artifacts. The web target is plain file copying/zipping and the
 * mobile targets are pure-TS repacks of prebuilt shell templates - both build
 * everywhere, by design rather than by fall-through: the switch is exhaustive
 * so the next platform addition must state its answer explicitly.
 */
export function hostCanBuildTarget(host: GameBuildPlatform, target: GameBuildPlatform): boolean {
    switch (target) {
        case "web":
        case "android":
        case "ios":
        case "windows":
            return true;
        case "macos":
            return host === "macos";
        case "linux":
            return host !== "windows";
    }
}
