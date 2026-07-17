import {
    defaultGameBuildArch,
    hostCanBuildTarget,
    isDesktopBuildPlatform,
    normalizeGameBuildArch,
    type GameBuildArch,
    type GameBuildCompression,
    type GameBuildDesktopPlatform,
    type GameBuildFormat,
    type GameBuildPlatform,
    type GameBuildRequest,
} from "@shared/types/gameBuild";
import { DEFAULT_BUILD_COMPRESSION, type BuildConfiguration } from "@/lib/workspace/project/configuration";

/**
 * The build dialog's selection, and the pure rules that seed it and turn it
 * into a request. Kept out of the component so the "what will this build?"
 * logic is testable without rendering.
 */

/** Platforms shown, in display order. */
export const DIALOG_PLATFORMS: GameBuildPlatform[] = ["windows", "macos", "linux", "web", "android", "ios"];

export const DESKTOP_PLATFORMS: GameBuildDesktopPlatform[] = ["windows", "macos", "linux"];

/**
 * Formats offered per platform. Desktop platforms get a portable ZIP, the
 * native installer, and the unpacked folder — the folder skips installer
 * generation entirely, which is the fast path for a local check. The web target
 * has no installer: an archive or the deployable site folder.
 */
export const OFFERED_FORMATS: Record<GameBuildPlatform, GameBuildFormat[]> = {
    windows: ["zip", "nsis", "dir"],
    macos: ["zip", "dmg", "dir"],
    linux: ["zip", "appimage", "dir"],
    web: ["zip", "dir"],
    android: ["apk"],
    ios: ["ipa"],
};

/** Formats a platform switches on with — the installer plus the portable archive. */
const DEFAULT_FORMATS: Record<GameBuildPlatform, GameBuildFormat[]> = {
    windows: ["zip", "nsis"],
    macos: ["zip", "dmg"],
    linux: ["zip", "appimage"],
    web: ["zip"],
    android: ["apk"],
    ios: ["ipa"],
};

export type BuildDialogState = {
    formats: Record<GameBuildPlatform, Set<GameBuildFormat>>;
    archs: Record<GameBuildDesktopPlatform, GameBuildArch>;
    /** Absolute output directory, or "" to use the default (`<project>/dist`). */
    outputDir: string;
    compression: GameBuildCompression;
    openWhenDone: boolean;
};

/**
 * Every platform key, so `BuildDialogState.formats` is genuinely total: the
 * dialog renders only DIALOG_PLATFORMS, but code trusting the Record type may
 * index any platform — seeding all keys keeps the type honest.
 */
const ALL_PLATFORMS = Object.keys(OFFERED_FORMATS) as GameBuildPlatform[];

export function isDesktopPlatform(platform: GameBuildPlatform): platform is GameBuildDesktopPlatform {
    // Delegates to the shared exhaustive test: `platform !== "web"` silently
    // classified the mobile platforms as desktop (arch selects and all) the
    // moment the union grew — a predicate body TypeScript never checks.
    return isDesktopBuildPlatform(platform);
}

/**
 * Seed the dialog from the project's remembered selection, falling back to "the
 * host platform, installers on" for a project that has never been built.
 */
export function initialDialogState(
    config: BuildConfiguration | null,
    hostPlatform: GameBuildDesktopPlatform,
    hostArch: string,
): BuildDialogState {
    const formats = {} as Record<GameBuildPlatform, Set<GameBuildFormat>>;
    for (const platform of ALL_PLATFORMS) {
        // A platform this host cannot build never starts selected, so the
        // committed selection can never contain an impossible target.
        if (!hostCanBuildTarget(hostPlatform, platform)) {
            formats[platform] = new Set();
            continue;
        }
        const stored = config?.formats?.[platform];
        const enabled = config
            ? (config.platforms.includes(platform) && Boolean(stored?.length))
            : platform === hostPlatform;
        const chosen = stored?.length ? stored : DEFAULT_FORMATS[platform];
        formats[platform] = new Set(
            enabled ? chosen.filter(format => OFFERED_FORMATS[platform].includes(format)) : [],
        );
    }
    const archs = {} as Record<GameBuildDesktopPlatform, GameBuildArch>;
    for (const platform of DESKTOP_PLATFORMS) {
        const stored = config?.archs?.[platform];
        archs[platform] = stored
            ? normalizeGameBuildArch(platform, stored)
            : defaultGameBuildArch(platform, hostPlatform, hostArch);
    }
    return {
        formats,
        archs,
        outputDir: config?.outputDir ?? "",
        compression: config?.compression ?? DEFAULT_BUILD_COMPRESSION,
        openWhenDone: config?.openWhenDone ?? true,
    };
}

