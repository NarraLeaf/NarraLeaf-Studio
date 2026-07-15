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

/** One packaging job: a platform plus the formats to emit for it. */
export type GameBuildTarget = {
    platform: GameBuildPlatform;
    formats: GameBuildFormat[];
};

export type GameBuildRequest = {
    targets: GameBuildTarget[];
    /**
     * Absolute output directory for finished artifacts (chosen via the native
     * folder picker). When absent, defaults to "<project>/dist".
     */
    outputDir?: string;
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
