import path from "path";
import { build, Platform, Arch, type Configuration } from "electron-builder";
import {
    gameBuildArtifactNamePattern,
    type GameBuildArch,
    type GameBuildDesktopPlatform,
    type GameBuildFormat,
} from "@shared/types/gameBuild";
import { writeArtifactDigests } from "./artifactDigests";
import { describeWindowsSigning, signtoolPathForTargets, windowsSigningConfiguration, withSigntoolPath } from "./desktopSigning";
import { signArtifactsWithGpg } from "./gpgSign";
import { runMobileRepack } from "./mobile/runMobileRepack";
import { packageWebSite } from "./packageWebSite";
import type { GameBuildWorkerConfig, GameBuildWorkerTarget } from "./protocol";
import { ensureWinCodeSignCache } from "./winCodeSignCache";

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
    ipa: "ipa",
};

const BUILDER_ARCHS: Record<GameBuildArch, Arch> = {
    x64: Arch.x64,
    arm64: Arch.arm64,
    universal: Arch.universal,
};

function builderConfiguration(config: GameBuildWorkerConfig, target: GameBuildWorkerTarget): Configuration {
    return {
        // Authenticode options only ever reach a Windows target: `signing` is
        // typed for one, but a stray block on another platform would put a
        // `win` section into a macOS or Linux configuration, which is exactly
        // the kind of thing that silently signs nothing.
        ...(target.platform === "windows" && target.signing
            ? windowsSigningConfiguration(target.signing)
            : {}),
        appId: config.appId,
        productName: config.productName,
        electronVersion: config.electronVersion,
        ...(target.electronDist ? { electronDist: target.electronDist } : {}),
        ...(target.iconPath ? { icon: target.iconPath } : {}),
        ...(config.copyright ? { copyright: config.copyright } : {}),
        ...(config.compression ? { compression: config.compression } : {}),
        ...(config.electronMirror
            ? { electronDownload: { mirror: config.electronMirror } }
            : {}),
        directories: {
            output: config.outputDir,
        },
        files: ["**/*"],
        asar: true,
        asarUnpack: config.asarUnpack,
        electronFuses: target.fuses,
        artifactName: gameBuildArtifactNamePattern(config.artifactBaseName),
        npmRebuild: false,
        publish: null,
    };
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
        await ensureWinCodeSignCache(log);
    }
    const artifacts: string[] = [];
    // SIGNTOOL_PATH is the only way to tell electron-builder which signtool to
    // use, and it reads it at sign time; set around the whole loop rather than
    // per target so a mixed selection does not flip it mid-build. Unset when the
    // host has no Windows SDK - electron-builder then downloads its own bundle.
    await withSigntoolPath(signtoolPathForTargets(config.targets), async () => {
        for (const target of config.targets) {
            const platform = BUILDER_PLATFORMS[target.platform];
            const targetNames = target.formats.map(format => BUILDER_TARGET_NAMES[format]);
            log("info", `packaging ${target.platform} (${target.formats.join(", ")})`);
            if (target.platform === "windows" && target.signing) {
                log("info", describeWindowsSigning(target.signing));
            }
            const produced = await build({
                // Exactly one arch per target: a multi-arch NSIS request would be
                // folded into a single installer whose name drops the ${arch} macro,
                // which the dialog's artifact preview could not have predicted.
                targets: platform.createTarget(targetNames, BUILDER_ARCHS[target.arch]),
                projectDir: appDir,
                config: builderConfiguration(config, target),
            });
            artifacts.push(...produced.map(artifact => path.resolve(artifact)));
        }
    });
    return artifacts;
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