/** Collect the current selection into a request the pipeline accepts. */
export function stateToRequest(state: BuildDialogState): GameBuildRequest {
    const targets = DIALOG_PLATFORMS.flatMap(platform => {
        const formats = [...state.formats[platform]];
        if (formats.length === 0) {
            return [];
        }
        return [{
            platform,
            formats,
            // The web export has no CPU arch; sending one would be noise.
            ...(isDesktopPlatform(platform) ? { arch: state.archs[platform] } : {}),
        }];
    });
    return {
        targets,
        outputDir: state.outputDir.trim(),
        compression: state.compression,
        openWhenDone: state.openWhenDone,
    };
}

/** Persisted form of a committed selection, for the next dialog open. */
export function requestToBuildConfiguration(request: GameBuildRequest): BuildConfiguration {
    const formats: BuildConfiguration["formats"] = {};
    const archs: BuildConfiguration["archs"] = {};
    for (const target of request.targets) {
        formats[target.platform] = target.formats;
        if (isDesktopPlatform(target.platform) && target.arch) {
            archs[target.platform] = target.arch;
        }
    }
    return {
        platforms: request.targets.map(target => target.platform),
        formats,
        archs,
        outputDir: request.outputDir ?? "",
        compression: request.compression ?? DEFAULT_BUILD_COMPRESSION,
        openWhenDone: request.openWhenDone ?? true,
    };
}

/** Rebuild dialog state from a parked draft, so reopening restores it exactly. */
export function stateFromRequest(
    request: GameBuildRequest,
    hostPlatform: GameBuildDesktopPlatform,
    hostArch: string,
): BuildDialogState {
    const formats = {} as Record<GameBuildPlatform, Set<GameBuildFormat>>;
    for (const platform of ALL_PLATFORMS) {
        formats[platform] = new Set();
    }
    const archs = {} as Record<GameBuildDesktopPlatform, GameBuildArch>;
    for (const platform of DESKTOP_PLATFORMS) {
        archs[platform] = defaultGameBuildArch(platform, hostPlatform, hostArch);
    }
    for (const target of request.targets) {
        formats[target.platform] = new Set(target.formats);
        if (isDesktopPlatform(target.platform) && target.arch) {
            archs[target.platform] = normalizeGameBuildArch(target.platform, target.arch);
        }
    }
    return {
        formats,
        archs,
        outputDir: request.outputDir ?? "",
        compression: request.compression ?? DEFAULT_BUILD_COMPRESSION,
        openWhenDone: request.openWhenDone ?? true,
    };
}

export function togglePlatform(
    state: BuildDialogState,
    platform: GameBuildPlatform,
    enabled: boolean,
): BuildDialogState {
    const formats = { ...state.formats };
    formats[platform] = new Set(enabled ? DEFAULT_FORMATS[platform] : []);
    return { ...state, formats };
}

export function toggleFormat(
    state: BuildDialogState,
    platform: GameBuildPlatform,
    format: GameBuildFormat,
): BuildDialogState {
    const next = new Set(state.formats[platform]);
    if (next.has(format)) {
        next.delete(format);
    } else {
        next.add(format);
    }
    return { ...state, formats: { ...state.formats, [platform]: next } };
}
