import fsPromises from "fs/promises";
import path from "path";
import { build, Platform, Arch, type AfterPackContext, type Configuration } from "electron-builder";
import { perTargetFileSets } from "./perTargetPayload";
import { installLinuxLauncher, LINUX_PROGRAM_SUFFIX } from "./linuxLauncher";
import {
    currentGameBuildPlatform,
    desktopArtifactFileName,
    gameBuildArtifactNamePattern,
    hostPackagesWithoutPlatformTools,
    type GameBuildArch,
    type GameBuildDesktopPlatform,
    type GameBuildFormat,
} from "@shared/types/gameBuild";
import { writeArtifactDigests } from "./artifactDigests";
import { tidyElectronStage } from "./electronRuntimeFiles";
import {
    describeMacSigning,
    describeWindowsSigning,
    isMacSigning,
    macSigningConfiguration,
    notarizationForTargets,
    signtoolPathForTargets,
    windowsSigningConfiguration,
    withNotarizationEnv,
    withSigntoolPath,
} from "./desktopSigning";
import { packWithoutPlatformTools } from "./crossHost/packWithoutPlatformTools";
import { signArtifactsWithGpg } from "./gpgSign";
import { runMobileRepack } from "./mobile/runMobileRepack";
import { packageWebSite } from "./packageWebSite";
import type { GameBuildWorkerConfig, GameBuildWorkerFuses, GameBuildWorkerTarget } from "./protocol";
import { ensureWinCodeSignCache, withBinariesMirrorEnv } from "./winCodeSignCache";
import { writeFolderZip } from "./desktopZip";
import { withoutUpdateBlockmaps } from "./updateBlockmaps";

/**
 * The electron-builder invocation behind a production game build. Pure with
 * respect to Studio state: everything arrives pre-resolved in the config, so
 * this runs identically inside the packaging utility process and under plain
 * node (tests, smoke scripts).
 */

export type GameBuildLogger = (level: "info" | "warning" | "error", message: string) => void;

const BUILDER_PLATFORMS: Record<GameBuildDesktopPlatform, Platform> = {
    windows: Platform.WINDOWS,
    macos: Platform.MAC,
    linux: Platform.LINUX,
};

const BUILDER_TARGET_NAMES: Record<GameBuildFormat, string> = {
    dir: "dir",
    zip: "zip",
    nsis: "nsis",
    dmg: "dmg",
    appimage: "AppImage",
    // The mobile formats never reach electron-builder (desktop worker targets
    // are typed GameBuildDesktopPlatform); listed to keep the map total.
    apk: "apk",
    aab: "aab",
    ipa: "ipa",
};

const BUILDER_ARCHS: Record<GameBuildArch, Arch> = {
    x64: Arch.x64,
    arm64: Arch.arm64,
    universal: Arch.universal,
};

