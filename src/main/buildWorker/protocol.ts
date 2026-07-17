import type {
    GameBuildArch,
    GameBuildCompression,
    GameBuildDesktopPlatform,
    GameBuildFormat,
} from "@shared/types/gameBuild";
import type { MobileShellManifest, MobileShellOrientation } from "./mobile/mobileShellManifest";
import type { SigningIdentity } from "./mobile/signingIdentity";

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

/**
 * Mobile repack job. Both platforms share one job because they share the
 * compiled site and every piece of identity derived from it; each block is
 * present only when that platform was selected.
 *
 * Everything the repack cannot decide for itself is resolved by the manager
 * before the fork: the signing identity, the version code, the normalized
 * package name / bundle id, and the scaled icons (nativeImage is a main-process
 * API). The worker only reads files and moves bytes.
 */
export type GameBuildWorkerMobileJob = {
    /** Compiled static-site dir — the same web compile the web target uses. */
    sourceDir: string;
    /** The shell template contract, already validated by the manager. */
    templateManifest: MobileShellManifest;
    /** Home-screen name (Android label / CFBundleDisplayName) and .app dir name. */
    productName: string;
    /** Sanitized, path-safe base for the `Payload/<name>.app` directory. */
    appDirBaseName: string;
    orientation: MobileShellOrientation;
    /**
     * The mobile variant of index.html, injected over the compiled site's copy.
     * Passed rather than re-compiled so the shared staging-web dir stays exactly
     * what the web target ships.
     */
    indexHtmlOverride: string;
    /** shell-config.json payload, written verbatim into the template. */
    shellConfigJson: string;
    android?: {
        /** Template APK for the variant the manager picked (release/debug). */
        templateApkPath: string;
        /** File name written under outputDir. */
        outputName: string;
        /** Already through normalizeAndroidPackageName. */
        applicationId: string;
        /** android:versionName — the project's raw semver. */
        versionName: string;
        /** android:versionCode — monotonic integer from deriveAndroidVersionCode. */
        versionCode: number;
        /** Icon slot (zip entry path) → absolute path of the scaled PNG. */
        iconPngBySlot?: Record<string, string>;
        signingIdentity: SigningIdentity;
    };
    ios?: {
        templateAppZipPath: string;
        outputName: string;
        /** Already through normalizeIosBundleId. */
        bundleId: string;
        /** Numeric three-part version; shared with bundleVersion. */
        shortVersionString: string;
        bundleVersion: string;
        /** Icon slot (path relative to the .app) → absolute path of the scaled PNG. */
        iconPngBySlot?: Record<string, string>;
    };
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
    /** Optional mobile repack job, packaged without electron-builder. */
    mobile?: GameBuildWorkerMobileJob;
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
