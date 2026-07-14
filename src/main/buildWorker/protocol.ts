import type { GameBuildFormat, GameBuildPlatform } from "@shared/types/gameBuild";

/**
 * Message protocol between GameBuildManager (main process) and the packaging
 * worker (utility process). The worker only ever sees plain JSON: every path
 * and option is resolved by the manager before the fork.
 */

export type GameBuildWorkerFuses = {
    runAsNode: boolean;
    enableCookieEncryption: boolean;
    enableNodeOptionsEnvironmentVariable: boolean;
    enableNodeCliInspectArguments: boolean;
    enableEmbeddedAsarIntegrityValidation: boolean;
    onlyLoadAppFromAsar: boolean;
    grantFileProtocolExtraPrivileges: boolean;
    resetAdHocDarwinSignature: boolean;
};

export type GameBuildWorkerTarget = {
    platform: GameBuildPlatform;
    formats: GameBuildFormat[];
    /** Electron fuse set for this platform's binaries. */
    fuses: GameBuildWorkerFuses;
    /**
     * Local Electron dist to package from. Only set when the target matches
     * the host platform; cross builds leave it unset so electron-builder
     * downloads (and caches) the right dist.
     */
    electronDist?: string;
    /**
     * Absolute path of the app icon for this platform. electron-builder
     * converts a large PNG to the native format (.icns/.ico) as needed; unset
     * falls back to the default Electron icon.
     */
    iconPath?: string;
};

export type GameBuildWorkerConfig = {
    /** Compiled staging app dir (contains package.json + runtime + payload). */
    appDir: string;
    /** Absolute directory electron-builder writes artifacts into. */
    outputDir: string;
    appId: string;
    productName: string;
    /** Sanitized, path-safe artifact base name. */
    artifactBaseName: string;
    electronVersion: string;
    /** Download mirror for Electron dists (cross builds); empty = official. */
    electronMirror?: string;
    /** Glob patterns kept outside the asar as real files. */
    asarUnpack: string[];
    targets: GameBuildWorkerTarget[];
};

export type GameBuildWorkerStartMessage = {
    type: "start";
    config: GameBuildWorkerConfig;
};

export type GameBuildWorkerLogMessage = {
    type: "log";
    level: "info" | "warning" | "error";
    message: string;
};

export type GameBuildWorkerDoneMessage = {
    type: "done";
    /** Absolute paths of the artifacts electron-builder reported. */
    artifacts: string[];
};

export type GameBuildWorkerErrorMessage = {
    type: "error";
    message: string;
};

export type GameBuildWorkerInboundMessage = GameBuildWorkerStartMessage;

export type GameBuildWorkerOutboundMessage =
    | GameBuildWorkerLogMessage
    | GameBuildWorkerDoneMessage
    | GameBuildWorkerErrorMessage;