/** The electron-builder configuration for one desktop target. Exported for its own test. */
export function builderConfiguration(
    config: GameBuildWorkerConfig,
    target: GameBuildWorkerTarget,
    log: GameBuildLogger,
): Configuration {
    const extraFiles = extraFilesFor(config, target.platform);
    return {
        // Each platform's options are gated on the target's own platform, not
        // just on the block being present: a stray block would otherwise put a
        // `win` section into a macOS configuration, which is exactly the kind of
        // thing that silently signs nothing.
        //
        // macOS is the asymmetric one - it gets a `mac` block whether or not it
        // is signed, because "unsigned" there has to be said out loud rather
        // than left to electron-builder's keychain search. See
        // macSigningConfiguration.
        ...windowsSigningFor(target),
        ...macSigningFor(target),
        appId: config.appId,
        productName: config.productName,
        electronVersion: config.electronVersion,
        ...(target.electronDist ? { electronDist: target.electronDist } : {}),
        // Runs once the Electron runtime is unpacked and before anything of the game's joins it,
        // whichever way the runtime arrived. A copied installation carries whatever its machine
        // left in it and a macOS one would lose its licences; see electronRuntimeFiles.ts.
        afterExtract: async context => {
            const { removedLitter } = await tidyElectronStage({
                appOutDir: context.appOutDir,
                platform: target.platform,
                ...(target.electronDist ? { sourceDist: target.electronDist } : {}),
            });
            if (removedLitter.length > 0) {
                log(
                    "info",
                    `left out of the ${target.platform} package: ${removedLitter.join(", ")} - found in the `
                    + "Electron runtime, but put there by this machine rather than shipped by Electron",
                );
            }
        },
        ...(target.iconPath ? { icon: target.iconPath } : {}),
        ...(config.copyright ? { copyright: config.copyright } : {}),
        // Beside Electron's own LICENSE.electron.txt and LICENSES.chromium.html: next to the
        // executable on Windows and Linux, `Contents/Resources/` on macOS. See extraFilesFor.
        ...(extraFiles.length > 0 ? { extraFiles } : {}),
        // Always the smallest artifact. The level used to be the author's to pick, and it
        // was noise: it changes nothing a player sees, it does nothing at all for the web
        // and mobile outputs, and the fast setting only pays off on a build nobody ships.
        // A zip gets 7-Zip's own highest level rather than electron-builder's reading of
        // "maximum" - see withArchiveCompressionLevel.
        compression: "maximum",
        // What "maximum" chooses for a disk image, said explicitly: the compression level
        // set by withArchiveCompressionLevel would otherwise switch a dmg from bzip2 to zlib.
        ...(target.platform === "macos" ? { dmg: { format: "UDBZ" as const } } : {}),
        ...(config.electronMirror
            ? { electronDownload: { mirror: config.electronMirror } }
            : {}),
        directories: {
            output: config.outputDir,
        },
        /*
         * Everything, except that the staging area is unpacked onto the app root
         * instead of being copied as itself. electron-builder is invoked once per
         * target and takes a file set per invocation, so the app dir can hold a
         * copy of the codec addon and koffi for each target being built and each
         * package still ends up with exactly its own. See perTargetPayload.ts for
         * why that is worth doing rather than building one target at a time.
         */
        files: perTargetFileSets(target.platformKey),
        // The languages the project offers, rather than the 55 Electron ships. See
        // electronLanguages.ts; the list always carries `en-US`, so this never empties
        // `locales/`, which would produce an app that does not start.
        electronLanguages: config.electronLanguages,
        asar: true,
        asarUnpack: config.asarUnpack,
        // Every platform but Linux leaves the fuses to electron-builder. Linux flips them itself in
        // `afterPack`, because by the time electron-builder would, the executable's name belongs to
        // the launcher script; see linuxPackagingFor.
        ...(target.platform === "linux"
            ? linuxPackagingFor(target, log)
            : { electronFuses: target.fuses }),
        artifactName: gameBuildArtifactNamePattern(config.artifactBaseName),
        /*
         * The game has no dependency tree. Everything it loads is staged into the app directory by
         * the compiler, deliberately outside `node_modules` (see buildAsarUnpackPatterns in
         * GameBuildManager), and its package.json declares no dependencies.
         *
         * Left to itself, electron-builder collects a tree anyway. It searches the app directory,
         * then the nearest workspace root above it - any folder with a package.json naming a
         * package manager or workspaces - and, because the game declares nothing to check a tree
         * against, accepts the first non-empty one it finds. The app directory is staged inside the
         * project, so a project kept anywhere beneath a JavaScript repository shipped that
         * repository's entire `node_modules`: hundreds of megabytes of somebody else's tooling in
         * the package, and on a signed build every executable in it signed with the author's
         * certificate.
         *
         * A `beforeBuild` that answers false is electron-builder's own way of saying the modules are
         * handled outside it, which skips the collection as well as the rebuild. `npmRebuild` has to
         * stay on for that question to be asked at all: `npmRebuild: false` returns before
         * `beforeBuild` runs, and leaves the collection in place.
         */
        npmRebuild: true,
        beforeBuild: async () => false,
        publish: null,
    };
}

