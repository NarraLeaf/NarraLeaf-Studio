import path from "path";
import { build, Platform, Arch, type Configuration } from "electron-builder";
import {
    currentGameBuildPlatform,
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

function targetArch(target: GameBuildWorkerTarget): Arch {
    if (target.platform === currentGameBuildPlatform()) {
        return process.arch === "arm64" ? Arch.arm64 : Arch.x64;
    }
    // Cross builds default to x64, the broadest player base.
    return Arch.x64;
}

function builderConfiguration(config: GameBuildWorkerConfig, target: GameBuildWorkerTarget): Configuration {
    return {
        appId: config.appId,
        productName: config.productName,
        electronVersion: config.electronVersion,
        ...(target.electronDist ? { electronDist: target.electronDist } : {}),
        ...(target.iconPath ? { icon: target.iconPath } : {}),
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
        artifactName: `${config.artifactBaseName}-\${version}-\${os}-\${arch}.\${ext}`,
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
            targets: platform.createTarget(targetNames, targetArch(target)),
            projectDir: appDir,
            config: builderConfiguration(config, target),
        });
        artifacts.push(...produced.map(artifact => path.resolve(artifact)));
    }
    return artifacts;
}
