import path from "path";
import { build, Platform, Arch, type Configuration } from "electron-builder";
import {
    gameBuildArtifactNamePattern,
    type GameBuildArch,
    type GameBuildDesktopPlatform,
    type GameBuildFormat,
} from "@shared/types/gameBuild";
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
};

const BUILDER_ARCHS: Record<GameBuildArch, Arch> = {
    x64: Arch.x64,
    arm64: Arch.arm64,
    universal: Arch.universal,
};

function builderConfiguration(config: GameBuildWorkerConfig, target: GameBuildWorkerTarget): Configuration {
    return {
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
    // The web job first: it is orders of magnitude faster than any
    // electron-builder target, so its artifacts land even if a later desktop
    // target fails.
    if (config.web) {
        artifacts.push(...await packageWebSite(config.web, config.outputDir, log));
    }
    if (config.targets.length === 0) {
        return artifacts;
    }
    const appDir = config.appDir;
    if (!appDir) {
        throw new Error("Desktop packaging requires a compiled app dir");
    }
    if (config.targets.some(target => target.platform === "windows")) {
        await ensureWinCodeSignCache(log);
    }
    for (const target of config.targets) {
        const platform = BUILDER_PLATFORMS[target.platform];
        const targetNames = target.formats.map(format => BUILDER_TARGET_NAMES[format]);
        log("info", `packaging ${target.platform} (${target.formats.join(", ")})`);
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
    return artifacts;
}