/**
 * The notices shipped outside the asar, where a player can open them, in the folder that holds
 * Electron's own licence texts (put there by electron-builder on Windows and Linux, and by
 * tidyElectronStage on macOS).
 *
 * `to` is relative to the app's content root: the executable's folder on Windows and Linux,
 * `Contents/` inside the bundle on macOS. On macOS they go one level further, into `Resources/`: a
 * top-level file in `Contents/` counts as nested code to codesign, which signs it into extended
 * attributes that no zip carries, so the app a player unpacked would fail verification. See
 * `macLicenceDestination` in electronRuntimeFiles.ts.
 */
export function extraFilesFor(
    config: GameBuildWorkerConfig,
    platform: GameBuildDesktopPlatform,
): Array<{ from: string; to: string }> {
    const folder = platform === "macos" ? "Resources/" : "";
    return [
        ...(config.copyrightFile ? [{ from: config.copyrightFile, to: `${folder}COPYRIGHT.txt` }] : []),
        ...(config.thirdPartyNoticesFile
            ? [{ from: config.thirdPartyNoticesFile, to: `${folder}THIRD-PARTY-NOTICES.txt` }]
            : []),
    ];
}

/** The `win` block, when this target is a Windows one carrying Authenticode options. */
function windowsSigningFor(target: GameBuildWorkerTarget): Partial<Configuration> {
    const signing = target.signing;
    if (target.platform !== "windows" || !signing || isMacSigning(signing)) {
        return {};
    }
    return windowsSigningConfiguration(signing);
}

/**
 * The `mac` block. Every macOS target gets one; an unsigned target gets the one that says so.
 *
 * What it deliberately never carries is `x64ArchFiles` or `singleArchFiles`, the two exemptions from
 * the universal merge. A universal target is packed once per architecture and joined by
 * `@electron/universal`, which refuses a Mach-O file that is the same thin image in both halves -
 * the one shape that cannot be right for both machines. Everything the compiler stages for a
 * universal target is either a universal image (see fatMachO.ts) or not machine code at all, and a
 * plugin's thin sidecar is refused before packing starts. So there is nothing to exempt, and an
 * exemption here would only hide the next binary that arrives in the wrong form.
 */
function macSigningFor(target: GameBuildWorkerTarget): Partial<Configuration> {
    if (target.platform !== "macos") {
        return {};
    }
    const signing = target.signing;
    return macSigningConfiguration(signing && isMacSigning(signing) ? signing : null);
}

/**
 * What a Linux target adds: the launcher in front of the Electron binary, and the AppImage runtime
 * that starts on a stock desktop.
 *
 * The launcher (see linuxLauncher.ts) is installed in `afterPack`, the last point at which the app
 * directory is complete and no artifact has been made from it yet, so the dir, the zip and the
 * AppImage all carry it. That is also before electron-builder flips the fuses - and it flips them on
 * whatever file has the executable's name, which by then would be the launcher script. So a Linux
 * target hands electron-builder no fuses at all and flips the same set itself, through the packager's
 * own `addElectronFuses`, on the binary while it still has that name; the launcher goes in after.
 *
 * The AppImage runtime is the static one. electron-builder's default (toolset 0.0.0) needs libfuse2,
 * which Ubuntu 24.04 no longer installs, so the AppImage stops with "AppImages require FUSE to run"
 * before anything of the game starts; the static runtime carries what it needs and mounts on a stock
 * system. electron-builder still labels this toolset beta. Its desktop entry also stops passing the
 * sandbox switch unconditionally, which the default one did - the launcher decides that now.
 */
function linuxPackagingFor(target: GameBuildWorkerTarget, log: GameBuildLogger): Partial<Configuration> {
    return {
        toolsets: { appimage: "1.0.3" },
        afterPack: async context => {
            const executableName = linuxExecutableName(context);
            await context.packager.addElectronFuses(context, electronFuseConfig(target.fuses));
            await installLinuxLauncher(context.appOutDir, executableName);
            log("info", `${executableName} is a launcher script; the Electron binary is ${executableName}${LINUX_PROGRAM_SUFFIX}`);
        },
    };
}

