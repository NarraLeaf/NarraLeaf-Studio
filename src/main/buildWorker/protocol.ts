import type {
    GameBuildArch,
    GameBuildCompression,
    GameBuildDesktopPlatform,
    GameBuildFormat,
} from "@shared/types/gameBuild";

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
    platform: GameBuildDesktopPlatform;
    formats: GameBuildFormat[];
    /** The single arch to package for; see GameBuildTarget.arch for why one. */
    arch: GameBuildArch;
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

/**
 * Web export packaging job. The compiled static site is finished as-is —
 * no electron-builder involved: "dir" copies it into the output directory,
 * "zip" archives it (site files at the archive root, ready to upload).
 */
export type GameBuildWorkerWebJob = {
    /** Compiled static-site dir (output of the web artifact compile). */
    sourceDir: string;
    /** Subset of ["zip", "dir"]. */
    formats: GameBuildFormat[];
    /** Folder name (under outputDir) the "dir" format is copied to. */
    dirName: string;
    /** File name (under outputDir) the "zip" format is written to. */
    zipName: string;
};

export type GameBuildWorkerConfig = {
    /**
     * Compiled staging app dir (contains package.json + runtime + payload).
     * Required whenever `targets` is non-empty; a web-only build has none.
     */
    appDir?: string;
    /** Absolute directory artifacts are written into. */
    outputDir: string;
    appId: string;
    productName: string;
    /** Sanitized, path-safe artifact base name. */
    artifactBaseName: string;
    electronVersion: string;
    /** Copyright line embedded in the binaries; unset leaves it to electron-builder. */
    copyright?: string;
    /** Payload compression; unset uses electron-builder's default ("maximum"). */
    compression?: GameBuildCompression;
    /** Download mirror for Electron dists (cross builds); empty = official. */
    electronMirror?: string;
    /** Glob patterns kept outside the asar as real files. */
    asarUnpack: string[];
    /** Desktop packaging jobs, one per platform (electron-builder). */
    targets: GameBuildWorkerTarget[];
    /** Optional web export job, packaged without electron-builder. */
    web?: GameBuildWorkerWebJob;
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
