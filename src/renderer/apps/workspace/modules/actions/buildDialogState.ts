import {
    defaultGameBuildArch,
    hostCanBuildTarget,
    isDesktopBuildPlatform,
    normalizeGameBuildArch,
    type BuildPreflightSection,
    type GameBuildArch,
    type GameBuildCompression,
    type GameBuildDesktopPlatform,
    type GameBuildFormat,
    type GameBuildPlatform,
    type GameBuildRequest,
} from "@shared/types/gameBuild";
import { isBuiltinAppTagId } from "@shared/types/appTag";
import { DEFAULT_BUILD_COMPRESSION, type BuildConfiguration } from "@/lib/workspace/project/configuration";

/**
 * The build dialog's selection, and the pure rules that seed it and turn it
 * into a request. Kept out of the component so the "what will this build?"
 * logic is testable without rendering.
 */

/**
 * The sections of the rail a preflight finding can name, in order.
 *
 * Exported so a test can hold it against `BuildPreflightSection`: a section the type knows about and
 * this list does not is invisible - its findings render nowhere, and a blocking one sends the author
 * to a section that is not there.
 */
export const BUILD_DIALOG_SECTIONS: BuildPreflightSection[] = [
    "targets",
    "identity",
    "content",
    "plugins",
    "signing",
    "output",
];

/**
 * A page of the dialog, which is the six sections plus the one that picks the variant.
 *
 * The variant page is not a `BuildPreflightSection` and must never become one: it can be hidden (see
 * {@link visibleBuildDialogPages}), and a finding filed against a hidden page would render nowhere.
 * It is first because everything after it describes the variant it selects.
 */
export type BuildDialogPage = "variant" | BuildPreflightSection;

export const BUILD_DIALOG_PAGES: BuildDialogPage[] = ["variant", ...BUILD_DIALOG_SECTIONS];

/**
 * The pages the rail shows, and the pages Next walks.
 *
 * Two of them are conditional, for the same reason: a page with nothing on it is a step nobody can
 * leave. A project with only the release variant has nothing to choose, so the variant page goes and
 * the dialog is what it was before variants existed; a build no installed plugin asks a value of has
 * nothing to fill in, so the plugins page goes.
 *
 * The plugins page carries findings and the variant page does not, which is safe: a finding in that
 * section can only come from a declared field, and a declared field is exactly what makes the page
 * visible. That holds only while `declaresPluginConfig` is recomputed from the platforms currently
 * selected - the same input the checks are run against - rather than captured when the dialog opened.
 *
 * Every reader of the walk - the rail, the Next/Build arithmetic, the parked draft - works off this
 * list rather than off the constant, or a hidden page becomes a step nobody can leave.
 */
export function visibleBuildDialogPages(input: {
    hasAuthoredVariants: boolean;
    /** Whether any enabled plugin declares a field applying to the platforms being built. */
    declaresPluginConfig: boolean;
}): BuildDialogPage[] {
    return BUILD_DIALOG_PAGES.filter(page => {
        if (page === "variant") {
            return input.hasAuthoredVariants;
        }
        if (page === "plugins") {
            return input.declaresPluginConfig;
        }
        return true;
    });
}

/**
 * The dialog's spelling of a variant selection: the empty string for the release variant.
 *
 * The release variant has two possible spellings - its id and "no id at all" - and both used to
 * reach the stored configuration, which made one choice look like two. Dialog state holds only the
 * empty one, so a stored `"release"` (written by an older Studio) reads back as the same selection
 * it always meant.
 */
export function appTagSelection(id: string | null | undefined): string {
    const trimmed = typeof id === "string" ? id.trim() : "";
    return !trimmed || isBuiltinAppTagId(trimmed) ? "" : trimmed;
}

/** Platforms shown, in display order. */
export const DIALOG_PLATFORMS: GameBuildPlatform[] = ["windows", "macos", "linux", "web", "android", "ios"];

export const DESKTOP_PLATFORMS: GameBuildDesktopPlatform[] = ["windows", "macos", "linux"];

/**
 * Formats offered per platform. Desktop platforms get a portable ZIP, the
 * native installer, and the unpacked folder - the folder skips installer
 * generation entirely, which is the fast path for a local check. The web target
 * has no installer: an archive or the deployable site folder. Android offers
 * both of its packages: the APK a device installs, and the AAB Google Play
 * takes.
 */
export const OFFERED_FORMATS: Record<GameBuildPlatform, GameBuildFormat[]> = {
    windows: ["zip", "nsis", "dir"],
    macos: ["zip", "dmg", "dir"],
    linux: ["zip", "appimage", "dir"],
    web: ["zip", "dir"],
    android: ["apk", "aab"],
    ios: ["ipa"],
};

/**
 * Formats a platform switches on with - the installer plus the portable archive.
 *
 * Android starts on the APK alone, deliberately. The AAB is a second container
 * built from the same payload, so producing both costs a second pass over the
 * expensive part of the build, and most builds are a local check rather than a
 * store upload. The preflight warning is what points an author who is
 * publishing at the format they are missing.
 */
const DEFAULT_FORMATS: Record<GameBuildPlatform, GameBuildFormat[]> = {
    windows: ["zip", "nsis"],
    macos: ["zip", "dmg"],
    linux: ["zip", "appimage"],
    web: ["zip"],
    android: ["apk"],
    ios: ["ipa"],
};

export type BuildDialogState = {
    /**
     * The build variant being produced, by id. `""` means the release variant, which is what an
     * absent selection and a deleted variant both come to.
     */
    appTagId: string;
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
 * index any platform - seeding all keys keeps the type honest.
 */
const ALL_PLATFORMS = Object.keys(OFFERED_FORMATS) as GameBuildPlatform[];

export function isDesktopPlatform(platform: GameBuildPlatform): platform is GameBuildDesktopPlatform {
    // Delegates to the shared exhaustive test: `platform !== "web"` silently
    // classified the mobile platforms as desktop (arch selects and all) the
    // moment the union grew - a predicate body TypeScript never checks.
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
        appTagId: appTagSelection(config?.appTagId),
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
        // Omitted rather than sent empty: the pipeline reads an absent id as the release variant and
        // refuses one it cannot find, so "" would be a variant nothing has. The release variant is
        // absent for the same reason it is the empty string here - one choice, one spelling.
        ...(appTagSelection(state.appTagId) ? { appTagId: appTagSelection(state.appTagId) } : {}),
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
    const appTagId = appTagSelection(request.appTagId);
    return {
        // Absent for the release variant, which is what an absent id already meant.
        ...(appTagId ? { appTagId } : {}),
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
        appTagId: appTagSelection(request.appTagId),
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