/** The Linux executable's name, as electron-builder settled it. */
function linuxExecutableName(context: AfterPackContext): string {
    const name = (context.packager as { executableName?: unknown }).executableName;
    if (typeof name !== "string" || name.length === 0) {
        throw new Error("electron-builder did not say what the Linux executable is called");
    }
    return name;
}

/** The fuse settings in the form `addElectronFuses` takes. */
type ElectronFuseConfig = Parameters<AfterPackContext["packager"]["addElectronFuses"]>[1];

/**
 * The fuse settings electron-builder would have flipped for `electronFuses: fuses`, in the form its
 * `addElectronFuses` takes - written out because the conversion it uses is private to it.
 *
 * The keys are positions in the fuse wire Electron compiles into its binary, a format that only ever
 * grows at the end, and `"1"` is that wire's version. Kept field for field with electron-builder's
 * conversion (a fuse left undefined is left as the binary has it), which the test checks against
 * electron-builder's own.
 */
export function electronFuseConfig(fuses: GameBuildWorkerFuses): ElectronFuseConfig {
    const positions: Array<[number, boolean | undefined]> = [
        [0, fuses.runAsNode],
        [1, fuses.enableCookieEncryption],
        [2, fuses.enableNodeOptionsEnvironmentVariable],
        [3, fuses.enableNodeCliInspectArguments],
        [4, fuses.enableEmbeddedAsarIntegrityValidation],
        [5, fuses.onlyLoadAppFromAsar],
        // 6 is the browser-process V8 snapshot, which the game's fuse set does not name.
        [7, fuses.grantFileProtocolExtraPrivileges],
    ];
    const config: Record<string, unknown> = {
        version: "1",
        resetAdHocDarwinSignature: fuses.resetAdHocDarwinSignature,
    };
    for (const [position, value] of positions) {
        if (value != null) {
            config[position] = value;
        }
    }
    return config as ElectronFuseConfig;
}

export async function runGameBuild(config: GameBuildWorkerConfig, log: GameBuildLogger): Promise<string[]> {
    const artifacts: string[] = [];
    // The web and mobile jobs first: both are orders of magnitude faster than
    // any electron-builder target, so their artifacts land even if a later
    // desktop target fails.
    if (config.web) {
        artifacts.push(...await packageWebSite(config.web, config.outputDir, log));
    }
    if (config.mobile) {
        artifacts.push(...await runMobileRepack(config.mobile, config.outputDir, log));
    }
    if (config.targets.length > 0) {
        artifacts.push(...await packageDesktopTargets(config, log));
    }
    return finishArtifacts(config, artifacts, log);
}

async function packageDesktopTargets(config: GameBuildWorkerConfig, log: GameBuildLogger): Promise<string[]> {
    const appDir = config.appDir;
    if (!appDir) {
        throw new Error("Desktop packaging requires a compiled app dir");
    }
    if (config.targets.some(target => target.platform === "windows")) {
        await ensureWinCodeSignCache(log, config.electronBuilderBinariesMirror);
    }
    const artifacts: string[] = [];
    // The wrappers below set process-wide environment, which electron-builder
    // reads at download and sign time. Set around the whole loop rather than per
    // target, so a mixed selection cannot flip any of them mid-build.
    //
    // SIGNTOOL_PATH is the only way to tell electron-builder which signtool to
    // use; unset when the host has no Windows SDK, in which case it downloads
    // its own bundle. The Apple variables are likewise @electron/notarize's only
    // interface - see withNotarizationEnv - and the binaries mirror variables are
    // the only way to move electron-builder's own toolset downloads (see
    // withBinariesMirrorEnv).
    const host = currentGameBuildPlatform();
    // electron-builder for one target, also run by Studio's own packager for the parts it can still
    // do on this host (see packWithoutPlatformTools).
    const runBuilder = async (runConfig: GameBuildWorkerConfig, target: GameBuildWorkerTarget): Promise<string[]> => {
        if (target.platform === "windows") {
            // Cached after the first call; a payload laid out as a Windows app needs it as much as an
            // installer does (rcedit lives in the same bundle).
            await ensureWinCodeSignCache(log, runConfig.electronBuilderBinariesMirror);
        }
        // A zip Studio writes itself is left out of what electron-builder is asked for; it still
        // lays the app out (a `dir` target, when nothing else is wanted) and the folder it leaves is
        // what goes into the zip once it has signed what it signs.
        const zipsItself = studioWritesZip(target);
        const builderFormats = zipsItself ? target.formats.filter(format => format !== "zip") : target.formats;
        const configuration = builderConfiguration(runConfig, target, log);
        // A holder rather than a plain local: it is set inside the hook, which the compiler cannot follow.
        const laidOut: { appOutDir: string | null } = { appOutDir: null };
        const ownAfterPack = configuration.afterPack;
        const produced = await build({
            // Exactly one arch per target: a multi-arch NSIS request would be
            // folded into a single installer whose name drops the ${arch} macro,
            // which the dialog's artifact preview could not have predicted.
            targets: BUILDER_PLATFORMS[target.platform].createTarget(
                (builderFormats.length > 0 ? builderFormats : ["dir" as const]).map(format => BUILDER_TARGET_NAMES[format]),
                BUILDER_ARCHS[target.arch],
            ),
            projectDir: appDir,
            config: zipsItself
                ? {
                    ...configuration,
                    afterPack: async context => {
                        laidOut.appOutDir = context.appOutDir;
                        if (typeof ownAfterPack === "function") {
                            await ownAfterPack(context);
                        }
                    },
                }
                : configuration,
        });
        const artifacts = produced.map(artifact => path.resolve(artifact));
        if (zipsItself) {
            if (!laidOut.appOutDir) {
                throw new Error(`electron-builder laid out no ${target.platform} app to zip`);
            }
            artifacts.push(await writeAppZip(runConfig, target, laidOut.appOutDir, log));
        }
        return artifacts;
    };
    await withBinariesMirrorEnv(config.electronBuilderBinariesMirror, () =>
        withNotarizationEnv(notarizationForTargets(config.targets), () =>
        withArchiveCompressionLevel(() =>
        withoutUpdateBlockmaps(() =>
        withSigntoolPath(signtoolPathForTargets(config.targets), async () => {
            for (const target of config.targets) {
                log("info", `packaging ${target.platform} (${target.formats.join(", ")})`);
                if (hostPackagesWithoutPlatformTools(host, target.platform)) {
                    artifacts.push(...await packWithoutPlatformTools({
                        config,
                        target,
                        runBuilder: async (runConfig, runTarget) => {
                            await runBuilder(runConfig, runTarget);
                        },
                        log,
                    }));
                    continue;
                }
                if (target.signing) {
                    log("info", isMacSigning(target.signing)
                        ? describeMacSigning(target.signing)
                        : describeWindowsSigning(target.signing));
                }
                artifacts.push(...await runBuilder(config, target));
            }
        })))));
    return artifacts;
}

/**
 * Whether this target's zip is written by Studio rather than by electron-builder.
 *
 * electron-builder hands a zip to 7-Zip, whose Deflate gives each file one thread, and a game's zip
 * is two very large files - minutes on one core. Studio's writer compresses every file in pieces on
 * all of them (see parallelZip), keeping the permission bits and the links a macOS bundle or a Linux
 * app needs (see desktopZip). Every desktop platform: a macOS or Linux zip made on a machine of its
 * own kind comes through here, and one made from Windows was always Studio's
 * (packWithoutPlatformTools), on the same writer.
 */
export function studioWritesZip(target: Pick<GameBuildWorkerTarget, "platform" | "formats">): boolean {
    return (target.platform === "windows" || target.platform === "macos" || target.platform === "linux")
        && target.formats.includes("zip");
}

/** The laid-out app in `appOutDir` as the zip electron-builder's zip target would have named. */
async function writeAppZip(
    config: GameBuildWorkerConfig,
    target: GameBuildWorkerTarget,
    appOutDir: string,
    log: GameBuildLogger,
): Promise<string> {
    const { version } = JSON.parse(await fsPromises.readFile(path.join(config.appDir as string, "package.json"), "utf8")) as {
        version: string;
    };
    const file = path.join(config.outputDir, desktopArtifactFileName({
        artifactBaseName: config.artifactBaseName,
        version,
        platform: target.platform,
        arch: target.arch,
        format: "zip",
    }));
    log("info", `writing the ${target.platform} zip, compressed on every core`);
    if (target.platform === "macos") {
        // The bundle itself is the archive's one folder, as electron-builder's zip has it: what a
        // player double-clicks is `Game.app`, not a loose `Contents/`.
        const bundle = await macAppBundle(appOutDir);
        await writeFolderZip(path.join(appOutDir, bundle), file, { topFolder: bundle });
    } else {
        await writeFolderZip(appOutDir, file);
    }
    return file;
}

/** The one `.app` electron-builder laid out in `appOutDir`. */
async function macAppBundle(appOutDir: string): Promise<string> {
    const bundles = (await fsPromises.readdir(appOutDir, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && entry.name.endsWith(".app"))
        .map(entry => entry.name);
    if (bundles.length !== 1) {
        throw new Error(`expected one app bundle in ${appOutDir}, found ${bundles.length}`);
    }
    return bundles[0];
}

/**
 * The level electron-builder's 7-Zip runs at, and the only way to set it.
 *
 * Left to `compression: "maximum"`, electron-builder adds `-mfb=258 -mpass=15` to every zip: fifteen
 * optimising passes over each file, one thread per file. A game's zip is dominated by two files - the
 * Electron executable, around 200 MB, and with asset protection on the sealed store, which is
 * encrypted and so cannot shrink at all - and 7-Zip's Deflate does not split one file across threads.
 * Measured on a real 500 MB project, those two passes held the zip for six and a half minutes on one
 * core, to make the executable 7 KB smaller than 7-Zip's own highest level does in a third of the
 * time, and to make the store not one byte smaller than it already was.
 *
 * No zip goes through 7-Zip any more (see studioWritesZip). The level stays set so that a zip that
 * ever did again - a format added later, a target that bypasses studioWritesZip - is not handed back
 * to fifteen passes.
 *
 * Level 9 is that highest level. It changes nothing else electron-builder writes: the installer's
 * payload and the other archive formats are at 9 already, and a dmg keeps the format "maximum"
 * gives it because {@link builderConfiguration} names that format rather than leaving it to be
 * inferred from this variable.
 */
export const ARCHIVE_COMPRESSION_LEVEL = "9";

export async function withArchiveCompressionLevel<T>(body: () => Promise<T>): Promise<T> {
    const previous = process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
    process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = ARCHIVE_COMPRESSION_LEVEL;
    try {
        return await body();
    } finally {
        if (previous === undefined) {
            delete process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL;
        } else {
            process.env.ELECTRON_BUILDER_COMPRESSION_LEVEL = previous;
        }
    }
}

/**
 * What every build gets once its artifacts exist: a `SHA256SUMS` covering all
 * of them, and - when the project points at a GPG credential - a detached
 * signature per artifact plus one over the sums file itself.
 *
 * Unconditional for the checksums, because they cost one pass over bytes that
 * were just written and are what turns "download this" into something a player
 * can verify. Signing is opt-in and fails the build if it fails at all: the
 * artifacts are already on disk, so the only thing left to get wrong would be
 * reporting success over a release directory that is quietly unsigned.
 */
async function finishArtifacts(
    config: GameBuildWorkerConfig,
    artifacts: string[],
    log: GameBuildLogger,
): Promise<string[]> {
    const digests = await writeArtifactDigests(artifacts, config.outputDir, log);
    const extra = digests.path ? [digests.path] : [];
    if (config.gpg) {
        // The sums file is signed alongside the artifacts, and is the signature
        // that actually matters: a checksum list nobody signed proves nothing.
        extra.push(...await signArtifactsWithGpg([...digests.files, ...extra], config.gpg, log));
    }
    return [...artifacts, ...extra];
}
